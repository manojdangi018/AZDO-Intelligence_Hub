/*
 * Azure DevOps Service Connections & Agents
 * ------------------------------------------
 * Project scope: service connections + agent pools connected to the selected project.
 * Organization scope: service connections aggregated across all loaded projects + all
 * organization agent pools.
 */

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"`]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;','`':'&#96;'}[ch]));
}

function displayIdentity(identity) {
  if (!identity) return '—';
  return identity.displayName || identity.uniqueName || identity.providerDisplayName || identity.id || '—';
}

function populateServiceAgentsScope(projects = []) {
  const select = document.getElementById('serviceAgentsScope');
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="">-- Organization Level (All Projects / All Agent Pools) --</option>';
  (projects || []).forEach(project => {
    const name = project.name || project;
    if (!name) return;
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  });
  if (current && [...select.options].some(o => o.value === current)) select.value = current;
}

function resetServiceAgentsScope() {
  const select = document.getElementById('serviceAgentsScope');
  if (select) select.innerHTML = '<option value="">-- Organization Level (All Projects / All Agent Pools) --</option>';
}

function getServiceAgentsScope() {
  const select = document.getElementById('serviceAgentsScope');
  return select ? select.value.trim() : '';
}

function syncServiceAgentsScopeToProject(projectName) {
  const select = document.getElementById('serviceAgentsScope');
  if (!select) return;

  const value = String(projectName || '').trim();
  if (!value) {
    select.value = '';
    return;
  }

  const optionExists = [...select.options].some(option => option.value === value);
  if (optionExists) select.value = value;
}

function clearServiceAgentsScopeToOrganization() {
  const select = document.getElementById('serviceAgentsScope');
  if (select) select.value = '';
}

function configureServiceAgentsOverview(isActive) {
  const chartSection = document.getElementById('chartSection');
  const kpiGrid = document.querySelector('.kpi-grid');
  const cards = [1, 2, 3, 4, 5].map(i => document.getElementById(`kpi-card-${i}`));

  if (chartSection) chartSection.classList.toggle('hidden', isActive);
  if (kpiGrid) kpiGrid.classList.toggle('serviceagents-kpi-grid', isActive);

  if (isActive) {
    cards.forEach((card, index) => {
      if (card) card.classList.toggle('hidden', index >= 3);
    });
    updateServiceAgentsOverview();
  } else {
    cards.forEach(card => { if (card) card.classList.remove('hidden'); });
    if (kpiGrid) kpiGrid.classList.remove('serviceagents-kpi-grid');
  }
}

function updateServiceAgentsOverview() {
  const validAgents = (rawStore.agents || []).filter(a => a.name && a.name !== 'Unable to read agents');
  const serviceConnectionCount = (rawStore.serviceConnections || []).length;
  const microsoftHostedCount = validAgents.filter(a => a.isHosted === 'Yes').length;
  const selfHostedCount = validAgents.filter(a => a.isHosted === 'No').length;

  const values = [serviceConnectionCount, microsoftHostedCount, selfHostedCount];
  const labels = ['Total Service Connections', 'Microsoft-hosted Agents', 'Self-hosted Agents'];
  const classes = [
    'text-2xl font-extrabold text-slate-800 mt-1 truncate',
    'text-2xl font-extrabold text-blue-600 mt-1',
    'text-2xl font-extrabold text-emerald-600 mt-1'
  ];

  for (let i = 0; i < 3; i++) {
    const label = document.getElementById(`kpi-${i + 1}-label`);
    const value = document.getElementById(`kpi-${i + 1}-val`);
    if (label) label.textContent = labels[i];
    if (value) {
      value.textContent = values[i];
      value.className = classes[i];
    }
  }
}

function mapServiceConnection(endpoint, projectName = '') {
  return {
    id: endpoint.id || '',
    name: endpoint.name || '—',
    type: endpoint.type || '—',
    url: endpoint.url || '—',
    isReady: endpoint.isReady === true ? 'Yes' : endpoint.isReady === false ? 'No' : '—',
    isShared: endpoint.isShared ? 'Yes' : 'No',
    createdBy: displayIdentity(endpoint.createdBy),
    projectName: projectName || endpoint.serviceEndpointProjectReferences?.[0]?.projectReference?.name || '—'
  };
}

async function fetchAgentsForPools(org, authHeader, pools) {
  const agentResults = await Promise.all((pools || []).map(async pool => {
    try {
      const agentsUrl = `https://dev.azure.com/${encodeURIComponent(org)}/_apis/distributedtask/pools/${pool.id}/agents?includeAssignedRequest=true&includeLastCompletedRequest=true&api-version=${AZDO_STABLE_API_VERSION}`;
      const agentData = await fetchAzDo(agentsUrl, authHeader);
      return (agentData.value || []).map(agent => ({
        poolId: pool.id,
        poolName: pool.name || agent.pool?.name || agent.poolName || agent.properties?.poolName || `Pool ${pool.id}`,
        isHosted: pool.isHosted === true ? 'Yes' : 'No',
        poolType: pool.poolType || '—',
        name: agent.name || '—',
        status: agent.status || '—',
        enabled: agent.enabled === true ? 'Yes' : agent.enabled === false ? 'No' : '—',
        os: agent.osDescription || '—',
        version: agent.version || '—',
        createdOn: agent.createdOn ? new Date(agent.createdOn).toLocaleString() : '—'
      }));
    } catch (error) {
      console.warn(`Could not fetch agents for pool ${pool.name || pool.id}:`, error);
      return [{
        poolId: pool.id,
        poolName: pool.name || `Pool ${pool.id}`,
        isHosted: pool.isHosted === true ? 'Yes' : 'No',
        poolType: pool.poolType || '—',
        name: 'Unable to read agents',
        status: error.message || 'Access denied',
        enabled: '—', os: '—', version: '—', createdOn: '—'
      }];
    }
  }));
  return agentResults.flat();
}

async function getProjectAgentPools(org, project, authHeader) {
  // Azure DevOps exposes agents at the organization/pool level.
  // A project is associated with pools through project agent queues.
  // Therefore project scope must be derived from queues, then only those
  // pool IDs are used to read agents. This prevents the organization-wide
  // /pools endpoint from becoming the source of the project result set.
  const projectInfoUrl = `https://dev.azure.com/${encodeURIComponent(org)}/_apis/projects/${encodeURIComponent(project)}?api-version=${AZDO_STABLE_API_VERSION}`;
  const queueUrl = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project)}/_apis/distributedtask/queues?api-version=${AZDO_STABLE_API_VERSION}`;

  const [projectInfo, queueData] = await Promise.all([
    fetchAzDo(projectInfoUrl, authHeader),
    fetchAzDo(queueUrl, authHeader)
  ]);

  const projectId = projectInfo.id ? String(projectInfo.id).toLowerCase() : '';
  const refs = (queueData.value || []).filter(queue => {
    // The project-scoped endpoint should already return project queues.
    // Keep the explicit projectId check as an additional safety guard.
    return !projectId || !queue.projectId || String(queue.projectId).toLowerCase() === projectId;
  });

  const poolRefs = new Map();
  refs.forEach(queue => {
    const pool = queue.pool;
    if (pool?.id !== undefined && pool?.id !== null) {
      poolRefs.set(String(pool.id), pool);
    }
  });

  const ids = [...poolRefs.keys()];
  if (!ids.length) return [];

  // Fetch only the pools connected to this project.
  const poolUrl = `https://dev.azure.com/${encodeURIComponent(org)}/_apis/distributedtask/pools?poolIds=${ids.join(',')}&api-version=${AZDO_STABLE_API_VERSION}`;
  const poolData = await fetchAzDo(poolUrl, authHeader);
  const poolById = new Map((poolData.value || []).map(pool => [String(pool.id), pool]));

  return ids.map(id => {
    const pool = poolById.get(id);
    const ref = poolRefs.get(id);
    return {
      ...(pool || {}),
      id: Number(id),
      name: pool?.name || ref?.name || `Pool ${id}`,
      isHosted: pool?.isHosted === true || ref?.isHosted === true,
      poolType: pool?.poolType || ref?.poolType || '—',
      projectId: projectId || ref?.scope || ''
    };
  });
}

async function getOrganizationProjects() {
  const projectSelect = document.getElementById('projectSelect');
  if (!projectSelect) return [];
  return [...projectSelect.options]
    .filter(option => option.value && !option.disabled)
    .map(option => ({ name: option.value }));
}

async function fetchOrganizationServiceConnections(org, authHeader, projects) {
  const results = await Promise.all((projects || []).map(async project => {
    try {
      const url = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(project.name)}/_apis/serviceendpoint/endpoints?api-version=${AZDO_STABLE_API_VERSION}`;
      const data = await fetchAzDo(url, authHeader);
      return (data.value || []).map(endpoint => mapServiceConnection(endpoint, project.name));
    } catch (error) {
      console.warn(`Could not fetch service connections for project ${project.name}:`, error);
      return [];
    }
  }));

  const byId = new Map();
  results.flat().forEach(connection => {
    if (connection.id && !byId.has(connection.id)) byId.set(connection.id, connection);
  });
  return [...byId.values()];
}

async function fetchServiceConnectionAgentData() {
  const org = extractOrgName(document.getElementById('targetOrg').value);
  const scopeProject = getServiceAgentsScope();
  const pat = document.getElementById('targetPat').value.trim();

  if (!org) return showModal('Please enter the Organization Name or URL first.', 'targetOrg');
  if (!pat) return showModal('Please enter your Personal Access Token (PAT).', 'targetPat');

  const authHeader = 'Basic ' + btoa(':' + pat);
  const serviceBody = document.getElementById('serviceConnectionsTableBody');
  const agentsBody = document.getElementById('agentsTableBody');
  if (serviceBody) serviceBody.innerHTML = '<tr><td colspan="6" class="p-4 text-center text-slate-400">Loading service connections...</td></tr>';
  if (agentsBody) agentsBody.innerHTML = '<tr><td colspan="9" class="p-4 text-center text-slate-400">Loading agent pools and agents...</td></tr>';

  const scopeText = scopeProject ? `project ${scopeProject}` : 'organization-wide';
  setStatus(`Fetching ${scopeText} service connections, agent pools and agents...`, 'info');

  try {
    let serviceConnections = [];
    let pools = [];

    if (scopeProject) {
      const serviceUrl = `https://dev.azure.com/${encodeURIComponent(org)}/${encodeURIComponent(scopeProject)}/_apis/serviceendpoint/endpoints?api-version=${AZDO_STABLE_API_VERSION}`;
      const [serviceData, projectPools] = await Promise.all([
        fetchAzDo(serviceUrl, authHeader),
        getProjectAgentPools(org, scopeProject, authHeader)
      ]);
      serviceConnections = (serviceData.value || []).map(endpoint => mapServiceConnection(endpoint, scopeProject));
      pools = projectPools;
    } else {
      const projects = await getOrganizationProjects();
      if (!projects.length) throw new Error('No projects are loaded. Load projects from the Azure DevOps connection first.');
      const [orgServiceConnections, poolData] = await Promise.all([
        fetchOrganizationServiceConnections(org, authHeader, projects),
        fetchAzDo(`https://dev.azure.com/${encodeURIComponent(org)}/_apis/distributedtask/pools?api-version=${AZDO_STABLE_API_VERSION}`, authHeader)
      ]);
      serviceConnections = orgServiceConnections;
      pools = poolData.value || [];
    }

    rawStore.serviceConnections = serviceConnections;
    rawStore.serviceConnectionsIndex = 0;
    rawStore.agents = await fetchAgentsForPools(org, authHeader, pools);
    rawStore.agentsIndex = 0;

    renderServiceConnectionsTableBatch(false);
    renderAgentsTableBatch(false);
    updateServiceAgentsOverview();

    const validAgents = rawStore.agents.filter(a => a.name !== 'Unable to read agents');
    setStatus(`Loaded ${serviceConnections.length} service connections, ${pools.length} agent pools and ${validAgents.length} agents (${scopeText}).`, 'success');
  } catch (error) {
    if (serviceBody) serviceBody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-red-500">${escapeHtml(error.message)}</td></tr>`;
    if (agentsBody) agentsBody.innerHTML = `<tr><td colspan="9" class="p-4 text-center text-red-500">${escapeHtml(error.message)}</td></tr>`;
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
      <td class="p-4">${escapeHtml(s.createdBy)}</td>`;
    body.appendChild(row);
  });

  rawStore.serviceConnectionsIndex = end;
  const remaining = Math.max(0, data.length - end);
  if (count) count.textContent = remaining;
  if (container) container.classList.toggle('hidden', remaining === 0);
  if (!data.length) body.innerHTML = '<tr><td colspan="6" class="p-4 text-center text-slate-400">No service connections found for the selected scope.</td></tr>';
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
      <td class="p-4">${escapeHtml(a.createdOn)}</td>`;
    body.appendChild(row);
  });

  rawStore.agentsIndex = end;
  const remaining = Math.max(0, data.length - end);
  if (count) count.textContent = remaining;
  if (container) container.classList.toggle('hidden', remaining === 0);
  if (!data.length) body.innerHTML = '<tr><td colspan="9" class="p-4 text-center text-slate-400">No agents found in the selected scope.</td></tr>';
}

function exportServiceConnectionsToXLSX() {
  const data = (rawStore.serviceConnections || []).map(s => ({
    'Service Connection': s.name,
    'Type': s.type,
    'URL': s.url,
    'Ready': s.isReady,
    'Shared': s.isShared,
    'Created By': s.createdBy,
    ...(s.projectName && s.projectName !== '—' ? {'Project': s.projectName} : {})
  }));
  exportToExcelFile({ 'Service Connections': data }, 'AzureDevOps_Service_Connections');
}

function exportAgentsToXLSX() {
  const data = (rawStore.agents || []).map(a => ({
    'Agent Pool': a.poolName,
    'Hosted': a.isHosted,
    'Pool Type': a.poolType,
    'Agent Name': a.name,
    'Status': a.status,
    'Enabled': a.enabled,
    'OS': a.os,
    'Version': a.version,
    'Created On': a.createdOn
  }));
  exportToExcelFile({ 'Agents': data }, 'AzureDevOps_Agents');
}

function exportServiceConnectionsAndAgentsToXLSX() {
  exportToExcelFile({
    'Service Connections': (rawStore.serviceConnections || []).map(s => ({
      'Service Connection': s.name,
      'Type': s.type,
      'URL': s.url,
      'Ready': s.isReady,
      'Shared': s.isShared,
      'Created By': s.createdBy,
      ...(s.projectName && s.projectName !== '—' ? {'Project': s.projectName} : {})
    })),
    'Agents': (rawStore.agents || []).map(a => ({
      'Agent Pool': a.poolName,
      'Hosted': a.isHosted,
      'Pool Type': a.poolType,
      'Agent Name': a.name,
      'Status': a.status,
      'Enabled': a.enabled,
      'OS': a.os,
      'Version': a.version,
      'Created On': a.createdOn
    }))
  }, 'AzureDevOps_ServiceConnections_Agents');
}
