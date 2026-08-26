async function fetchPipelineData() {
  const org = extractOrgName(document.getElementById('targetOrg').value);
  const project = document.getElementById('projectSelect').value;
  const pat = document.getElementById('targetPat').value.trim();
  const perPipelineRuns = parseInt(document.getElementById('pipelineRunsTop').value, 10) || 20;

  const authHeader = 'Basic ' + btoa(':' + pat);
  showSection('pipelines');
  setStatus(`Scanning pipeline runs, branches and triggering users in descending order...`, 'info');

  try {
    // Step 1: Fetch definitions for the summary table
    const defsUrl = `https://dev.azure.com/${org}/${encodeURIComponent(project)}/_apis/build/definitions?api-version=${API_VERSION}&$top=500`;
    let definitions = [];
    try {
      const defsData = await fetchAzDo(defsUrl, authHeader);
      definitions = defsData?.value || [];
    } catch (e) {
      console.warn("Could not fetch definitions list:", e);
    }

    const summaryMap = {};
    definitions.forEach(d => {
      summaryMap[d.name] = {
        name: d.name,
        total: 0,
        succeeded: 0,
        failed: 0,
        autoTriggers: 0,
        manualTriggers: 0
      };
    });

    // Step 2: Fetch project-wide build runs with complete user details
    const totalToFetch = Math.max(perPipelineRuns * 10, 150);
    const buildsUrl = `https://dev.azure.com/${org}/${encodeURIComponent(project)}/_apis/build/builds?api-version=${API_VERSION}&$top=${totalToFetch}&queryOrder=queueTimeDescending`;
    
    const buildsData = await fetchAzDo(buildsUrl, authHeader);
    const rawBuilds = buildsData?.value || [];

    function parseTriggerType(reasonStr) {
      const r = (reasonStr || '').toLowerCase();
      if (r.includes('batchedci') || r.includes('individualci') || r === 'ci') return 'Auto (CI)';
      if (r.includes('pullrequest') || r.includes('validatepr')) return 'Auto (PR)';
      if (r.includes('schedule')) return 'Auto (Scheduled)';
      if (r.includes('buildcompletion') || r.includes('triggered')) return 'Auto (Triggered)';
      if (r.includes('manual') || r.includes('usercreated') || r.includes('none')) return 'Manual';
      return 'Manual';
    }

    // Resolves the exact active branch
    function parseBranch(b) {
      let branch = b.sourceBranch || 
                   b.triggerInfo?.['pr.sourceBranch'] || 
                   b.parameters?.['system.pullRequest.sourceBranch'] ||
                   b.repository?.defaultBranch ||
                   '';

      if (!branch) return 'main';

      return branch
        .replace(/^refs\/heads\//i, '')
        .replace(/^refs\/pull\/\d+\/merge/i, 'PR Merge')
        .replace(/^refs\/tags\//i, 'Tag: ');
    }

    // Resolves the actual user's Display Name or Email
    function parseAuthor(b, pipeName, triggerType) {
      const candidates = [
        b.requestedFor?.displayName,
        b.requestedBy?.displayName,
        b.requestedFor?.uniqueName,
        b.requestedBy?.uniqueName,
        b.requestedFor?.mailAddress,
        b.triggerInfo?.['pr.sender.name'],
        b.triggerInfo?.['ci.actor.name'],
        b.lastChangedBy?.displayName,
        b.lastChangedBy?.uniqueName
      ];

      for (const val of candidates) {
        if (val && typeof val === 'string') {
          const clean = val.trim();
          if (
            clean !== '' &&
            !clean.toLowerCase().includes('microsoft.visualstudio.services') &&
            clean.toLowerCase() !== (pipeName || '').toLowerCase()
          ) {
            return clean;
          }
        }
      }

      if (triggerType === 'Auto (Scheduled)') return 'Scheduled Timer';
      if (triggerType === 'Auto (CI)') return 'CI Automation';
      if (triggerType === 'Auto (PR)') return 'PR Automation';
      return 'Automated System';
    }

    let allRuns = [];

    rawBuilds.forEach(b => {
      const pipeName = b.definition?.name || 'Unnamed Pipeline';
      const result = (b.result || b.status || 'unknown').toLowerCase();
      const isSuccess = result === 'succeeded';
      const trigger = parseTriggerType(b.reason);
      const isAuto = trigger.startsWith('Auto');
      const author = parseAuthor(b, pipeName, trigger);
      const branch = parseBranch(b);

      if (!summaryMap[pipeName]) {
        summaryMap[pipeName] = {
          name: pipeName,
          total: 0,
          succeeded: 0,
          failed: 0,
          autoTriggers: 0,
          manualTriggers: 0
        };
      }

      summaryMap[pipeName].total++;
      if (isSuccess) summaryMap[pipeName].succeeded++;
      else summaryMap[pipeName].failed++;

      if (isAuto) summaryMap[pipeName].autoTriggers++;
      else summaryMap[pipeName].manualTriggers++;

      const rawTime = b.finishTime || b.startTime || b.queueTime;
      const parsedDate = rawTime ? new Date(rawTime) : new Date(0);

      allRuns.push({
        name: pipeName,
        buildNumber: b.buildNumber || b.id,
        branch: branch,
        reason: trigger,
        author: author,
        result: b.result || b.status || 'unknown',
        rawTimestamp: parsedDate.getTime(),
        finishTime: rawTime ? parsedDate.toLocaleString() : (b.startTime ? 'In Progress' : 'Queued')
      });
    });

    // Sort strictly in descending order (latest runs at top)
    allRuns.sort((a, b) => b.rawTimestamp - a.rawTimestamp);

    rawStore.pipelineSummaries = Object.values(summaryMap);
    rawStore.pipelineSummariesIndex = 0;
    rawStore.pipelines = allRuns;
    rawStore.pipelineIndex = 0;

    const totalSuccessful = rawStore.pipelineSummaries.reduce((acc, p) => acc + p.succeeded, 0);
    const totalAuto = rawStore.pipelineSummaries.reduce((acc, p) => acc + p.autoTriggers, 0);

    document.getElementById('kpi-1-label').textContent = 'Active Scope';
    document.getElementById('kpi-1-val').textContent = `${project} (${rawStore.pipelineSummaries.length} Pipelines)`;
    document.getElementById('kpi-1-val').className = 'text-2xl font-extrabold text-slate-800 mt-1 truncate';
    document.getElementById('kpi-2-label').textContent = 'Total Pipelines';
    document.getElementById('kpi-2-val').textContent = rawStore.pipelineSummaries.length;
    document.getElementById('kpi-3-label').textContent = 'Successful Builds';
    document.getElementById('kpi-3-val').textContent = totalSuccessful;
    document.getElementById('kpi-4-label').textContent = 'Auto / CI Triggers';
    document.getElementById('kpi-4-val').textContent = totalAuto;
    document.getElementById('kpi-5-label').textContent = 'Scanned Runs';
    document.getElementById('kpi-5-val').textContent = allRuns.length;

    renderPipelineSummaryTableBatch(false);
    renderPipelineTableBatch(false);

    const activeSummaries = rawStore.pipelineSummaries.filter(p => p.total > 0).slice(0, 20);
    const chartLabels = activeSummaries.length > 0 ? activeSummaries.map(p => p.name) : rawStore.pipelineSummaries.slice(0, 15).map(p => p.name);
    const chartData = activeSummaries.length > 0 ? activeSummaries.map(p => p.succeeded) : rawStore.pipelineSummaries.slice(0, 15).map(p => p.succeeded);
    renderChart(chartLabels, chartData, 'Successful Builds (Top Pipelines)');

    setStatus(`Loaded ${rawStore.pipelineSummaries.length} pipelines with ${allRuns.length} total runs sorted by newest first.`, 'success');
  } catch (err) {
    setStatus(`Error fetching pipelines: ${err.message}`, 'error');
  }
}

function renderPipelineSummaryTableBatch(append = false) {
  const tbody = document.getElementById('pipelineSummaryTableBody');
  const container = document.getElementById('seeMorePipelineSummaryContainer');
  const remainingEl = document.getElementById('pipelineSummaryRemainingCount');
  if (!tbody) return;

  if (!append) tbody.innerHTML = '';

  if (rawStore.pipelineSummaries.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-400">No pipelines found.</td></tr>`;
    container.classList.add('hidden');
    return;
  }

  const nextBatch = rawStore.pipelineSummaries.slice(rawStore.pipelineSummariesIndex, rawStore.pipelineSummariesIndex + PIPELINE_PAGE_SIZE);
  rawStore.pipelineSummariesIndex += nextBatch.length;

  const html = nextBatch.map(p => {
    const rate = p.total > 0 ? Math.round((p.succeeded / p.total) * 100) : 0;
    return `
      <tr class="hover:bg-slate-50 transition">
        <td class="p-4 font-semibold text-slate-900">${p.name}</td>
        <td class="p-4 font-mono font-medium">${p.total}</td>
        <td class="p-4"><span class="px-2 py-0.5 rounded text-xs font-semibold bg-emerald-100 text-emerald-700">${p.succeeded}</span></td>
        <td class="p-4"><span class="px-2 py-0.5 rounded text-xs font-semibold bg-red-50 text-red-600">${p.failed}</span></td>
        <td class="p-4 font-mono text-xs text-blue-700">${p.autoTriggers}</td>
        <td class="p-4 font-mono text-xs text-slate-700">${p.manualTriggers}</td>
        <td class="p-4">
          <span class="px-2 py-0.5 rounded-full text-xs font-semibold ${rate >= 80 ? 'bg-emerald-100 text-emerald-700' : rate >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}">${rate}%</span>
        </td>
      </tr>
    `;
  }).join('');

  tbody.insertAdjacentHTML('beforeend', html);

  const remaining = rawStore.pipelineSummaries.length - rawStore.pipelineSummariesIndex;
  if (remaining > 0) {
    container.classList.remove('hidden');
    remainingEl.textContent = remaining;
  } else {
    container.classList.add('hidden');
  }
}

function renderPipelineTableBatch(append = false) {
  const tbody = document.getElementById('pipelineTableBody');
  const container = document.getElementById('seeMorePipelinesContainer');
  const remainingEl = document.getElementById('pipelinesRemainingCount');

  if (!append) tbody.innerHTML = '';

  if (rawStore.pipelines.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-400">No recent build runs found.</td></tr>`;
    container.classList.add('hidden');
    return;
  }

  const nextBatch = rawStore.pipelines.slice(rawStore.pipelineIndex, rawStore.pipelineIndex + PAGE_SIZE);
  rawStore.pipelineIndex += nextBatch.length;

  const html = nextBatch.map(r => `
    <tr class="hover:bg-slate-50 transition">
      <td class="p-4 font-semibold text-slate-900">${r.name}</td>
      <td class="p-4 font-mono text-xs text-blue-600 font-bold">#${r.buildNumber}</td>
      <td class="p-4 text-xs font-mono text-slate-700 font-semibold">${r.branch}</td>
      <td class="p-4"><span class="px-2 py-0.5 rounded text-xs font-semibold ${r.reason.includes('Auto') ? 'bg-indigo-50 text-indigo-700 border border-indigo-200' : 'bg-slate-100 text-slate-700'}">${r.reason}</span></td>
      <td class="p-4 text-xs font-medium text-slate-800">${r.author}</td>
      <td class="p-4">
        <span class="px-2 py-0.5 rounded-full text-xs font-semibold ${
          r.result === 'succeeded' ? 'bg-emerald-100 text-emerald-700' :
          r.result === 'failed' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
        }">${r.result}</span>
      </td>
      <td class="p-4 text-xs text-slate-500">${r.finishTime}</td>
    </tr>
  `).join('');

  tbody.insertAdjacentHTML('beforeend', html);

  const remaining = rawStore.pipelines.length - rawStore.pipelineIndex;
  if (remaining > 0) {
    container.classList.remove('hidden');
    remainingEl.textContent = remaining;
  } else {
    container.classList.add('hidden');
  }
}

function exportPipelinesToXLSX() {
  if (!rawStore.pipelineSummaries || rawStore.pipelineSummaries.length === 0) return;
  const summaryData = rawStore.pipelineSummaries.map(p => ({
    "Pipeline Name": p.name,
    "Total Runs": p.total,
    "Successful Builds": p.succeeded,
    "Failed / Other": p.failed,
    "Auto CI Triggers": p.autoTriggers,
    "Manual Triggers": p.manualTriggers,
    "Success Rate": `${p.total > 0 ? Math.round((p.succeeded / p.total) * 100) : 0}%`
  }));

  const runsData = (rawStore.pipelines || []).map(r => ({
    "Pipeline Name": r.name,
    "Build Number": r.buildNumber,
    "Branch": r.branch,
    "Trigger Type": r.reason,
    "Triggered By": r.author,
    "Result": r.result,
    "Finish Time": r.finishTime
  }));

  exportToExcelFile({ "Pipelines Inventory": summaryData, "Build Runs History": runsData }, "AzureDevOps_Pipelines_Analytics");
}
