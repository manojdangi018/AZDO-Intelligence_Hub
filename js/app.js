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

function extractOrgName(input) {
  let cleaned = input.trim().replace(/^https?:\/\//, '').replace(/^dev\.azure\.com\//, '');
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

  linkEl.textContent = url;
  linkEl.href = url;
  const activePath = document.getElementById('activePathLink');
  if (activePath) { activePath.textContent = url; activePath.href = url; }
  if (org) {
    linkEl.className = 'text-blue-600 font-mono underline hover:text-blue-800 cursor-pointer';
    linkEl.target = '_blank';
  } else {
    linkEl.className = 'text-slate-400 font-mono underline cursor-default';
    linkEl.removeAttribute('target');
  }
}

function initCredentials() {
  const savedOrg = localStorage.getItem('azdo_org');
  const savedPat = localStorage.getItem('azdo_pat');
  if (savedOrg) document.getElementById('targetOrg').value = savedOrg;
  if (savedPat) {
    document.getElementById('targetPat').value = savedPat;
    document.getElementById('chkRememberCreds').checked = true;
  }
  handleOrgChange();
}

function toggleRememberCreds() {
  const isChecked = document.getElementById('chkRememberCreds').checked;
  if (isChecked) {
    localStorage.setItem('azdo_org', document.getElementById('targetOrg').value.trim());
    localStorage.setItem('azdo_pat', document.getElementById('targetPat').value.trim());
  } else {
    localStorage.removeItem('azdo_org');
    localStorage.removeItem('azdo_pat');
  }
}

function handleOrgChange() {
  const org = extractOrgName(document.getElementById('targetOrg').value);
  updatePathPreview(org);
  const projectBadge = document.getElementById('overviewProjectBadge');
  if (projectBadge) projectBadge.textContent = '—';
  resetDropdown('projectSelect', '-- Load PAT first --');
  document.getElementById('step5Container').classList.add('hidden');
  if (document.getElementById('chkRememberCreds').checked) {
    localStorage.setItem('azdo_org', document.getElementById('targetOrg').value.trim());
  }
  setConnectionBadge(false);
}

function resetDropdown(id, placeholder) {
  const el = document.getElementById(id);
  el.innerHTML = `<option value="">${placeholder}</option>`;
  el.disabled = true;
  el.classList.add('bg-slate-100', 'cursor-not-allowed');
  el.classList.remove('bg-white');
}

function enableDropdown(id) {
  const el = document.getElementById(id);
  el.disabled = false;
  el.classList.remove('bg-slate-100', 'cursor-not-allowed');
  el.classList.add('bg-white');
}

async function loadProjectsList() {
  const org = extractOrgName(document.getElementById('targetOrg').value);
  const pat = document.getElementById('targetPat').value.trim();

  if (!org) return showModal('Please enter the Organization Name or URL first.', 'targetOrg');
  if (!pat) return showModal('Please enter your Personal Access Token (PAT).', 'targetPat');

  if (document.getElementById('chkRememberCreds').checked) {
    localStorage.setItem('azdo_org', org);
    localStorage.setItem('azdo_pat', pat);
  }

  const authHeader = 'Basic ' + btoa(':' + pat);
  setStatus(`Loading projects from https://dev.azure.com/${org}...`, 'info');

  try {
    const url = `https://dev.azure.com/${org}/_apis/projects?api-version=${API_VERSION}&$top=500`;
    const data = await fetchAzDo(url, authHeader);
    const projects = data.value || [];

    const projDropdown = document.getElementById('projectSelect');
    projDropdown.innerHTML = '<option value="">-- Select a Project --</option>';

    projects.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.name;
      opt.textContent = p.name;
      projDropdown.appendChild(opt);
    });

    enableDropdown('projectSelect');
    document.getElementById('step5Container').classList.add('hidden');
    setConnectionBadge(true);
    showWorkspacePage();
    setStatus(`Loaded ${projects.length} projects successfully! Please choose a project.`, 'success');
  } catch (err) {
    setStatus(`Error loading projects: ${err.message}`, 'error');
    setConnectionBadge(false);
  }
}

async function handleProjectSelection() {
  const org = extractOrgName(document.getElementById('targetOrg').value);
  const project = document.getElementById('projectSelect').value;
  const pat = document.getElementById('targetPat').value.trim();

  if (!project) {
    document.getElementById('step5Container').classList.add('hidden');
    updatePathPreview(org);
    return;
  }

  updatePathPreview(org, project);
  const projectBadge = document.getElementById('overviewProjectBadge');
  if (projectBadge) projectBadge.textContent = project || '—';

  const authHeader = 'Basic ' + btoa(':' + pat);
  try {
    const url = `https://dev.azure.com/${org}/${project}/_apis/git/repositories?api-version=${API_VERSION}`;
    const data = await fetchAzDo(url, authHeader);
    cachedRepos = data.value || [];
  } catch (e) {
    console.warn('Could not prefetch repos:', e);
  }

  renderActiveSubstep();
}

function renderActiveSubstep() {
  const project = document.getElementById('projectSelect').value;
  const step5 = document.getElementById('step5Container');
  const subRepo = document.getElementById('substepRepo');
  const subAccess = document.getElementById('substepAccess');
  const subActivity = document.getElementById('substepActivity');
  const subPipelines = document.getElementById('substepPipelines');
  const subWorkItems = document.getElementById('substepWorkItems');
  const subServiceAgents = document.getElementById('substepServiceAgents');

  if (!project) {
    step5.classList.add('hidden');
    return;
  }

  step5.classList.remove('hidden');
  [subRepo, subAccess, subActivity, subPipelines, subWorkItems, subServiceAgents].forEach(el => el.classList.add('hidden'));

  if (activeCategory === 'repositories') {
    subRepo.classList.remove('hidden');
    populateRepoDropdown();
  } else if (activeCategory === 'user_access') {
    subAccess.classList.remove('hidden');
  } else if (activeCategory === 'user_activity') {
    subActivity.classList.remove('hidden');
  } else if (activeCategory === 'pipelines') {
    subPipelines.classList.remove('hidden');
  } else if (activeCategory === 'service_agents') {
    subServiceAgents.classList.remove('hidden');
  } else if (activeCategory === 'work_items') {
    subWorkItems.classList.remove('hidden');
  }
}

function showSection(viewId) {
  activeViewSection = `view-${viewId}`;
  ['repositories', 'access', 'activity', 'pipelines', 'serviceagents', 'workitems'].forEach(v => {
    document.getElementById(`view-${v}`).classList.toggle('hidden', v !== viewId);
  });
}

function selectExplore(category) {
  activeCategory = category;
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

  if (typeof showSection === 'function') showSection(viewId);
  renderActiveSubstep();
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

  document.getElementById('targetPat').value = '';
  resetDropdown('projectSelect', '-- Load PAT first --');
  document.getElementById('step5Container').classList.add('hidden');
  document.getElementById('overviewProjectBadge').textContent = '—';

  document.getElementById('kpi-1-label').textContent = 'Repository';
  document.getElementById('kpi-1-val').textContent = '-';
  document.getElementById('kpi-1-val').className = 'text-2xl font-extrabold text-slate-800 mt-1 truncate';
  document.getElementById('kpi-2-label').textContent = 'Branches';
  document.getElementById('kpi-2-val').textContent = '0';
  document.getElementById('kpi-3-label').textContent = 'Total PRs';
  document.getElementById('kpi-3-val').textContent = '0';
  document.getElementById('kpi-4-label').textContent = 'Active PRs';
  document.getElementById('kpi-4-val').textContent = '0';
  document.getElementById('kpi-5-label').textContent = 'Completed PRs';
  document.getElementById('kpi-5-val').textContent = '0';

  document.getElementById('branchesTableBody').innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-400">Select a project & repository to inspect.</td></tr>`;
  document.getElementById('repoPrsTableBody').innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-400">Select a project & repository to inspect.</td></tr>`;
  document.getElementById('accessTableBody').innerHTML = `<tr><td colspan="4" class="p-4 text-center text-slate-400">Enter a User ID or click "Fetch User Access" to load access permissions.</td></tr>`;
  document.getElementById('userCommitsTableBody').innerHTML = `<tr><td colspan="5" class="p-4 text-center text-slate-400">Enter a user email/ID and click search.</td></tr>`;
  document.getElementById('userPrTableBody').innerHTML = `<tr><td colspan="5" class="p-4 text-center text-slate-400">No pull request activity loaded.</td></tr>`;
  document.getElementById('pipelineSummaryTableBody').innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-400">Click "Fetch Pipeline Runs" to scan pipeline definitions.</td></tr>`;
  document.getElementById('pipelineTableBody').innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-400">No build runs loaded.</td></tr>`;
  document.getElementById('workItemsTableBody').innerHTML = `<tr><td colspan="6" class="p-4 text-center text-slate-400">Query work items to view backlog.</td></tr>`;
  const serviceConnectionsBody = document.getElementById('serviceConnectionsTableBody');
  if (serviceConnectionsBody) serviceConnectionsBody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-400">Click "Fetch Connections &amp; Agents" to load service connections.</td></tr>`;
  const agentsBody = document.getElementById('agentsTableBody');
  if (agentsBody) agentsBody.innerHTML = `<tr><td colspan="10" class="p-4 text-center text-slate-400">Click "Fetch Connections &amp; Agents" to load agent pools and agents.</td></tr>`;

  ['seeMoreRepoContainer', 'seeMoreRepoPrsContainer', 'seeMoreAccessContainer', 'seeMoreCommitsContainer', 'seeMorePipelineSummaryContainer', 'seeMorePipelinesContainer', 'seeMoreWorkItemsContainer', 'seeMoreServiceConnectionsContainer', 'seeMoreAgentsContainer'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });

  renderChart([], [], 'Overview');
  setConnectionBadge(false);
  showConnectionPage();
  setStatus('Disconnected from Azure DevOps. Enter credentials to connect again.', 'info');
}

function filterActiveTable() {
  const query = document.getElementById('tableFilterInput').value.toLowerCase();
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
    exportToExcelFile({
      "Service Connections": (rawStore.serviceConnections || []).map(s => ({
        "Service Connection": s.name,
        "Type": s.type,
        "URL": s.url,
        "Ready": s.isReady,
        "Shared": s.isShared,
        "Created By": s.createdBy,
        "Owner": s.owner
      })),
      "Agents": (rawStore.agents || []).map(a => ({
        "Agent Pool": a.poolName,
        "Hosted": a.isHosted,
        "Pool Type": a.poolType,
        "Agent Name": a.name,
        "Status": a.status,
        "Enabled": a.enabled,
        "OS": a.os,
        "Version": a.version,
        "Created On": a.createdOn,
        "Current Job Owner": a.currentJobOwner
      }))
    }, "AzureDevOps_ServiceConnections_Agents");
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


function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"`]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;',"\"":'&quot;','`':'&#96;'}[ch]));
}

function displayIdentity(identity) {
  if (!identity) return '—';
  return identity.displayName || identity.uniqueName || identity.providerDisplayName || identity.id || '—';
}

function displayRequestOwner(request) {
  if (!request || !request.owner) return '—';
  return displayIdentity(request.owner);
}

async function fetchServiceConnectionAgentData() {
  const org = extractOrgName(document.getElementById('targetOrg').value);
  const project = document.getElementById('projectSelect').value;
  const pat = document.getElementById('targetPat').value.trim();

  if (!org) return showModal('Please enter the Organization Name or URL first.', 'targetOrg');
  if (!pat) return showModal('Please enter your Personal Access Token (PAT).', 'targetPat');
  if (!project) return showModal('Please select a project first.', 'projectSelect');

  const authHeader = 'Basic ' + btoa(':' + pat);
  const serviceBody = document.getElementById('serviceConnectionsTableBody');
  const agentsBody = document.getElementById('agentsTableBody');
  if (serviceBody) serviceBody.innerHTML = '<tr><td colspan="7" class="p-4 text-center text-slate-400">Loading service connections...</td></tr>';
  if (agentsBody) agentsBody.innerHTML = '<tr><td colspan="10" class="p-4 text-center text-slate-400">Loading agent pools and agents...</td></tr>';
  setStatus('Fetching service connections, agent pools and agents...', 'info');

  try {
    const serviceUrl = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/serviceendpoint/endpoints?api-version=${AZDO_STABLE_API_VERSION}`;
    const poolsUrl = `https://dev.azure.com/${encodeURIComponent(org)}/_apis/distributedtask/pools?api-version=${AZDO_STABLE_API_VERSION}`;

    const [serviceData, poolData] = await Promise.all([
      fetchAzDo(serviceUrl, authHeader),
      fetchAzDo(poolsUrl, authHeader)
    ]);

    rawStore.serviceConnections = (serviceData.value || []).map(endpoint => ({
      id: endpoint.id || '',
      name: endpoint.name || '—',
      type: endpoint.type || '—',
      url: endpoint.url || '—',
      isReady: endpoint.isReady === true ? 'Yes' : endpoint.isReady === false ? 'No' : '—',
      isShared: endpoint.isShared ? 'Yes' : 'No',
      createdBy: displayIdentity(endpoint.createdBy),
      owner: endpoint.owner || '—'
    }));
    rawStore.serviceConnectionsIndex = 0;

    const pools = poolData.value || [];
    const agentResults = await Promise.all(pools.map(async pool => {
      try {
        const agentsUrl = `https://dev.azure.com/${encodeURIComponent(org)}/_apis/distributedtask/pools/${pool.id}/agents?includeAssignedRequest=true&includeLastCompletedRequest=true&api-version=${AZDO_STABLE_API_VERSION}`;
        const agentData = await fetchAzDo(agentsUrl, authHeader);
        return (agentData.value || []).map(agent => ({
          poolName: pool.name || `Pool ${pool.id}`,
          isHosted: pool.isHosted ? 'Yes' : 'No',
          poolType: pool.poolType || '—',
          name: agent.name || '—',
          status: agent.status || '—',
          enabled: agent.enabled === true ? 'Yes' : agent.enabled === false ? 'No' : '—',
          os: agent.osDescription || '—',
          version: agent.version || '—',
          createdOn: agent.createdOn ? new Date(agent.createdOn).toLocaleString() : '—',
          currentJobOwner: displayRequestOwner(agent.assignedRequest)
        }));
      } catch (error) {
        console.warn(`Could not fetch agents for pool ${pool.name || pool.id}:`, error);
        return [{
          poolName: pool.name || `Pool ${pool.id}`,
          isHosted: pool.isHosted ? 'Yes' : 'No',
          poolType: pool.poolType || '—',
          name: 'Unable to read agents',
          status: error.message || 'Access denied',
          enabled: '—', os: '—', version: '—', createdOn: '—', currentJobOwner: '—'
        }];
      }
    }));

    rawStore.agents = agentResults.flat();
    rawStore.agentsIndex = 0;
    renderServiceConnectionsTableBatch(false);
    renderAgentsTableBatch(false);

    setStatus(`Loaded ${rawStore.serviceConnections.length} service connections, ${pools.length} agent pools and ${rawStore.agents.filter(a => a.name !== 'Unable to read agents').length} agents.`, 'success');
  } catch (error) {
    if (serviceBody) serviceBody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-red-500">${escapeHtml(error.message)}</td></tr>`;
    if (agentsBody) agentsBody.innerHTML = `<tr><td colspan="10" class="p-4 text-center text-red-500">${escapeHtml(error.message)}</td></tr>`;
    setStatus(`Error fetching service connections and agents: ${error.message}`, 'error');
  }
}

function renderServiceConnectionsTableBatch(loadMore = false) {
  const body = document.getElementById('serviceConnectionsTableBody');
  const container = document.getElementById('seeMoreServiceConnectionsContainer');
  const count = document.getElementById('serviceConnectionsRemainingCount');
  if (!body) return;

  const data = rawStore.serviceConnections || [];
  const start = loadMore ? rawStore.serviceConnectionsIndex : 0;
  const end = Math.min(start + PAGE_SIZE, data.length);
  if (!loadMore) body.innerHTML = '';

  data.slice(start, end).forEach(s => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td class="p-4 font-medium text-slate-800">${escapeHtml(s.name)}</td>
      <td class="p-4">${escapeHtml(s.type)}</td>
      <td class="p-4 max-w-[320px] truncate" title="${escapeHtml(s.url)}">${escapeHtml(s.url)}</td>
      <td class="p-4">${escapeHtml(s.isReady)}</td>
      <td class="p-4">${escapeHtml(s.isShared)}</td>
      <td class="p-4">${escapeHtml(s.createdBy)}</td>
      <td class="p-4">${escapeHtml(s.owner)}</td>`;
    body.appendChild(row);
  });

  rawStore.serviceConnectionsIndex = end;
  const remaining = Math.max(0, data.length - end);
  if (count) count.textContent = remaining;
  if (container) container.classList.toggle('hidden', remaining === 0);
  if (!data.length) body.innerHTML = '<tr><td colspan="7" class="p-4 text-center text-slate-400">No service connections found for this project.</td></tr>';
}

function renderAgentsTableBatch(loadMore = false) {
  const body = document.getElementById('agentsTableBody');
  const container = document.getElementById('seeMoreAgentsContainer');
  const count = document.getElementById('agentsRemainingCount');
  if (!body) return;

  const data = rawStore.agents || [];
  const start = loadMore ? rawStore.agentsIndex : 0;
  const end = Math.min(start + PAGE_SIZE, data.length);
  if (!loadMore) body.innerHTML = '';

  data.slice(start, end).forEach(a => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td class="p-4 font-medium text-slate-800">${escapeHtml(a.poolName)}</td>
      <td class="p-4">${escapeHtml(a.isHosted)}</td>
      <td class="p-4">${escapeHtml(a.poolType)}</td>
      <td class="p-4 font-medium">${escapeHtml(a.name)}</td>
      <td class="p-4">${escapeHtml(a.status)}</td>
      <td class="p-4">${escapeHtml(a.enabled)}</td>
      <td class="p-4">${escapeHtml(a.os)}</td>
      <td class="p-4">${escapeHtml(a.version)}</td>
      <td class="p-4">${escapeHtml(a.createdOn)}</td>
      <td class="p-4">${escapeHtml(a.currentJobOwner)}</td>`;
    body.appendChild(row);
  });

  rawStore.agentsIndex = end;
  const remaining = Math.max(0, data.length - end);
  if (count) count.textContent = remaining;
  if (container) container.classList.toggle('hidden', remaining === 0);
  if (!data.length) body.innerHTML = '<tr><td colspan="10" class="p-4 text-center text-slate-400">No agents found in the visible agent pools.</td></tr>';
}

function exportServiceConnectionsToXLSX() {
  const data = (rawStore.serviceConnections || []).map(s => ({
    "Service Connection": s.name,
    "Type": s.type,
    "URL": s.url,
    "Ready": s.isReady,
    "Shared": s.isShared,
    "Created By": s.createdBy,
    "Owner": s.owner
  }));
  exportToExcelFile({ "Service Connections": data }, "AzureDevOps_Service_Connections");
}

function exportAgentsToXLSX() {
  const data = (rawStore.agents || []).map(a => ({
    "Agent Pool": a.poolName,
    "Hosted": a.isHosted,
    "Pool Type": a.poolType,
    "Agent Name": a.name,
    "Status": a.status,
    "Enabled": a.enabled,
    "OS": a.os,
    "Version": a.version,
    "Created On": a.createdOn,
    "Current Job Owner": a.currentJobOwner
  }));
  exportToExcelFile({ "Agents": data }, "AzureDevOps_Agents");
}

function changeChartType(type) {
  currentChartType = type.toLowerCase() === 'pie' ? 'pie' : type;
  renderChart(currentChartData.labels, currentChartData.values, currentChartData.label);
}

function renderChart(labels, data, datasetLabel) {
  currentChartData = { labels, values: data, label: datasetLabel };
  const ctx = document.getElementById('analyticsChart').getContext('2d');
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
        padding: {
          top: isPie ? 10 : 25,
          bottom: 10
        }
      },
      plugins: {
        legend: { 
          display: isPie,
          position: 'right'
        },
        datalabels: {
          display: true,
          color: isPie ? '#ffffff' : '#1e293b',
          font: {
            weight: 'bold',
            size: 11
          },
          anchor: isPie ? 'center' : 'end',
          align: isPie ? 'center' : 'top',
          offset: isPie ? 0 : 2,
          formatter: function(value) {
            return value > 0 ? value : (isPie ? '' : '0');
          }
        }
      },
      scales: isPie ? {} : {
        y: { 
          beginAtZero: true, 
          grid: { color: '#f1f5f9' },
          ticks: { precision: 0 }
        },
        x: { 
          grid: { display: false },
          ticks: {
            autoSkip: false,
            maxRotation: 45,
            minRotation: 20
          }
        }
      }
    }
  });
}

document.addEventListener('DOMContentLoaded', function(){ 
  initCredentials(); 
  selectExplore('repositories'); 
});
