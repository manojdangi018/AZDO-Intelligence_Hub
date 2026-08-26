async function fetchPipelineData() {
  const org = extractOrgName(document.getElementById('targetOrg').value);
  const project = document.getElementById('projectSelect').value;
  const pat = document.getElementById('targetPat').value.trim();
  const perPipelineRuns = parseInt(document.getElementById('pipelineRunsTop').value, 10) || 20;

  const authHeader = 'Basic ' + btoa(':' + pat);
  showSection('pipelines');
  setStatus(`Scanning pipeline definitions and recent runs in descending order...`, 'info');

  try {
    // 1. Fetch modern & classic pipeline definitions
    const modernUrl = `https://dev.azure.com/${org}/${project}/_apis/pipelines?api-version=${API_VERSION}`;
    const classicUrl = `https://dev.azure.com/${org}/${project}/_apis/build/definitions?api-version=${API_VERSION}`;

    const [modernRes, classicRes] = await Promise.allSettled([
      fetchAzDo(modernUrl, authHeader),
      fetchAzDo(classicUrl, authHeader)
    ]);

    const pipelineMap = new Map();

    if (modernRes.status === 'fulfilled' && modernRes.value?.value) {
      modernRes.value.value.forEach(p => pipelineMap.set(p.name, { id: p.id, name: p.name, type: 'yaml' }));
    }

    if (classicRes.status === 'fulfilled' && classicRes.value?.value) {
      classicRes.value.value.forEach(d => {
        if (!pipelineMap.has(d.name)) {
          pipelineMap.set(d.name, { id: d.id, name: d.name, type: 'classic' });
        }
      });
    }

    function parseTriggerType(reasonStr) {
      const r = (reasonStr || '').toLowerCase();
      if (r.includes('batchedci') || r.includes('individualci') || r === 'ci') return 'Auto (CI)';
      if (r.includes('pullrequest') || r.includes('validatepr')) return 'Auto (PR)';
      if (r.includes('schedule')) return 'Auto (Scheduled)';
      if (r.includes('buildcompletion') || r.includes('triggered')) return 'Auto (Triggered)';
      if (r.includes('manual') || r.includes('usercreated') || r.includes('none')) return 'Manual';
      return 'Manual';
    }

    // Resolves branch name without defaulting to main
    function parseBranch(bObj) {
      const rawBranch = bObj.sourceBranch || 
                        bObj.resources?.repositories?.self?.refName || 
                        bObj.resources?.repositories?.self?.version ||
                        bObj.triggerInfo?.['pr.sourceBranch'] ||
                        bObj.parameters?.['system.pullRequest.sourceBranch'];

      if (!rawBranch) return 'main';

      return rawBranch
        .replace(/^refs\/heads\//i, '')
        .replace(/^refs\/pull\/\d+\/merge/i, 'PR Merge')
        .replace(/^refs\/tags\//i, 'Tag: ');
    }

    // Extracts the real triggering user name / email
    function parseAuthor(bObj, pipeName, triggerType) {
      const candidates = [
        bObj.requestedFor?.displayName,
        bObj.requestedBy?.displayName,
        bObj.requestedFor?.uniqueName,
        bObj.requestedBy?.uniqueName,
        bObj.requestedFor?.mailAddress,
        bObj.requestedBy?.mailAddress,
        bObj.triggerInfo?.['pr.sender.name'],
        bObj.triggerInfo?.['ci.actor.name'],
        bObj.triggerInfo?.['pr.sender.email'],
        bObj.lastChangedBy?.displayName,
        bObj.lastChangedBy?.uniqueName,
        bObj.variables?.['Build.RequestedFor']?.value,
        bObj.variables?.['Build.RequestedForEmail']?.value,
        bObj.variables?.['Build.QueuedBy']?.value
      ];

      for (const raw of candidates) {
        if (raw && typeof raw === 'string') {
          const val = raw.trim();
          if (
            val !== '' && 
            val.toLowerCase() !== (pipeName || '').toLowerCase() &&
            !val.toLowerCase().includes('microsoft.visualstudio.services')
          ) {
            return val;
          }
        }
      }

      if (triggerType === 'Auto (Scheduled)') return 'Scheduled Timer';
      if (triggerType === 'Auto (CI)') return 'CI Automation';
      if (triggerType === 'Auto (PR)') return 'PR Automation';
      return 'Automated System';
    }

    let summaryMap = {};
    pipelineMap.forEach((pipe, name) => {
      summaryMap[name] = {
        name: name,
        total: 0,
        succeeded: 0,
        failed: 0,
        autoTriggers: 0,
        manualTriggers: 0
      };
    });

    let allRuns = [];
    const pipeList = Array.from(pipelineMap.values());
    const BATCH_SIZE = 8;

    for (let i = 0; i < pipeList.length; i += BATCH_SIZE) {
      const batch = pipeList.slice(i, i + BATCH_SIZE);

      await Promise.all(batch.map(async (pipe) => {
        try {
          let runsObtained = [];

          // Query build runs endpoint
          const bUrl = `https://dev.azure.com/${org}/${project}/_apis/build/builds?definitions=${pipe.id}&$top=${perPipelineRuns}&queryOrder=queueTimeDescending&api-version=${API_VERSION}`;
          const bData = await fetchAzDo(bUrl, authHeader);
          runsObtained = bData?.value || [];

          // Query pipelines runs endpoint if definition runs were empty
          if (runsObtained.length === 0) {
            const rUrl = `https://dev.azure.com/${org}/${project}/_apis/pipelines/${pipe.id}/runs?api-version=${API_VERSION}`;
            const rData = await fetchAzDo(rUrl, authHeader);
            const rawYamlRuns = (rData?.value || []).slice(0, perPipelineRuns);

            runsObtained = rawYamlRuns.map(yr => ({
              buildNumber: yr.name || `#${yr.id}`,
              sourceBranch: yr.resources?.repositories?.self?.refName || yr.resources?.repositories?.self?.version,
              reason: yr.variables?.['Build.Reason']?.value || 'manual',
              requestedFor: { 
                displayName: yr.variables?.['Build.RequestedFor']?.value || yr.variables?.['Build.QueuedBy']?.value,
                uniqueName: yr.variables?.['Build.RequestedForEmail']?.value || yr.variables?.['Build.QueuedByEmail']?.value
              },
              requestedBy: {
                displayName: yr.variables?.['Build.RequestedFor']?.value || yr.variables?.['Build.QueuedBy']?.value
              },
              result: yr.result || yr.state || 'unknown',
              finishTime: yr.finishedDate || yr.createdDate,
              queueTime: yr.createdDate || yr.finishedDate
            }));
          }

          runsObtained.forEach(b => {
            const result = (b.result || b.status || 'unknown').toLowerCase();
            const isSuccess = result === 'succeeded';
            const trigger = parseTriggerType(b.reason);
            const isAuto = trigger.startsWith('Auto');
            const author = parseAuthor(b, pipe.name, trigger);
            const branch = parseBranch(b);

            summaryMap[pipe.name].total++;
            if (isSuccess) summaryMap[pipe.name].succeeded++;
            else summaryMap[pipe.name].failed++;

            if (isAuto) summaryMap[pipe.name].autoTriggers++;
            else summaryMap[pipe.name].manualTriggers++;

            // Timestamp parsing for strict descending order
            const rawTime = b.finishTime || b.startTime || b.queueTime || b.createdDate;
            const parsedDate = rawTime ? new Date(rawTime) : new Date(0);

            allRuns.push({
              name: pipe.name,
              buildNumber: b.buildNumber || b.id,
              branch: branch,
              reason: trigger,
              author: author,
              result: b.result || b.status || 'unknown',
              rawTimestamp: parsedDate.getTime(),
              finishTime: rawTime ? parsedDate.toLocaleString() : (b.startTime ? 'In Progress' : 'Queued')
            });
          });
        } catch (err) {}
      }));
    }

    // Sort all runs in strict descending order (newest runs first)
    allRuns.sort((a, b) => b.rawTimestamp - a.rawTimestamp);

    rawStore.pipelineSummaries = Object.values(summaryMap);
    rawStore.pipelineSummariesIndex = 0;
    rawStore.pipelines = allRuns;
    rawStore.pipelineIndex = 0;

    const totalSuccessful = rawStore.pipelineSummaries.reduce((acc, p) => acc + p.succeeded, 0);
    const totalAuto = rawStore.pipelineSummaries.reduce((acc, p) => acc + p.autoTriggers, 0);

    document.getElementById('kpi-1-label').textContent = 'Active Scope';
    document.getElementById('kpi-1-val').textContent = `${project} (${pipelineMap.size} Pipelines)`;
    document.getElementById('kpi-1-val').className = 'text-2xl font-extrabold text-slate-800 mt-1 truncate';
    document.getElementById('kpi-2-label').textContent = 'Total Pipelines';
    document.getElementById('kpi-2-val').textContent = pipelineMap.size;
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

    setStatus(`Loaded ${pipelineMap.size} pipelines with ${allRuns.length} total runs sorted by newest first.`, 'success');
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
    tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-400">No recent build runs found for scanned pipelines.</td></tr>`;
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
