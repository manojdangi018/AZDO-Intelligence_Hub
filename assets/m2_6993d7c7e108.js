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
let rawStore = {
repos: [], repoIndex: 0,
repoPrs: [], repoPrsIndex: 0,
access: [], accessIndex: 0,
commits: [], commitsIndex: 0,
pipelines: [], pipelineIndex: 0,
pipelineSummaries: [], pipelineSummariesIndex: 0,
workitems: [], workitemsIndex: 0,
serviceConnections: [], serviceConnectionsIndex: 0,
agents: [], agentsIndex: 0,
agentPools: [],
userEntitlements: [], userDirectoryIndex: 0
};
let workspaceDisplayStore = {};
window.__getAzdoRawStore = () => rawStore;
function sortByLatestDate(items, dateKeys = []) {
if (!Array.isArray(items) || items.length < 2) return items;
const keys = Array.isArray(dateKeys) ? dateKeys : [dateKeys];
const getTimestamp = (item) => {
if (!item || typeof item !== 'object') return null;
for (const key of keys) {
const value = item[key];
if (value === undefined || value === null || value === '' || value === '—' || value === 'N/A') continue;
if (typeof value === 'number' && Number.isFinite(value)) return value;
const date = value instanceof Date ? value : new Date(value);
const time = date.getTime();
if (Number.isFinite(time)) return time;
}
return null;
};
const sorted = items
.map((item, originalIndex) => ({ item, originalIndex, timestamp: getTimestamp(item) }))
.sort((a, b) => {
const aHasDate = a.timestamp !== null;
const bHasDate = b.timestamp !== null;
if (aHasDate && bHasDate) {
const diff = b.timestamp - a.timestamp;
return diff !== 0 ? diff : a.originalIndex - b.originalIndex;
}
if (aHasDate) return -1;
if (bHasDate) return 1;
return a.originalIndex - b.originalIndex;
})
.map(entry => entry.item);
items.splice(0, items.length, ...sorted);
return items;
}
window.sortByLatestDate = sortByLatestDate;
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
case 'users':
return (rawStore.userEntitlements?.length || 0) > 0;
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
const statusBarEl = document.getElementById('statusBar');
const statusMsg = statusBarEl && !statusBarEl.classList.contains('hidden') ? statusBarEl.textContent : '';
workspaceDisplayStore[category] = {
kpis,
statusMsg,
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
service_agents: [['Total Service Connections', '0'], ['Microsoft-hosted Pools', '0'], ['Self-hosted Agents', '0']],
users: [['Total Users', '0'], ['Active Users', '0'], ['Basic / Stakeholder', '0'], ['Project Access', '0'], ['Scope', 'Organization']]
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
setStatus('');
if (typeof renderChart === 'function') {
renderChart([], [], 'Overview');
}
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
if (state.statusMsg) {
setStatus(state.statusMsg, 'success');
} else {
setStatus('');
}
if (state.chart) {
currentChartType = state.chart.type || 'bar';
if (typeof renderChart === 'function') {
renderChart(state.chart.labels || [], state.chart.values || [], state.chart.label || 'Overview');
}
} else {
if (typeof renderChart === 'function') {
renderChart([], [], 'Overview');
}
}
}
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
if (!msg) {
el.classList.add('hidden');
el.textContent = '';
return;
}
el.classList.remove('hidden', 'bg-red-50', 'text-red-700', 'bg-green-50', 'text-green-700', 'bg-blue-50', 'text-blue-700');
if (type === 'error') el.classList.add('bg-red-50', 'text-red-700');
else if (type === 'success') el.classList.add('bg-green-50', 'text-green-700');
else el.classList.add('bg-blue-50', 'text-blue-700');
const partial = type === 'success' ? getAzDoPartialResultMessage() : '';
el.textContent = `${msg || ''}${partial}`;
if (typeof renderCancelFetchButton === 'function') renderCancelFetchButton();
if (typeof renderAzDoProgressPanel === 'function' && azdoApiRunActive) renderAzDoProgressPanel();
}
function renderCancelFetchButton() {
const statusBar = document.getElementById('statusBar');
if (!statusBar || !azdoActiveAbortController || azdoActiveAbortController.signal.aborted) return;
let btn = document.getElementById('btnCancelAzDoFetch');
if (!btn) {
  btn = document.createElement('button');
  btn.id = 'btnCancelAzDoFetch';
  btn.type = 'button';
  btn.className = 'ml-3 inline-flex items-center rounded bg-red-600 px-3 py-1 text-xs font-semibold text-white hover:bg-red-700';
  btn.textContent = 'Cancel';
  btn.addEventListener('click', () => cancelAzDoOperation());
  statusBar.appendChild(btn);
}
}
function legacyStartFetching(message) {
const controller = beginAzDoOperation();
setStatus(message, 'info');
document.getElementById('statusBar')?.classList.add('fetching');
renderCancelFetchButton();
return { id: azdoApiRunState?.id || 0, signal: controller.signal };
}
function legacyStopFetching() {
document.getElementById('statusBar')?.classList.remove('fetching');
document.getElementById('btnCancelAzDoFetch')?.remove();
azdoActiveAbortController = null;
azdoApiRunActive = false;
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
if (savedOrg) document.getElementById('targetOrg').value = savedOrg;
if (savedOrg) document.getElementById('chkRememberCreds').checked = true;
handleOrgChange();
}
function toggleRememberCreds() {
const isChecked = document.getElementById('chkRememberCreds').checked;
if (isChecked) {
localStorage.setItem('azdo_org', document.getElementById('targetOrg').value.trim());
} else {
localStorage.removeItem('azdo_org');
}
}
function handleOrgChange() {
const org = extractOrgName(document.getElementById('targetOrg').value);
updatePathPreview(org);
const projectBadge = document.getElementById('overviewProjectBadge');
if (projectBadge) projectBadge.textContent = '—';
resetDropdown('projectSelect', '-- Load PAT first --');
if (typeof resetServiceAgentsScope === 'function') resetServiceAgentsScope();
document.getElementById('step5Container').classList.add('hidden');
if (document.getElementById('chkRememberCreds').checked) {
localStorage.setItem('azdo_org', document.getElementById('targetOrg').value.trim());
}
setConnectionBadge(false);
}
function resetDropdown(id, placeholder) {
const el = document.getElementById(id);
setSafeInnerHTML(el, `<option value="">${placeholder}</option>`);
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
const loadBtn = document.getElementById('btnLoadProjects');
if (loadBtn) {
loadBtn.disabled = true;
loadBtn.textContent = 'Loading projects...';
loadBtn.classList.add('loading');
}
if (document.getElementById('chkRememberCreds').checked) {
localStorage.setItem('azdo_org', org);
}
const authHeader = createBasicAuthHeader(pat);
beginAzDoOperation();
setStatus(`Loading projects from https://dev.azure.com/${org}...`, 'info');
try {
const url = `https://dev.azure.com/${org}/_apis/projects?api-version=${API_VERSION}&$top=500`;
const data = await fetchAzDoPaged(url, authHeader, { pageSize: 500 });
const projects = data.value || [];
const projDropdown = document.getElementById('projectSelect');
setSafeInnerHTML(projDropdown, '<option value="">-- Select a Project --</option>');
projects.forEach(p => {
const opt = document.createElement('option');
opt.value = p.name;
opt.textContent = p.name;
projDropdown.appendChild(opt);
});
enableDropdown('projectSelect');
updateProjectRequirementUI();
document.getElementById('step5Container').classList.add('hidden');
sessionStorage.setItem('azdo_workspace_active', 'true');
sessionStorage.setItem('azdo_session_org', org);
setConnectionBadge(true);
showWorkspacePage();
const projStatus = document.getElementById('projectStatusMsg');
if (projStatus) {
projStatus.textContent = `Loaded ${projects.length} projects successfully! Please choose a project.`;
projStatus.classList.remove('hidden');
}
const statusBar = document.getElementById('statusBar');
if (statusBar) {
statusBar.classList.add('hidden');
statusBar.textContent = '';
}
} catch (err) {
setStatus(`Error loading projects: ${err.message}`, 'error');
setConnectionBadge(false);
} finally {
if (loadBtn) {
loadBtn.disabled = false;
loadBtn.textContent = 'Load projects';
loadBtn.classList.remove('loading');
}
}
}
function updateProjectRequirementUI() {
const mark = document.getElementById('projectRequiredMark');
const note = document.getElementById('projectRequirementText');
const select = document.getElementById('projectSelect');
const serviceAgentsActive = activeCategory === 'service_agents';
const usersActive = activeCategory === 'users';
const projectOptional = serviceAgentsActive || usersActive;
if (mark) mark.classList.toggle('hidden', projectOptional);
if (note) {
note.textContent = serviceAgentsActive
? 'Project is optional for Service Connections & Agent Pools. Leave it blank for organization-wide information.'
: usersActive
? 'Project is optional for User Directory. Leave it blank for organization-wide users, or select a project for project-level access.'
: 'Project selection is required for Repositories, Access & Teams, User Activity, Pipelines & Builds, and Work Items.';
}
if (select) select.setAttribute('aria-required', projectOptional ? 'false' : 'true');
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
const org = extractOrgName(document.getElementById('targetOrg').value);
const project = document.getElementById('projectSelect').value;
const pat = document.getElementById('targetPat').value.trim();
updateProjectRequirementUI();
setStatus('');
if (!project) {
if (activeCategory === 'service_agents') {
updatePathPreview(org);
if (typeof updateServiceAgentsScopeText === 'function') updateServiceAgentsScopeText();
renderActiveSubstep();
} else if (activeCategory === 'users') {
updatePathPreview(org);
if (typeof updateUserDirectoryScopeText === 'function') updateUserDirectoryScopeText();
renderActiveSubstep();
} else {
document.getElementById('step5Container').classList.add('hidden');
updatePathPreview(org);
}
return;
}
updatePathPreview(org, project);
if (typeof updateServiceAgentsScopeText === 'function') updateServiceAgentsScopeText();
const projectBadge = document.getElementById('overviewProjectBadge');
if (projectBadge) projectBadge.textContent = project || '—';
sessionStorage.setItem('azdo_session_project', project);
const authHeader = createBasicAuthHeader(pat);
try {
const url = `https://dev.azure.com/${org}/${project}/_apis/git/repositories?api-version=${API_VERSION}`;
const data = await fetchAzDoPaged(url, authHeader, { pageSize: 500 });
cachedRepos = data.value || [];
} catch (e) {
console.warn('Could not prefetch repos:', e);
}
renderActiveSubstep();
}
function renderActiveSubstep() {
updateProjectRequirementUI();
const project = document.getElementById('projectSelect').value;
const step5 = document.getElementById('step5Container');
const subRepo = document.getElementById('substepRepo');
const subAccess = document.getElementById('substepAccess');
const subActivity = document.getElementById('substepActivity');
const subPipelines = document.getElementById('substepPipelines');
const subWorkItems = document.getElementById('substepWorkItems');
const subServiceAgents = document.getElementById('substepServiceAgents');
const subUsers = document.getElementById('substepUsers');
if (!project && !['service_agents', 'users'].includes(activeCategory)) {
step5.classList.add('hidden');
return;
}
step5.classList.remove('hidden');
[subRepo, subAccess, subActivity, subPipelines, subWorkItems, subServiceAgents, subUsers].forEach(el => el?.classList.add('hidden'));
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
if (typeof updateServiceAgentsScopeText === 'function') updateServiceAgentsScopeText();
} else if (activeCategory === 'users') {
subUsers.classList.remove('hidden');
if (typeof updateUserDirectoryScopeText === 'function') updateUserDirectoryScopeText();
} else if (activeCategory === 'work_items') {
subWorkItems.classList.remove('hidden');
}
}
function showSection(viewId) {
activeViewSection = `view-${viewId}`;
refreshTableControlScope?.();
['repositories', 'access', 'activity', 'pipelines', 'serviceagents', 'users', 'workitems'].forEach(v => {
document.getElementById(`view-${v}`).classList.toggle('hidden', v !== viewId);
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
service_agents: 'serviceagents',
users: 'users'
};
const viewId = viewMap[category] || 'repositories';
document.querySelectorAll('.sidebar-item').forEach(btn => {
btn.classList.toggle('active', btn.dataset.view === viewId);
});
if (typeof showSection === 'function') showSection(viewId);
if (typeof configureServiceAgentsOverview === 'function') {
configureServiceAgentsOverview(viewId === 'serviceagents');
}
renderActiveSubstep();
restoreWorkspaceDisplayState(category);
refreshTableControlScope();
wireTableHeaderSorting();
applyTableUx();
renderAdvancedDashboard();
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
agents: [], agentsIndex: 0,
agentPools: [],
userEntitlements: [], userDirectoryIndex: 0
};
cachedRepos = [];
workspaceDisplayStore = {};
document.getElementById('targetPat').value = '';
resetDropdown('projectSelect', '-- Load PAT first --');
if (typeof resetServiceAgentsScope === 'function') resetServiceAgentsScope();
document.getElementById('step5Container').classList.add('hidden');
document.getElementById('overviewProjectBadge').textContent = '—';
const projStatus = document.getElementById('projectStatusMsg');
if (projStatus) {
projStatus.textContent = '';
projStatus.classList.add('hidden');
}
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
setSafeInnerHTML(document.getElementById('branchesTableBody'), `<tr><td colspan="7" class="p-4 text-center text-slate-400">Select a project & repository to inspect.</td></tr>`);
setSafeInnerHTML(document.getElementById('policyBranchesTableBody'), `<tr><td colspan="6" class="p-4 text-center text-slate-400">Select a project & repository to inspect.</td></tr>`);
setSafeInnerHTML(document.getElementById('repoPrsTableBody'), `<tr><td colspan="7" class="p-4 text-center text-slate-400">Select a project & repository to inspect.</td></tr>`);
setSafeInnerHTML(document.getElementById('accessTableBody'), `<tr><td colspan="4" class="p-4 text-center text-slate-400">Enter a User ID or click "Fetch User Access" to load access permissions.</td></tr>`);
setSafeInnerHTML(document.getElementById('userCommitsTableBody'), `<tr><td colspan="5" class="p-4 text-center text-slate-400">Enter a user email/ID and click search.</td></tr>`);
setSafeInnerHTML(document.getElementById('userPrTableBody'), `<tr><td colspan="5" class="p-4 text-center text-slate-400">No pull request activity loaded.</td></tr>`);
setSafeInnerHTML(document.getElementById('pipelineSummaryTableBody'), `<tr><td colspan="7" class="p-4 text-center text-slate-400">Click "Fetch Pipeline Runs" to scan pipeline definitions.</td></tr>`);
setSafeInnerHTML(document.getElementById('pipelineTableBody'), `<tr><td colspan="7" class="p-4 text-center text-slate-400">No build runs loaded.</td></tr>`);
setSafeInnerHTML(document.getElementById('workItemsTableBody'), `<tr><td colspan="6" class="p-4 text-center text-slate-400">Query work items to view backlog.</td></tr>`);
const serviceConnectionsBody = document.getElementById('serviceConnectionsTableBody');
if (serviceConnectionsBody) setSafeInnerHTML(serviceConnectionsBody, `<tr><td colspan="6" class="p-4 text-center text-slate-400">Click "Fetch Connections &amp; Agents" to load service connections.</td></tr>`);
const agentsBody = document.getElementById('agentsTableBody');
if (agentsBody) setSafeInnerHTML(agentsBody, `<tr><td colspan="9" class="p-4 text-center text-slate-400">Click "Fetch Connections &amp; Agents" to load agent pools and agents.</td></tr>`);
['seeMoreRepoContainer', 'seeMorePolicyBranchesContainer', 'seeMoreRepoPrsContainer', 'seeMoreAccessContainer', 'seeMoreCommitsContainer', 'seeMorePipelineSummaryContainer', 'seeMorePipelinesContainer', 'seeMoreWorkItemsContainer', 'seeMoreServiceConnectionsContainer', 'seeMoreAgentsContainer'].forEach(id => {
const el = document.getElementById(id);
if (el) el.classList.add('hidden');
});
renderChart([], [], 'Overview');
setConnectionBadge(false);
sessionStorage.removeItem('azdo_workspace_active');
sessionStorage.removeItem('azdo_session_org');
sessionStorage.removeItem('azdo_session_project');
sessionStorage.removeItem('azdo_session_category');
const loadBtn = document.getElementById('btnLoadProjects');
if (loadBtn) {
loadBtn.disabled = false;
loadBtn.textContent = 'Load projects';
loadBtn.classList.remove('loading');
}
document.documentElement.classList.remove('restore-workspace-page');
showConnectionPage();
setStatus('Disconnected from Azure DevOps. Enter credentials to connect again.', 'info');
}
function __originalStartFetching(message) {
const controller = beginAzDoOperation();
setStatus(message, 'info');
document.getElementById('statusBar')?.classList.add('fetching');
renderCancelFetchButton();
return { id: azdoApiRunState?.id || 0, signal: controller.signal };
}
function __originalStopFetching() {
document.getElementById('statusBar')?.classList.remove('fetching');
document.getElementById('btnCancelAzDoFetch')?.remove();
azdoActiveAbortController = null;
azdoApiRunActive = false;
}
const tableUxState = {
  query: '',
  scope: 'all',
  sortColumn: '',
  sortDirection: 'asc',
  status: 'all',
  dateFrom: '',
  dateTo: ''
};
let tableUxObserver = null;
let tableUxApplying = false;
let tableUxProgressTimer = null;

function getActiveTables() {
  const activeSection = document.getElementById(activeViewSection);
  return activeSection ? [...activeSection.querySelectorAll('table')] : [];
}
function getTableLabel(table) {
  if (!table) return 'Table';
  const heading = table.closest('.bg-white')?.querySelector('h3');
  return String(heading?.textContent || table.id || 'Table').trim();
}
function refreshTableControlScope() {
  const scopeEl = document.getElementById('tableFilterScope');
  if (!scopeEl) return;
  const tables = getActiveTables();
  const current = tableUxState.scope;
  const options = [{ value: 'all', label: 'All Tables' }];
  tables.forEach(table => options.push({ value: table.id, label: getTableLabel(table) }));
  scopeEl.innerHTML = options.map(o => `<option value="${escapeHtml(o.value)}">Filter: ${escapeHtml(o.label)}</option>`).join('');
  scopeEl.value = options.some(o => o.value === current) ? current : 'all';
  tableUxState.scope = scopeEl.value;
  refreshSortOptions();
  refreshStatusOptions();
}
function refreshSortOptions() {
  const sortEl = document.getElementById('tableSortColumn');
  if (!sortEl) return;
  const tables = getActiveTables().filter(t => tableUxState.scope === 'all' || t.id === tableUxState.scope);
  const seen = new Set();
  const options = [{ value: '', label: 'Sort by column...' }];
  tables.forEach(table => table.querySelectorAll('thead th').forEach((th, idx) => {
    const label = String(th.textContent || '').replace(/\s+/g, ' ').trim();
    if (!label || seen.has(label.toLowerCase())) return;
    seen.add(label.toLowerCase());
    options.push({ value: label, label });
  }));
  sortEl.innerHTML = options.map(o => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join('');
  sortEl.value = options.some(o => o.value === tableUxState.sortColumn) ? tableUxState.sortColumn : '';
  tableUxState.sortColumn = sortEl.value;
}
function refreshStatusOptions() {
  const statusEl = document.getElementById('tableStatusFilter');
  if (!statusEl) return;
  const tables = getActiveTables().filter(t => tableUxState.scope === 'all' || t.id === tableUxState.scope);
  const values = new Set();
  const statusHeaderPattern = /status|result|health|state|ready|enabled|access|trigger/i;
  tables.forEach(table => {
    const headers = [...table.querySelectorAll('thead th')].map(th => String(th.textContent || '').trim());
    const statusIndexes = headers.map((h,i) => statusHeaderPattern.test(h) ? i : -1).filter(i => i >= 0);
    table.querySelectorAll('tbody tr').forEach(row => {
      statusIndexes.forEach(i => {
        const cell = row.children[i];
        const value = String(cell?.textContent || '').replace(/\s+/g, ' ').trim();
        if (value && value.length <= 60) values.add(value);
      });
    });
  });
  const preferred = ['Succeeded','Failed','Partially Succeeded','Canceled','In Progress','Not Started','Active','Stale','Ready','Not Ready','Enabled','Disabled','New','Resolved','Closed','Done'];
  const sorted = [...values].sort((a,b) => {
    const ai = preferred.findIndex(v => v.toLowerCase() === a.toLowerCase());
    const bi = preferred.findIndex(v => v.toLowerCase() === b.toLowerCase());
    if (ai >= 0 || bi >= 0) return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
    return a.localeCompare(b);
  }).slice(0, 30);
  const options = [{ value: 'all', label: 'Status: All' }, ...sorted.map(v => ({value:v,label:v}))];
  statusEl.innerHTML = options.map(o => `<option value="${escapeHtml(o.value)}">${escapeHtml(o.label)}</option>`).join('');
  statusEl.value = options.some(o => o.value === tableUxState.status) ? tableUxState.status : 'all';
  tableUxState.status = statusEl.value;
}
function parseUxDate(value) {
  const text = String(value || '').trim();
  if (!text || text === '—' || text === 'N/A') return null;
  let m = text.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
    return Number.isFinite(d.getTime()) ? d : null;
  }
  m = text.match(/^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const d = new Date(text);
  return Number.isFinite(d.getTime()) ? d : null;
}
function getRowDate(table, row) {
  const headers = [...table.querySelectorAll('thead th')].map(th => String(th.textContent || '').replace(/\s+/g,' ').trim());
  const dateIndexes = headers.map((h,i) => /date|time|created|changed|access|finish|commit/i.test(h) ? i : -1).filter(i => i >= 0);
  for (const i of dateIndexes) {
    const d = parseUxDate(row.children[i]?.textContent || '');
    if (d) return d;
  }
  return null;
}
function normalizeSortValue(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  const n = Number(raw.replace(/[%#,\s]/g,''));
  if (raw !== '' && Number.isFinite(n) && /^[-+]?\d[\d,\s]*(?:\.\d+)?%?$/.test(raw)) return {type:'number', value:n};
  const d = parseUxDate(raw);
  if (d) return {type:'date', value:d.getTime()};
  return {type:'text', value:raw.toLowerCase()};
}
function applyTableUx() {
  if (tableUxApplying) return;
  tableUxApplying = true;
  try {
    const tables = getActiveTables();
    const q = String(tableUxState.query || '').trim().toLowerCase();
    const from = tableUxState.dateFrom ? new Date(`${tableUxState.dateFrom}T00:00:00`) : null;
    const to = tableUxState.dateTo ? new Date(`${tableUxState.dateTo}T23:59:59.999`) : null;
    tables.forEach(table => {
      const isTarget = tableUxState.scope === 'all' || table.id === tableUxState.scope;
      const headers = [...table.querySelectorAll('thead th')].map(th => String(th.textContent || '').replace(/\s+/g,' ').trim());
      let sortIndex = -1;
      if (tableUxState.sortColumn) {
        sortIndex = headers.findIndex(h => h.toLowerCase() === tableUxState.sortColumn.toLowerCase());
      }
      const rows = [...table.querySelectorAll('tbody tr')].filter(r => r.children.length > 1);
      rows.forEach(row => {
        if (!isTarget) { row.style.display = ''; return; }
        const text = row.textContent.toLowerCase();
        const statusMatch = tableUxState.status === 'all' || text.includes(String(tableUxState.status).toLowerCase());
        const queryMatch = !q || text.includes(q);
        const rowDate = getRowDate(table, row);
        const dateMatch = (!from || (rowDate && rowDate >= from)) && (!to || (rowDate && rowDate <= to));
        row.style.display = queryMatch && statusMatch && dateMatch ? '' : 'none';
      });
      if (isTarget && sortIndex >= 0) {
        const tbody = table.querySelector('tbody');
        const sortedRows = rows.slice().sort((a,b) => {
          const av = normalizeSortValue(a.children[sortIndex]?.textContent || '');
          const bv = normalizeSortValue(b.children[sortIndex]?.textContent || '');
          if (av.value === bv.value) return 0;
          if (av.type === bv.type) return av.value < bv.value ? -1 : 1;
          return String(av.value).localeCompare(String(bv.value));
        });
        if (tableUxState.sortDirection === 'desc') sortedRows.reverse();
        sortedRows.forEach(r => tbody.appendChild(r));
      }
      const ths = table.querySelectorAll('thead th');
      ths.forEach(th => {
        th.classList.add('table-sortable');
        const label = String(th.textContent || '').replace(/[▲▼]$/,'').replace(/\s+/g,' ').trim();
        th.setAttribute('title', 'Click to sort this column');
        th.dataset.sortLabel = label;
        const existing = th.querySelector('.table-sort-indicator');
        if (existing) existing.remove();
        if (tableUxState.sortColumn && label.toLowerCase() === tableUxState.sortColumn.toLowerCase()) {
          const indicator = document.createElement('span');
          indicator.className = 'table-sort-indicator';
          indicator.textContent = tableUxState.sortDirection === 'asc' ? ' ▲' : ' ▼';
          th.appendChild(indicator);
        }
      });
    });
    updateTableUxCounts();
  } finally { tableUxApplying = false; }
}
function updateTableUxCounts() {
  const countEl = document.getElementById('tableVisibleCount');
  const hiddenEl = document.getElementById('tableHiddenCount');
  if (!countEl || !hiddenEl) return;
  let visible = 0, hidden = 0;
  getActiveTables().forEach(table => table.querySelectorAll('tbody tr').forEach(row => {
    if (row.children.length <= 1) return;
    if (row.style.display === 'none') hidden += 1; else visible += 1;
  }));
  countEl.textContent = String(visible);
  hiddenEl.textContent = String(hidden);
}
function filterActiveTable() {
  tableUxState.query = document.getElementById('tableFilterInput')?.value || '';
  tableUxState.scope = document.getElementById('tableFilterScope')?.value || 'all';
  tableUxState.status = document.getElementById('tableStatusFilter')?.value || 'all';
  tableUxState.dateFrom = document.getElementById('tableDateFrom')?.value || '';
  tableUxState.dateTo = document.getElementById('tableDateTo')?.value || '';
  applyTableUx();
}
function sortActiveTableColumn(label) {
  if (!label) return;
  if (tableUxState.sortColumn.toLowerCase() === String(label).toLowerCase()) {
    tableUxState.sortDirection = tableUxState.sortDirection === 'asc' ? 'desc' : 'asc';
  } else {
    tableUxState.sortColumn = String(label);
    tableUxState.sortDirection = 'asc';
  }
  const sortEl = document.getElementById('tableSortColumn');
  if (sortEl) sortEl.value = tableUxState.sortColumn;
  applyTableUx();
}
function clearTableUxFilters() {
  tableUxState.query = ''; tableUxState.status = 'all'; tableUxState.dateFrom = ''; tableUxState.dateTo = '';
  tableUxState.sortColumn = ''; tableUxState.sortDirection = 'asc';
  ['tableFilterInput','tableDateFrom','tableDateTo'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
  const statusEl=document.getElementById('tableStatusFilter'); if(statusEl) statusEl.value='all';
  const sortEl=document.getElementById('tableSortColumn'); if(sortEl) sortEl.value='';
  applyTableUx();
}
function wireTableHeaderSorting() {
  getActiveTables().forEach(table => table.querySelectorAll('thead th').forEach(th => {
    if (th.dataset.uxSortBound === 'true') return;
    th.dataset.uxSortBound = 'true';
    th.addEventListener('click', () => sortActiveTableColumn(th.dataset.sortLabel || th.textContent));
  }));
}
function initTableUxObserver() {
  if (tableUxObserver) tableUxObserver.disconnect();
  const container = document.querySelector('.dashboard-content');
  if (!container || typeof MutationObserver === 'undefined') return;
  tableUxObserver = new MutationObserver(() => {
    if (tableUxApplying) return;
    clearTimeout(tableUxObserver._timer);
    tableUxObserver._timer = setTimeout(() => {
      refreshSortOptions(); refreshStatusOptions(); wireTableHeaderSorting(); applyTableUx();
    }, 60);
  });
  tableUxObserver.observe(container, { childList: true, subtree: true });
}
function getAdvancedDashboardMetrics(category) {
  const rs = rawStore;
  if (category === 'repositories') {
    const branches = rs.repos || [], prs = rs.repoPrs || [];
    const stale = branches.filter(x => x.isStale).length;
    const policy = branches.filter(x => x.hasPolicy).length;
    return [
      ['Branches Scanned', branches.length, 'Total branch records'],
      ['Stale Branches', stale, branches.length ? `${Math.round(stale / branches.length * 100)}% of branches` : 'No branch data'],
      ['Policy Coverage', branches.length ? `${Math.round(policy / branches.length * 100)}%` : '0%', `${policy} branches with policy`],
      ['Open PRs', prs.filter(x => /active|open/i.test(String(x.status||''))).length, `${prs.length} PR records loaded`]
    ];
  }
  if (category === 'pipelines') {
    const p = rs.pipelineSummaries || [], runs = rs.pipelines || [];
    const total = p.reduce((a,x)=>a+(Number(x.total)||0),0), success=p.reduce((a,x)=>a+(Number(x.succeeded)||0),0), failed=p.reduce((a,x)=>a+(Number(x.failed)||0),0), auto=p.reduce((a,x)=>a+(Number(x.autoTriggers)||0),0);
    return [['Pipelines',p.length,'Unique pipeline identities'],['Success Rate',total?`${Math.round(success/total*100)}%`:'0%',`${success} successful / ${total} scanned`],['Failed / Other',failed,`${runs.length} run records loaded`],['Auto Trigger Rate',total?`${Math.round(auto/total*100)}%`:'0%',`${auto} automatic triggers`]];
  }
  if (category === 'work_items') {
    const w=rs.workitems||[]; const active=w.filter(x=>/active|new|todo|to do/i.test(String(x.state||''))).length; const progress=w.filter(x=>/progress|doing/i.test(String(x.state||''))).length;
    return [['Work Items',w.length,'Records loaded'],['Active / New',active,`${w.length?Math.round(active/w.length*100):0}% of records`],['In Progress',progress,'Based on process state category'],['Types',new Set(w.map(x=>x.type).filter(Boolean)).size,'Work item types']];
  }
  if (category === 'service_agents') {
    const c=rs.serviceConnections||[], a=(rs.agents||[]).filter(x=>!x.isSyntheticHosted && x.name && x.name!=='Unable to read agents'), pools=rs.agentPools||[];
    return [['Service Connections',c.length,'Loaded connections'],['Agent Pools',pools.length,'Visible pools'],['Self-hosted Agents',a.length,'Real agents'],['Not Ready',a.filter(x=>/offline|not ready|disabled/i.test(`${x.status} ${x.enabled}`)).length,'Review agent health']];
  }
  if (category === 'user_activity') {
    const c=rs.commits||[], p=rs.repoPrs||[]; return [['Commits',c.length,'User activity records'],['Pull Requests',p.length,'User PR records'],['Repositories',new Set(c.map(x=>x.repo).filter(Boolean)).size,'Repositories touched'],['Branches',new Set(c.map(x=>x.branch).filter(Boolean)).size,'Branches associated']];
  }
  if (category === 'user_access') {
    const a=rs.access||[]; return [['Memberships',a.length,'Access records'],['Groups / Teams',new Set(a.map(x=>x.team).filter(Boolean)).size,'Unique security containers'],['Users',new Set(a.map(x=>x.email||x.name).filter(Boolean)).size,'Unique identities'],['Permission Warnings',getAzDoProgressState?.().permissionWarnings||0,'403/401 responses']];
  }
  if (category === 'users') {
    const u=rs.userEntitlements||[]; const active=u.filter(x=>/active/i.test(String(x.status||''))).length; return [['Users',u.length,'Entitlement records'],['Active Users',active,`${u.length?Math.round(active/u.length*100):0}% active`],['Projects',new Set(u.flatMap(x=>(x.projects||[]).map(p=>p.projectName)).filter(Boolean)).size,'Projects represented'],['Project Access',u.reduce((n,x)=>n+(x.projects||[]).length,0),'Project access records']];
  }
  return [];
}
function renderAdvancedDashboard() {
  const host = document.getElementById('advancedDashboard'); if (!host) return;
  const metrics = getAdvancedDashboardMetrics(activeCategory);
  if (!metrics.length) { host.innerHTML=''; return; }
  host.innerHTML = `<div class="flex items-center justify-between mb-3"><div><h3 class="font-bold text-slate-900 text-sm">Advanced Dashboard Insights</h3><p class="text-xs text-slate-400">Derived from the records currently loaded in this workspace.</p></div><span class="text-[10px] uppercase tracking-wider font-bold text-slate-400">Live summary</span></div><div class="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">${metrics.map(m=>`<div class="ux-insight-card"><div class="ux-insight-label">${escapeHtml(m[0])}</div><div class="ux-insight-value">${escapeHtml(m[1])}</div><div class="ux-insight-note">${escapeHtml(m[2])}</div></div>`).join('')}</div>`;
}
function renderAzDoProgressPanel() {
  const host = document.getElementById('azdoProgressPanel'); if (!host) return;
  const p = typeof getAzDoProgressState === 'function' ? getAzDoProgressState() : {};
  const running = azdoApiRunActive && !p.cancelled;
  host.classList.remove('hidden');
  host.innerHTML = `<div class="ux-progress-head"><div><strong>${running ? 'Azure DevOps scan in progress' : (p.cancelled ? 'Azure DevOps scan cancelled' : 'Azure DevOps scan summary')}</strong><span>${p.requests||0} requests · ${p.pages||0} pages · ${p.retries||0} retries</span></div><span class="ux-progress-percent">${p.requests ? Math.round((p.completed||0)/Math.max(p.requests||1,p.completed||1)*100) : 0}%</span></div><div class="ux-progress-track"><div class="ux-progress-bar" style="width:${p.requests ? Math.min(100,Math.round((p.completed||0)/Math.max(p.requests||1,p.completed||1)*100)) : (running ? 15 : 100)}%"></div></div><div class="ux-progress-grid"><span><b>${p.recordsScanned||0}</b> records scanned</span><span><b>${p.recordsSkipped||0}</b> records skipped/unavailable</span><span><b>${p.activeRequests||0}</b> active requests</span><span><b>${p.queuedRequests||0}</b> queued</span><span><b>${p.permissionWarnings||0}</b> permission warnings</span><span><b>${p.failures||0}</b> failed requests</span></div>${p.permissionWarnings ? '<div class="ux-permission-warning"><strong>Permission warning:</strong> Some Azure DevOps resources returned 401/403. Results may be incomplete for those resources.</div>' : ''}</div>`;
}
function startFetching(message) {
  const result = typeof __originalStartFetching === 'function' ? __originalStartFetching(message) : null;
  renderAzDoProgressPanel();
  clearInterval(tableUxProgressTimer);
  tableUxProgressTimer = setInterval(renderAzDoProgressPanel, 300);
  return result || { id: azdoApiRunState?.id || 0, signal: getAzDoAbortSignal?.() };
}
function stopFetching() {
  if (typeof __originalStopFetching === 'function') __originalStopFetching();
  clearInterval(tableUxProgressTimer);
  tableUxProgressTimer = null;
  renderAzDoProgressPanel();
  renderAdvancedDashboard();
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
const scope = document.getElementById('tableFilterScope')?.value || 'all';
if (activeViewSection === 'view-repositories') {
const sheetsToExport = {};
let exportFileName = "AzureDevOps_Repositories_Full_Telemetry";
if (scope === 'all' || scope === 'table-repositories') {
const branchData = (rawStore.repos || []).map(b => ({
"Repository": b.repo,
"Branch Name": b.branch,
"Status / Health": b.isStale ? "Stale" : "Active",
"Branch Policies": b.policies && b.policies.length ? b.policies.join(', ') : "None",
"Required Reviewers": b.minReviewers || 0,
"Last Author": b.author,
"Last Commit Date": b.date,
"Commit Message": b.msg
}));
sheetsToExport["All Branches"] = branchData;
if (scope === 'table-repositories') {
exportFileName = "AzureDevOps_Repositories_Active_Branches";
}
}
if (scope === 'all' || scope === 'table-policy-branches') {
const policyBranches = (rawStore.repos || []).filter(
b => b.hasPolicy === true && Array.isArray(b.policies) && b.policies.length > 0
);
const policyBranchData = policyBranches.map(b => ({
"Repository": b.repo,
"Branch Name": b.branch,
"Required Reviewers": b.minReviewers || 0,
"Branch Policies": b.policies.join(', '),
"Last Author": b.author || "Unknown",
"Last Commit Date": b.date || "N/A",
"Commit Message": b.msg || ""
}));
sheetsToExport["Branches With Policies"] = policyBranchData;
if (scope === 'table-policy-branches') {
exportFileName = "AzureDevOps_Branches_With_Policies";
}
}
if (scope === 'all' || scope === 'table-repo-prs') {
const prData = (rawStore.repoPrs || []).map(p => ({
"Repository": p.repo,
"PR Title": p.title,
"Source Branch": p.source,
"Target Branch": p.target,
"Target Branch Policies": p.targetPolicies && p.targetPolicies.length ? p.targetPolicies.join(', ') : "None",
"Min Required Reviewers": p.minRequiredReviewers || 0,
"Assigned Reviewers": p.reviewersCount || 0,
"Creator": p.creator,
"Status": p.status,
"Created Date": p.createdDate
}));
sheetsToExport["Pull Requests"] = prData;
if (scope === 'table-repo-prs') {
exportFileName = "AzureDevOps_Pull_Requests";
}
}
exportToExcelFile(sheetsToExport, exportFileName);
}
else if (activeViewSection === 'view-access') {
const accessData = (rawStore.access || []).map(a => ({
"Team / Group Name": a.team,
"Type / Scope": a.type,
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
const prData = (rawStore.repoPrs || []).map(p => ({
"Repository": p.repo,
"PR Title": p.title,
"Source": p.source,
"Target": p.target,
"Status": p.status,
"Created Date": p.createdDate
}));
exportToExcelFile({ "User Commits": commitData, "User PRs": prData }, "AzureDevOps_User_Activity");
}
else if (activeViewSection === 'view-pipelines') {
exportPipelinesToXLSX();
}
else if (activeViewSection === 'view-serviceagents') {
exportServiceConnectionsAndAgentsToXLSX();
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
function exportAccessToXLSX() {
const accessData = (rawStore.access || []).map(a => ({
"Team / Group Name": a.team,
"Type / Scope": a.type,
"User Display Name": a.name,
"User Principal / Email": a.email
}));
if (!accessData.length) {
if (typeof showModal === 'function') showModal('No access and permission records are available to export.');
return;
}
exportToExcelFile({ "Access & Permissions": accessData }, "AzureDevOps_Security_Access");
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
document.addEventListener('DOMContentLoaded', async function () {
initCredentials();
refreshTableControlScope();
wireTableHeaderSorting();
initTableUxObserver();
renderAdvancedDashboard();
const workspaceActive = sessionStorage.getItem('azdo_workspace_active');
if (workspaceActive === 'true') {
const savedOrg = sessionStorage.getItem('azdo_session_org');
const savedProject = sessionStorage.getItem('azdo_session_project');
const savedCategory = sessionStorage.getItem('azdo_session_category');
if (savedOrg) document.getElementById('targetOrg').value = savedOrg;
if (savedCategory) activeCategory = savedCategory;
// PATs are deliberately never restored from browser storage. The user must re-enter it.
if (savedOrg) {
handleOrgChange();
setStatus('Previous workspace details were found, but the PAT was not stored. Re-enter your PAT to reconnect.', 'info');
}
if (savedProject) {
const projectSelect = document.getElementById('projectSelect');
if (projectSelect) projectSelect.value = savedProject;
}
if (savedCategory) selectExplore(savedCategory);
showConnectionPage();
} else {
selectExplore('repositories');
}
});
