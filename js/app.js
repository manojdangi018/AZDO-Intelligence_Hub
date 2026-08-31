(function () {
  if (sessionStorage.getItem('azdo_workspace_active') === 'true') {
    document.documentElement.classList.add('restore-workspace-page');
  }
})();

let chartInstance = null;
let currentFocusTarget = null;
let cachedRepos = [];
let currentChartData = { labels: [], values: [], label: 'Overview' };
let currentChartType = 'bar';
let activeViewSection = 'view-repositories';
let activeCategory = 'repositories';
const PAGE_SIZE = 10;
const PIPELINE_PAGE_SIZE = 25;
const AZDO_STABLE_API_VERSION = '7.1';

let rawStore = {
  repos: [], repoIndex: 0,
  repoPrs: [], repoPrsIndex: 0,
  access: [], accessIndex: 0,
  commits: [], commitsIndex: 0,
  pipelines: [], pipelineIndex: 0,
  pipelineSummaries: [], pipelineSummariesIndex: 0,
  workitems: [], workitemsIndex: 0,
  serviceConnections: [], serviceConnectionsIndex: 0,
  agents: [], agentsIndex: 0
};

let workspaceDisplayStore = {};

function workspaceHasData(category) {
  switch (category) {
    case 'repositories':
      return (rawStore.repos?.length || 0) > 0 || (rawStore.repoPrs?.length || 0) > 0;
    case 'pipelines':
      return (rawStore.pipelineSummaries?.length || 0) > 0 || (rawStore.pipelines?.length || 0) > 0;
    case 'work_items':
      return (rawStore.workitems?.length || 0) > 0;
    case 'user_access':
      return (rawStore.access?.length || 0) > 0;
    case 'user_activity':
      return (rawStore.commits?.length || 0) > 0;
    case 'service_agents':
      return (rawStore.serviceConnections?.length || 0) > 0 ||
             (rawStore.agents?.length || 0) > 0 ||
             (rawStore.agentPools?.length || 0) > 0;
    default:
      return false;
  }
}

function saveWorkspaceDisplayState(category) {
  if (!category || !workspaceHasData(category)) return;

  const kpis = {};
  for (let i = 1; i <= 5; i++) {
    const label = document.getElementById(`kpi-${i}-label`);
    const value = document.getElementById(`kpi-${i}-val`);
    if (label && value) {
      kpis[i] = {
        label: label.textContent,
        value: value.textContent,
        className: value.className
      };
    }
  }

  workspaceDisplayStore[category] = {
    kpis,
    chart: {
      labels: Array.isArray(currentChartData?.labels) ? [...currentChartData.labels] : [],
      values: Array.isArray(currentChartData?.values) ? [...currentChartData.values] : [],
      label: currentChartData?.label || 'Overview',
      type: currentChartType || 'bar'
    }
  };
}

function setWorkspaceDefaultKpis(category) {
  const defaults = {
    repositories: [['Repository', '-'], ['Branches', '0'], ['Total PRs', '0'], ['Active PRs', '0'], ['Completed PRs', '0']],
    pipelines: [['Active Scope', '—'], ['Total Pipelines', '0'], ['Successful Builds', '0'], ['Auto / CI Triggers', '0'], ['Scanned Runs', '0']],
    work_items: [['Total Work Items', '0'], ['Active / New', '0'], ['In Progress', '0'], ['Resolved', '0'], ['Closed / Done', '0']],
    user_access: [['Active Scope', '—'], ['Groups & Teams', '0'], ['Total Memberships', '0'], ['Mode', 'Security Access'], ['Status', 'Ready']],
    user_activity: [['Active Scope', '—'], ['Active Repos', '0'], ['Commits Made', '0'], ['Pull Requests', '0'], ['Status', 'No Commits']],
    service_agents: [['Total Service Connections', '0'], ['Microsoft-hosted Pools', '0'], ['Self-hosted Agents', '0']]
  };

  const values = defaults[category] || defaults.repositories;
  for (let i = 1; i <= 5; i++) {
    const label = document.getElementById(`kpi-${i}-label`);
    const value = document.getElementById(`kpi-${i}-val`);
    const item = values[i - 1];
    if (label && value && item) {
      label.textContent = item[0];
      value.textContent = item[1];
      value.className = 'text-2xl font-extrabold text-slate-800 mt-1 truncate';
    }
  }
}

function restoreWorkspaceDisplayState(category) {
  const state = workspaceDisplayStore[category];
  if (!state) {
    setWorkspaceDefaultKpis(category);
    return;
  }

  for (let i = 1; i <= 5; i++) {
    const label = document.getElementById(`kpi-${i}-label`);
    const value = document.getElementById(`kpi-${i}-val`);
    const item = state.kpis?.[i];
    if (label && value && item) {
      label.textContent = item.label;
      value.textContent = item.value;
      value.className = item.className;
    }
  }

  if (state.chart) {
    currentChartType = state.chart.type || 'bar';
    if (typeof renderChart === 'function') {
      renderChart(state.chart.labels || [], state.chart.values || [], state.chart.label || 'Overview');
    }
  }
}

function extractOrgName(input) {
  let cleaned = (input || '').trim().replace(/^https?:\/\//, '').replace(/^dev\.azure\.com\//, '');
  return cleaned.split('/')[0] || '';
}

function showModal(message, targetFocusId) {
  currentFocusTarget = targetFocusId;
  document.getElementById('modalMessage').textContent = message;
  document.getElementById('validationModal').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('validationModal').classList.add('hidden');
  if (currentFocusTarget) {
    const target = document.getElementById(currentFocusTarget);
    if (target) {
      target.focus();
      target.classList.add('ring-2', 'ring-red-400');
      setTimeout(() => target.classList.remove('ring-2', 'ring-red-400'), 1500);
    }
  }
}

function setStatus(msg, type = 'info') {
  const el = document.getElementById('statusBar') || document.getElementById('landingStatusBar');
  if (!el) return;
  el.classList.remove('hidden', 'bg-red-50', 'text-red-700', 'bg-green-50', 'text-green-700', 'bg-blue-50', 'text-blue-700');
  if (type === 'error') el.classList.add('bg-red-50', 'text-red-700');
  else if (type === 'success') el.classList.add('bg-green-50', 'text-green-700');
  else el.classList.add('bg-blue-50', 'text-blue-700');
  el.textContent = msg;
}

function startFetching(message) {
  setStatus(message, 'info');
  document.getElementById('statusBar')?.classList.add('fetching');
}

function stopFetching() {
  document.getElementById('statusBar')?.classList.remove('fetching');
}

function showWorkspacePage() {
  document.getElementById('connectionPage')?.classList.add('hidden');
  document.getElementById('workspacePage')?.classList.remove('hidden');
}

function showConnectionPage() {
  document.getElementById('workspacePage')?.classList.add('hidden');
  document.getElementById('connectionPage')?.classList.remove('hidden');
}

function updatePathPreview(org = '', project = '') {
  const linkEl = document.getElementById('generatedUrlLink');
  let url = 'https://dev.azure.com/';
  if (org) url += org;
  if (org && project) url += `/${project}`;

  if (linkEl) {
    linkEl.textContent = url;
    linkEl.href = url;
    if (org) {
      linkEl.className = 'text-blue-600 font-mono underline hover:text-blue-800 cursor-pointer';
      linkEl.target = '_blank';
    } else {
      linkEl.className = 'text-slate-400 font-mono underline cursor-default';
      linkEl.removeAttribute('target');
    }
  }
  const activePath = document.getElementById('activePathLink');
  if (activePath) { activePath.textContent = url; activePath.href = url; }
}

function initCredentials() {
  const savedOrg = localStorage.getItem('azdo_org');
  if (savedOrg && document.getElementById('targetOrg')) {
    document.getElementById('targetOrg').value = savedOrg;
  }
  handleOrgChange();
}

function toggleRememberCreds() {
  const isChecked = document.getElementById('chkRememberCreds')?.checked;
  if (isChecked) {
    localStorage.setItem('azdo_org', document.getElementById('targetOrg')?.value.trim() || '');
  } else {
    localStorage.removeItem('azdo_org');
  }
}

function handleOrgChange() {
  const org = extractOrgName(document.getElementById('targetOrg')?.value || '');
  updatePathPreview(org);
  const projectBadge = document.getElementById('overviewProjectBadge');
  if (projectBadge) projectBadge.textContent = '—';
  resetDropdown('projectSelect', '-- Select a Project --');
  if (typeof resetServiceAgentsScope === 'function') resetServiceAgentsScope();
  document.getElementById('step5Container')?.classList.add('hidden');
  if (document.getElementById('chkRememberCreds')?.checked) {
    localStorage.setItem('azdo_org', org);
  }
}

function resetDropdown(id, placeholder) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = `<option value="">${placeholder}</option>`;
  el.disabled = true;
  el.classList.add('bg-slate-100', 'cursor-not-allowed');
  el.classList.remove('bg-white');
}

function enableDropdown(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.disabled = false;
  el.classList.remove('bg-slate-100', 'cursor-not-allowed');
  el.classList.add('bg-white');
}

async function loadProjectsList() {
  const loadBtn = document.getElementById('btnLoadProjects');
  if (loadBtn) {
    loadBtn.disabled = true;
    loadBtn.textContent = 'Loading projects...';
    loadBtn.classList.add('loading');
  }

  setStatus(`Connecting to backend and fetching projects...`, 'info');

  try {
    const url = `_apis/projects?api-version=${API_VERSION}&$top=500`;
    const data = await fetchAzDo(url);
    const projects = data.value || [];

    const projDropdown = document.getElementById('projectSelect');
    if (projDropdown) {
      projDropdown.innerHTML = '<option value="">-- Select a Project --</option>';
      projects.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.name;
        opt.textContent = p.name;
        projDropdown.appendChild(opt);
      });
    }

    enableDropdown('projectSelect');
    updateProjectRequirementUI();
    document.getElementById('step5Container')?.classList.add('hidden');

    sessionStorage.setItem('azdo_workspace_active', 'true');
    
    setConnectionBadge(true);
    showWorkspacePage();
    setStatus(`Loaded ${projects.length} projects successfully!`, 'success');
  } catch (err) {
    setStatus(`Error loading projects: ${err.message}`, 'error');
    setConnectionBadge(false);
  } finally {
    if (loadBtn) {
      loadBtn.disabled = false;
      loadBtn.textContent = 'Connect & Load';
      loadBtn.classList.remove('loading');
    }
  }
}

function updateProjectRequirementUI() {
  const mark = document.getElementById('projectRequiredMark');
  const note = document.getElementById('projectRequirementText');
  const select = document.getElementById('projectSelect');
  const serviceAgentsActive = activeCategory === 'service_agents';

  if (mark) mark.classList.toggle('hidden', serviceAgentsActive);
  if (note) {
    note.textContent = serviceAgentsActive
      ? 'Project is optional for Service Connections & Agent Pools. Leave it blank for organization-wide information.'
      : 'Project selection is required for Repositories, Access & Teams, User Activity, Pipelines & Builds, and Work Items.';
  }
  if (select) select.setAttribute('aria-required', serviceAgentsActive ? 'false' : 'true');
}

function switchToOrganizationServiceAgents() {
  const projectSelect = document.getElementById('projectSelect');
  if (projectSelect) projectSelect.value = '';

  activeCategory = 'repositories';
  activeViewSection = 'view-repositories';

  const categorySelect = document.getElementById('categorySelect');
  if (categorySelect) categorySelect.value = 'repositories';

  if (typeof resetServiceAgentsScope === 'function') resetServiceAgentsScope();
  if (typeof showSection === 'function') showSection('repositories');
  if (typeof configureServiceAgentsOverview === 'function') configureServiceAgentsOverview(false);
  if (typeof updateProjectRequirementUI === 'function') updateProjectRequirementUI();

  const step5 = document.getElementById('step5Container');
  if (step5) step5.classList.add('hidden');

  const projectBadge = document.getElementById('overviewProjectBadge');
  if (projectBadge) projectBadge.textContent = '—';

  showConnectionPage();
  setStatus('Returned to Azure DevOps Connection.', 'info');
}

async function handleProjectSelection() {
  const org = extractOrgName(document.getElementById('targetOrg')?.value || '');
  const project = document.getElementById('projectSelect')?.value || '';
  updateProjectRequirementUI();

  if (!project) {
    if (activeCategory === 'service_agents') {
      updatePathPreview(org);
      if (typeof updateServiceAgentsScopeText === 'function') updateServiceAgentsScopeText();
      renderActiveSubstep();
    } else {
      document.getElementById('step5Container')?.classList.add('hidden');
      updatePathPreview(org);
    }
    return;
  }

  updatePathPreview(org, project);
  if (typeof updateServiceAgentsScopeText === 'function') updateServiceAgentsScopeText();
  const projectBadge = document.getElementById('overviewProjectBadge');
  if (projectBadge) projectBadge.textContent = project || '—';
  
  sessionStorage.setItem('azdo_session_project', project);

  try {
    const url = `${project}/_apis/git/repositories?api-version=${API_VERSION}`;
    const data = await fetchAzDo(url);
    cachedRepos = data.value || [];
  } catch (e) {
    console.warn('Could not prefetch repos:', e);
  }

  renderActiveSubstep();
}

function renderActiveSubstep() {
  updateProjectRequirementUI();
  const project = document.getElementById('projectSelect')?.value;
  const step5 = document.getElementById('step5Container');
  const subRepo = document.getElementById('substepRepo');
  const subAccess = document.getElementById('substepAccess');
  const subActivity = document.getElementById('substepActivity');
  const subPipelines = document.getElementById('substepPipelines');
  const subWorkItems = document.getElementById('substepWorkItems');
  const subServiceAgents = document.getElementById('substepServiceAgents');

  if (!project && activeCategory !== 'service_agents') {
    step5?.classList.add('hidden');
    return;
  }

  step5?.classList.remove('hidden');
  [subRepo, subAccess, subActivity, subPipelines, subWorkItems, subServiceAgents].forEach(el => el?.classList.add('hidden'));

  if (activeCategory === 'repositories') {
    subRepo?.classList.remove('hidden');
    populateRepoDropdown();
  } else if (activeCategory === 'user_access') {
    subAccess?.classList.remove('hidden');
  } else if (activeCategory === 'user_activity') {
    subActivity?.classList.remove('hidden');
  } else if (activeCategory === 'pipelines') {
    subPipelines?.classList.remove('hidden');
  } else if (activeCategory === 'service_agents') {
    subServiceAgents?.classList.remove('hidden');
  } else if (activeCategory === 'work_items') {
    subWorkItems?.classList.remove('hidden');
  }
}

function showSection(viewId) {
  activeViewSection = `view-${viewId}`;
  ['repositories', 'access', 'activity', 'pipelines', 'serviceagents', 'workitems'].forEach(v => {
    document.getElementById(`view-${v}`)?.classList.toggle('hidden', v !== viewId);
  });
}

function selectExplore(category) {
  if (activeCategory && workspaceHasData(activeCategory)) {
    saveWorkspaceDisplayState(activeCategory);
  }

  activeCategory = category;
  sessionStorage.setItem('azdo_session_category', category);
  
  updateProjectRequirementUI();
  const categorySelect = document.getElementById('categorySelect');
  if (categorySelect) categorySelect.value = category;

  const viewMap = {
    repositories: 'repositories',
    pipelines: 'pipelines',
    work_items: 'workitems',
    user_activity: 'activity',
    user_access: 'access',
    service_agents: 'serviceagents'
  };
  const viewId = viewMap[category] || 'repositories';

  document.querySelectorAll('.sidebar-item').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === viewId);
  });

  showSection(viewId);
  if (typeof configureServiceAgentsOverview === 'function') {
    configureServiceAgentsOverview(viewId === 'serviceagents');
  }
  renderActiveSubstep();
  restoreWorkspaceDisplayState(category);
}

function setConnectionBadge(connected) {
  const text = document.getElementById('connectionBadgeText');
  const badge = document.getElementById('connectionBadge');
  const disconnectBtn = document.getElementById('btnDisconnect');
  if (!text || !badge) return;
  
  text.textContent = connected ? 'Connected' : 'Ready to connect';
  badge.classList.toggle('connected', !!connected);
  
  if (disconnectBtn) {
    disconnectBtn.classList.toggle('hidden', !connected);
  }
}

function disconnectSession() {
  rawStore = {
    repos: [], repoIndex: 0,
    repoPrs: [], repoPrsIndex: 0,
    access: [], accessIndex: 0,
    commits: [], commitsIndex: 0,
    pipelines: [], pipelineIndex: 0,
    pipelineSummaries: [], pipelineSummariesIndex: 0,
    workitems: [], workitemsIndex: 0,
    serviceConnections: [], serviceConnectionsIndex: 0,
    agents: [], agentsIndex: 0
  };
  cachedRepos = [];
  workspaceDisplayStore = {};

  resetDropdown('projectSelect', '-- Connect first --');
  if (typeof resetServiceAgentsScope === 'function') resetServiceAgentsScope();
  document.getElementById('step5Container')?.classList.add('hidden');
  const projectBadge = document.getElementById('overviewProjectBadge');
  if (projectBadge) projectBadge.textContent = '—';

  setConnectionBadge(false);
  
  sessionStorage.removeItem('azdo_workspace_active');
  sessionStorage.removeItem('azdo_session_project');
  sessionStorage.removeItem('azdo_session_category');
  
  showConnectionPage();
  setStatus('Disconnected from Azure DevOps.', 'info');
}

function filterActiveTable() {
  const query = document.getElementById('tableFilterInput')?.value.toLowerCase() || '';
  const activeSection = document.getElementById(activeViewSection);
  if (!activeSection) return;

  const rows = activeSection.querySelectorAll('tbody tr');
  rows.forEach(r => {
    const text = r.textContent.toLowerCase();
    r.style.display = text.includes(query) ? '' : 'none';
  });
}

function exportToExcelFile(sheetsData, baseFileName) {
  if (typeof XLSX === 'undefined') {
    alert('Excel library is still loading, please try again in a moment.');
    return;
  }
  const wb = XLSX.utils.book_new();
  let hasData = false;

  for (const [sheetName, data] of Object.entries(sheetsData)) {
    if (data && data.length > 0) {
      const ws = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(wb, ws, sheetName.substring(0, 31));
      hasData = true;
    }
  }

  if (!hasData) return;
  XLSX.writeFile(wb, `${baseFileName}_${Date.now()}.xlsx`);
}

function exportCurrentTableToXLSX() {
  if (activeViewSection === 'view-repositories') {
    const branchData = (rawStore.repos || []).map(b => ({
      "Repository": b.repo,
      "Branch Name": b.branch,
      "Status / Health": b.isStale ? "Stale" : "Active",
      "Last Author": b.author,
      "Last Commit Date": b.date,
      "Commit Message": b.msg
    }));

    const prData = (rawStore.repoPrs || []).map(p => ({
      "Repository": p.repo,
      "PR Title": p.title,
      "Source Branch": p.source,
      "Target Branch": p.target,
      "Creator": p.creator,
      "Status": p.status,
      "Created Date": p.createdDate
    }));

    exportToExcelFile({ "Branches": branchData, "Pull Requests": prData }, "AzureDevOps_Repositories_Telemetry");
  } 
  else if (activeViewSection === 'view-access') {
    const accessData = (rawStore.access || []).map(a => ({
      "Team / Group Name": a.team,
      "User Display Name": a.name,
      "User Principal / Email": a.email
    }));
    exportToExcelFile({ "Access & Permissions": accessData }, "AzureDevOps_Security_Access");
  } 
  else if (activeViewSection === 'view-activity') {
    const commitData = (rawStore.commits || []).map(c => ({
      "Repository": c.repo,
      "Branch": c.branch,
      "Commit ID": c.commitId,
      "Commit Date": c.date,
      "Message": c.comment
    }));
    exportToExcelFile({ "User Commits": commitData }, "AzureDevOps_User_Activity");
  } 
  else if (activeViewSection === 'view-pipelines') {
    const pipelineData = (rawStore.pipelines || []).map(r => ({
      "Pipeline Name": r.name,
      "Build Number": r.buildNumber,
      "Branch": r.branch,
      "Triggered By": r.author,
      "Result": r.result,
      "Finish Time": r.finishTime
    }));
    exportToExcelFile({ "Pipelines": pipelineData }, "AzureDevOps_Pipelines");
  } 
  else if (activeViewSection === 'view-serviceagents') {
    if (typeof exportServiceConnectionsAndAgentsToXLSX === 'function') {
      exportServiceConnectionsAndAgentsToXLSX();
    }
  }
  else if (activeViewSection === 'view-workitems') {
    const wiData = (rawStore.workitems || []).map(w => ({
      "ID": w.id,
      "Work Item Type": w.type,
      "Title": w.title,
      "Assigned To": w.assignedTo,
      "State": w.state,
      "Created Date": w.createdDate
    }));
    exportToExcelFile({ "Work Items": wiData }, "AzureDevOps_WorkItems");
  }
}

function changeChartType(type) {
  currentChartType = type.toLowerCase() === 'pie' ? 'pie' : type;
  renderChart(currentChartData.labels, currentChartData.values, currentChartData.label);
}

function renderChart(labels, data, datasetLabel) {
  currentChartData = { labels, values: data, label: datasetLabel };
  const canvas = document.getElementById('analyticsChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (chartInstance) chartInstance.destroy();

  const palette = ['#3b82f6', '#10b981', '#6366f1', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4', '#84cc16', '#f43f5e', '#a855f7'];
  const isPie = currentChartType === 'pie' || currentChartType === 'doughnut';
  const isLine = currentChartType === 'line';

  if (typeof ChartDataLabels !== 'undefined') {
    Chart.register(ChartDataLabels);
  }

  chartInstance = new Chart(ctx, {
    type: currentChartType,
    data: {
      labels: labels.length ? labels : ['No Data'],
      datasets: [{
        label: datasetLabel,
        data: data.length ? data : [0],
        backgroundColor: isPie ? palette : '#3b82f6',
        borderColor: isLine ? '#2563eb' : undefined,
        pointBackgroundColor: isLine ? '#2563eb' : undefined,
        pointRadius: isLine ? 5 : undefined,
        fill: isLine ? false : undefined,
        borderRadius: currentChartType === 'bar' ? 6 : 0
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: { top: isPie ? 10 : 25, bottom: 10 }
      },
      plugins: {
        legend: { display: isPie, position: 'right' },
        datalabels: {
          display: true,
          color: isPie ? '#ffffff' : '#1e293b',
          font: { weight: 'bold', size: 11 },
          anchor: isPie ? 'center' : 'end',
          align: isPie ? 'center' : 'top',
          offset: isPie ? 0 : 2,
          formatter: value => (value > 0 ? value : (isPie ? '' : '0'))
        }
      },
      scales: isPie ? {} : {
        y: { beginAtZero: true, grid: { color: '#f1f5f9' }, ticks: { precision: 0 } },
        x: { grid: { display: false }, ticks: { autoSkip: false, maxRotation: 45, minRotation: 20 } }
      }
    }
  });
}

document.addEventListener('DOMContentLoaded', async function () {
  initCredentials();

  const workspaceActive = sessionStorage.getItem('azdo_workspace_active');
  if (workspaceActive === 'true') {
    const savedProject = sessionStorage.getItem('azdo_session_project');
    const savedCategory = sessionStorage.getItem('azdo_session_category');

    if (savedCategory) activeCategory = savedCategory;

    await loadProjectsList();

    if (savedProject) {
      const projectSelect = document.getElementById('projectSelect');
      if (projectSelect) projectSelect.value = savedProject;
      await handleProjectSelection();
    }

    if (savedCategory) selectExplore(savedCategory);
  } else {
    selectExplore('repositories');
  }
});