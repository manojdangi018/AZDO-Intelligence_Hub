(function () {
'use strict';

const UX_TABLES = () => Array.from(document.querySelectorAll('.app-shell table[id]'));
const UX_STATE = {
  search: '', status: 'all', dateFrom: '', dateTo: '', sort: new Map(),
  globalResults: []
};
const DETAIL_MAP = [
  ['repositories','repos','repository-branch','Branch'],
  ['repositories','repoPrs','repository-pr','Pull Request'],
  ['user_access','access','access','Access'],
  ['user_activity','commits','user-commit','Commit'],
  ['user_activity','userPrs','user-pr','Pull Request'],
  ['pipelines','pipelineSummaries','pipeline-summary','Pipeline'],
  ['pipelines','pipelines','pipeline-run','Build Run'],
  ['service_agents','serviceConnections','service-connection','Service Connection'],
  ['service_agents','agents','agent','Agent'],
  ['users','userEntitlements','user-directory','User'],
  ['work_items','workitems','work-item','Work Item']
];

function esc(v) { return String(v ?? '').replace(/[&<>'"`]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;','`':'&#96;'}[c])); }
function normalize(v) { return String(v ?? '').toLowerCase().replace(/\s+/g, ' ').trim(); }
function activeSection() { return document.getElementById(typeof activeViewSection !== 'undefined' ? activeViewSection : 'view-repositories'); }

function parseUxDate(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  let m = s.match(/(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):?(\d{2})?(?::(\d{2}))?)?/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
    return Number.isFinite(d.getTime()) ? d : null;
  }
  m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[, ]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d : null;
}
function rowDates(row) {
  return Array.from(row.cells || []).map(c => parseUxDate(c.textContent)).filter(Boolean);
}
function rowPassesDate(row) {
  const from = UX_STATE.dateFrom ? new Date(UX_STATE.dateFrom + 'T00:00:00') : null;
  const to = UX_STATE.dateTo ? new Date(UX_STATE.dateTo + 'T23:59:59.999') : null;
  if (!from && !to) return true;
  const dates = rowDates(row);
  if (!dates.length) return false;
  return dates.some(d => (!from || d >= from) && (!to || d <= to));
}
function rowPassesStatus(row) {
  if (UX_STATE.status === 'all') return true;
  return normalize(row.textContent).includes(normalize(UX_STATE.status));
}
function rowPassesSearch(row) {
  const q = normalize(UX_STATE.search);
  return !q || normalize(row.textContent).includes(q);
}
function applyFilters() {
  const section = activeSection();
  if (!section) return;
  const scope = document.getElementById('tableFilterScope')?.value || 'all';
  let visible = 0, total = 0;
  section.querySelectorAll('table[id]').forEach(table => {
    const target = scope === 'all' || table.id === scope;
    table.querySelectorAll('tbody tr[data-detail-type]').forEach(row => {
      total++;
      const show = target && rowPassesSearch(row) && rowPassesStatus(row) && rowPassesDate(row);
      row.style.display = show ? '' : 'none';
      if (show) visible++;
    });
  });
  updateFilterCount(visible, total);
  refreshAdvancedDashboard();
}
function updateFilterCount(visible, total) {
  const el = document.getElementById('phase4FilterCount');
  if (el) el.textContent = `${visible} of ${total} displayed rows match filters`;
}
function filterActiveTablePhase4() {
  UX_STATE.search = document.getElementById('tableFilterInput')?.value || '';
  applyFilters();
}
window.filterActiveTable = filterActiveTablePhase4;

function sortTable(table, col, dir) {
  const tbody = table.tBodies[0];
  if (!tbody) return;
  const rows = Array.from(tbody.querySelectorAll('tr[data-detail-type]'));
  rows.sort((a,b) => {
    const av = a.cells[col]?.textContent?.trim() || '';
    const bv = b.cells[col]?.textContent?.trim() || '';
    const an = Number(av.replace(/[^0-9.-]+/g,''));
    const bn = Number(bv.replace(/[^0-9.-]+/g,''));
    let cmp;
    if (av && bv && Number.isFinite(an) && Number.isFinite(bn) && /\d/.test(av) && /\d/.test(bv)) cmp = an - bn;
    else {
      const ad = parseUxDate(av), bd = parseUxDate(bv);
      if (ad && bd) cmp = ad.getTime() - bd.getTime();
      else cmp = av.localeCompare(bv, undefined, {numeric:true, sensitivity:'base'});
    }
    return dir === 'desc' ? -cmp : cmp;
  });
  rows.forEach(r => tbody.appendChild(r));
  Array.from(table.tHead?.rows[0]?.cells || []).forEach((th,i) => {
    th.classList.remove('phase4-sort-asc','phase4-sort-desc');
    const indicator = th.querySelector('.phase4-sort-indicator');
    if (indicator) indicator.textContent = i === col ? (dir === 'desc' ? '▼' : '▲') : '↕';
  });
}
function bindSortableHeaders() {
  UX_TABLES().forEach(table => {
    Array.from(table.tHead?.rows[0]?.cells || []).forEach((th, col) => {
      if (th.dataset.phase4Sortable === '1') return;
      th.dataset.phase4Sortable = '1';
      th.classList.add('phase4-sortable');
      const indicator = document.createElement('span');
      indicator.className = 'phase4-sort-indicator';
      indicator.textContent = '↕';
      th.appendChild(indicator);
      th.addEventListener('click', () => {
        const key = table.id + ':' + col;
        const next = UX_STATE.sort.get(key) === 'asc' ? 'desc' : 'asc';
        UX_STATE.sort.set(key, next);
        sortTable(table, col, next);
      });
    });
  });
}

function rawRecordTitle(category, key, row) {
  return row?.name || row?.repo || row?.title || row?.branch || row?.poolName || row?.team || row?.id || `${key} record`;
}
function searchGlobal(query) {
  const q = normalize(query);
  const store = typeof window.__getAzdoRawStore === 'function' ? window.__getAzdoRawStore() : null;
  if (!store || q.length < 2) return [];
  const results = [];
  DETAIL_MAP.forEach(([category,key,type,label]) => {
    const arr = Array.isArray(store[key]) ? store[key] : [];
    arr.forEach((row,index) => {
      const haystack = normalize(Object.entries(row || {}).filter(([k]) => !['raw','rawData'].includes(k)).map(([,v]) => Array.isArray(v) ? v.join(' ') : v).join(' '));
      if (haystack.includes(q)) {
        results.push({category,key,type,label,index,title:rawRecordTitle(category,key,row),subtitle:globalSubtitle(row),row});
      }
    });
  });
  return results.slice(0, 20);
}
function globalSubtitle(row) {
  return row?.email || row?.branch || row?.status || row?.result || row?.pipelineType || row?.type || row?.repo || '';
}
function renderGlobalResults(results) {
  const box = document.getElementById('globalSearchResults');
  if (!box) return;
  UX_STATE.globalResults = results;
  if (!results.length) { box.classList.add('hidden'); box.innerHTML=''; return; }
  setSafeInnerHTML(box, results.map((r,i) => `<button type="button" class="phase4-search-result" data-index="${i}"><span class="phase4-search-result-title">${esc(r.title)}</span><span class="phase4-search-result-meta">${esc(r.label)} · ${esc(r.subtitle)}</span></button>`).join(''));
  box.classList.remove('hidden');
  box.querySelectorAll('.phase4-search-result').forEach(btn => btn.addEventListener('click', () => {
    const r = UX_STATE.globalResults[Number(btn.dataset.index)];
    if (!r) return;
    box.classList.add('hidden');
    const input = document.getElementById('globalSearchInput'); if (input) input.value = r.title;
    if (typeof selectExplore === 'function') selectExplore(r.category);
    setTimeout(() => { if (typeof openDataDetail === 'function') openDataDetail(r.type, r.index); }, 60);
  }));
}
function initGlobalSearch() {
  const input = document.getElementById('globalSearchInput');
  if (!input || input.dataset.phase4Bound === '1') return;
  input.dataset.phase4Bound = '1';
  input.addEventListener('input', () => renderGlobalResults(searchGlobal(input.value)));
  input.addEventListener('keydown', e => { if (e.key === 'Escape') { document.getElementById('globalSearchResults')?.classList.add('hidden'); input.blur(); } });
  document.addEventListener('click', e => { if (!e.target.closest('.phase4-global-search')) document.getElementById('globalSearchResults')?.classList.add('hidden'); });
}

function statusOptions() {
  return ['all','Succeeded','Failed','Partially Succeeded','Canceled','In Progress','Not Started','Active','Stale','Completed','Resolved','Inactive','Online','Offline','Enabled','Disabled','Ready','Not Ready'];
}
function initControls() {
  const status = document.getElementById('uxStatusFilter');
  if (status && !status.dataset.phase4Init) {
    setSafeInnerHTML(status, statusOptions().map(v => `<option value="${esc(v)}">${v === 'all' ? 'Status: All' : esc(v)}</option>`).join(''));
    status.dataset.phase4Init='1';
    status.addEventListener('change', () => { UX_STATE.status=status.value; applyFilters(); });
  }
  ['uxDateFrom','uxDateTo'].forEach(id => {
    const el=document.getElementById(id); if (el && !el.dataset.phase4Init) { el.dataset.phase4Init='1'; el.addEventListener('change', () => { UX_STATE[id==='uxDateFrom'?'dateFrom':'dateTo']=el.value; applyFilters(); }); }
  });
  const clear=document.getElementById('uxClearFilters');
  if(clear && !clear.dataset.phase4Init){clear.dataset.phase4Init='1';clear.addEventListener('click',clearFilters);}
}
function clearFilters(){
  UX_STATE.search=''; UX_STATE.status='all'; UX_STATE.dateFrom=''; UX_STATE.dateTo='';
  ['tableFilterInput','globalSearchInput'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
  const s=document.getElementById('uxStatusFilter');if(s)s.value='all';
  ['uxDateFrom','uxDateTo'].forEach(id=>{const e=document.getElementById(id);if(e)e.value='';});
  applyFilters();
}

function currentWorkspaceRecords() {
  const store=typeof window.__getAzdoRawStore==='function'?window.__getAzdoRawStore():{};
  const map={repositories:['repos','repoPrs'],pipelines:['pipelineSummaries','pipelines'],service_agents:['serviceConnections','agents','agentPools'],work_items:['workitems'],user_activity:['commits','userPrs'],user_access:['access'],users:['userEntitlements']};
  return (map[typeof activeCategory!=='undefined'?activeCategory:'repositories']||[]).reduce((n,k)=>n+(Array.isArray(store[k])?store[k].length:0),0);
}
function refreshAdvancedDashboard() {
  const store=typeof window.__getAzdoRawStore==='function'?window.__getAzdoRawStore():{};
  const cards=document.querySelectorAll('[data-phase4-metric]');
  const counts={
    records:currentWorkspaceRecords(),
    scanned:Number(window.azdoApiRunState?.recordsScanned||window.getAzDoApiRunState?.()?.recordsScanned||0),
    skipped:Number(window.azdoApiRunState?.recordsSkipped||window.getAzDoApiRunState?.()?.recordsSkipped||0),
    warnings:Number(window.getAzDoApiRunState?.()?.permissionWarnings||0)
  };
  cards.forEach(c=>{const k=c.dataset.phase4Metric;if(k in counts)c.textContent=counts[k].toLocaleString();});
  const quality=document.getElementById('phase4QualityText');
  if(quality){const st=window.getAzDoApiRunState?.(); const f=st?.failures?.length||0; quality.textContent=f?`${f} request issue${f===1?'':'s'} detected. Review warnings below.`:'No API reliability warnings detected for the current operation.';}
  const warning=document.getElementById('phase4PermissionWarnings');
  const st=window.getAzDoApiRunState?.();
  const warns=(st?.permissionDetails||[]);
  if(warning){ if(!warns.length){warning.classList.add('hidden');warning.textContent='';} else {warning.classList.remove('hidden');setSafeInnerHTML(warning, `<strong>Permission warnings:</strong> ${warns.slice(0,5).map(x=>esc(x)).join(' · ')}${warns.length>5?' · …':''}`);} }
}
function refreshProgress() {
  const st=window.getAzDoApiRunState?.();
  const panel=document.getElementById('phase4ProgressPanel');
  if(!panel) return;
  if(!st || !window.azdoApiRunActive){ panel.classList.add('hidden'); refreshAdvancedDashboard(); return; }
  panel.classList.remove('hidden');
  const requests=Number(st.requests||0), completed=Number(st.succeeded||0)+Number(st.failures?.length||0);
  const active=Number(window.azdoActiveRequests||0);
  const queue=Array.isArray(window.azdoRequestQueue)?window.azdoRequestQueue.length:0;
  document.getElementById('phase4ProgressText').textContent=`API requests: ${completed}/${requests || '…'} completed · Active: ${active} · Queued: ${queue} · Retries: ${st.retries||0}`;
  document.getElementById('phase4ScannedText').textContent=`Records scanned: ${(st.recordsScanned||0).toLocaleString()} · Skipped/unavailable: ${(st.recordsSkipped||0).toLocaleString()} · Pages: ${(st.pages||0).toLocaleString()}`;
  refreshAdvancedDashboard();
}
function installProgressHooks(){
  if(window.__phase4ProgressTimer)return;
  window.__phase4ProgressTimer=setInterval(refreshProgress,350);
  document.addEventListener('azdo:progress',refreshProgress);
  document.addEventListener('azdo:operation-complete',refreshProgress);
}

function init(){
  initGlobalSearch(); initControls(); bindSortableHeaders(); installProgressHooks();
  const observer=new MutationObserver(()=>{bindSortableHeaders();applyFilters();refreshAdvancedDashboard();});
  observer.observe(document.body,{childList:true,subtree:true});
  setTimeout(()=>{bindSortableHeaders();refreshAdvancedDashboard();},100);
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init); else init();
window.refreshPhase4Ux=()=>{bindSortableHeaders();applyFilters();refreshAdvancedDashboard();};
})();
