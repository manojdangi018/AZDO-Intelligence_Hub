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
