/*
 * Azure DevOps Service Connections & Agents
 * ------------------------------------------
 * Keeps all service-connection and agent-pool functionality isolated from
 * the main application module. Existing global functions/variables from
 * api.js and app.js are intentionally reused to preserve current behavior.
 */

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
    cards.forEach(card => {
      if (card) card.classList.remove('hidden');
    });
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
          // The agent endpoint is scoped to the pool ID. Prefer any pool name
          // exposed by the agent payload, then fall back to the canonical pool
          // object returned by /distributedtask/pools. This keeps the pool name
          // tied to the actual pool ID instead of the agent display name.
          poolId: pool.id,
          poolName: agent.pool?.name || agent.poolName || agent.properties?.poolName || pool.name || `Pool ${pool.id}`,
          isHosted: pool.isHosted === true ? 'Yes' : 'No',
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
          poolId: pool.id,
          poolName: pool.name || `Pool ${pool.id}`,
          isHosted: pool.isHosted === true ? 'Yes' : 'No',
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
    updateServiceAgentsOverview();

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

function exportServiceConnectionsAndAgentsToXLSX() {
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
