function populateRepoDropdown() {
  const datalist = document.getElementById('repoDatalist');
  datalist.innerHTML = '';

  const allOpt = document.createElement('option');
  allOpt.value = '-- All Repositories --';
  datalist.appendChild(allOpt);

  cachedRepos.forEach(r => {
    const opt = document.createElement('option');
    opt.value = r.name;
    datalist.appendChild(opt);
  });
  document.getElementById('repoSelect').value = '-- All Repositories --';
}

async function fetchRepositoryData() {
  const org = extractOrgName(document.getElementById('targetOrg').value);
  const project = document.getElementById('projectSelect').value;
  const rawInput = document.getElementById('repoSelect').value.trim();
  const pat = document.getElementById('targetPat').value.trim();

  if (!rawInput) return showModal('Please select or type a repository name.', 'repoSelect');

  const authHeader = 'Basic ' + btoa(':' + pat);
  showSection('repositories');
  setStatus('Fetching branches, PR policies, and branch protection configurations...', 'info');

  let targetRepos = cachedRepos;
  if (rawInput !== '-- All Repositories --' && rawInput !== '__ALL__') {
    const exactMatches = cachedRepos.filter(r => r.name.toLowerCase() === rawInput.toLowerCase());
    targetRepos = exactMatches.length > 0 
      ? exactMatches 
      : cachedRepos.filter(r => r.name.toLowerCase().includes(rawInput.toLowerCase()));
  }

  if (targetRepos.length === 0) {
    setStatus(`No repository found matching "${rawInput}".`, 'error');
    return;
  }

  let repoBranchCounts = {};
  let allPRs = [];
  const now = new Date();

  try {
    // 1. Fetch Project-wide Policy Configurations (Branch Policies & PR Reviewer rules)
    let projectPolicies = [];
    try {
      const policyUrl = `https://dev.azure.com/${org}/${encodeURIComponent(project)}/_apis/policy/configurations?api-version=${API_VERSION}`;
      console.log('Fetching policies from:', policyUrl);
      const policyData = await fetchAzDo(policyUrl, authHeader);
      projectPolicies = policyData?.value || [];
      console.log('Policies fetched successfully. Count:', projectPolicies.length);
      
      // Log policy details for debugging
      if (projectPolicies.length > 0) {
        projectPolicies.forEach((p, idx) => {
          console.log(`Policy ${idx}:`, {
            type: p.type?.displayName,
            enabled: p.isEnabled,
            scope: p.settings?.scope
          });
        });
      } else {
        console.warn('No policies found in response');
      }
    } catch (e) {
      console.error("Error fetching policy configurations:", e.message);
      setStatus('Warning: Could not fetch branch policies. Proceeding without policy data.', 'warning');
    }

    // Helper: Match policies to specific repo ID and branch ref
    function getBranchPolicies(repoId, branchName) {
      const targetRef = `refs/heads/${branchName}`.toLowerCase();
      
      const matched = projectPolicies.filter(p => {
        if (!p.isEnabled) return false;
        
        const scopes = p.settings?.scope || [];
        
        // If no scopes defined, policy applies to all branches/repos
        if (scopes.length === 0) return true;
        
        return scopes.some(s => {
          // Handle both string and object repo IDs
          const repoIdStr = typeof s.repositoryId === 'string' ? s.repositoryId : (s.repositoryId || '');
          const repoIdObjStr = typeof repoId === 'string' ? repoId : (repoId || '');
          
          const repoMatch = !repoIdStr || repoIdStr.toLowerCase() === repoIdObjStr.toLowerCase();
          
          // Handle wildcard and specific branch refs
          const refMatch = !s.refName || 
                          s.refName === 'refs/heads/*' || 
                          s.refName.toLowerCase() === targetRef;
          
          return repoMatch && refMatch;
        });
      });

      let minReviewers = 0;
      let policyTags = [];

      matched.forEach(p => {
        const typeName = (p.type?.displayName || '').toLowerCase();
        const typeId = p.type?.id || '';

        // Minimum Approver / Reviewer Policy
        if (typeId === 'fa4e2476-a875-4e57-99d0-c9f86e73a9a6' || 
            typeName.includes('minimum number of reviewers') || 
            typeName.includes('approver')) {
          const count = p.settings?.minimumApproverCount || p.settings?.minimumApproversCount || 1;
          if (count > minReviewers) minReviewers = count;
          policyTags.push(`${count} Required Reviewer${count > 1 ? 's' : ''}`);
        } 
        // Build Validation
        else if (typeId === '0609b951-8744-42d1-8b94-58c442e21078' || typeName.includes('build')) {
          policyTags.push('Build Validation (CI)');
        }
        // Work Item Linking
        else if (typeId === '40e92828-f463-476b-b4bd-3121e03459c8' || typeName.includes('work item')) {
          policyTags.push('Work Item Linked');
        }
        // Comment Resolution
        else if (typeId === 'c6a1889d-b943-4856-b76f-9e46bb6b0df2' || typeName.includes('comment')) {
          policyTags.push('Resolve Comments');
        }
        // Required Reviewers / Teams
        else if (typeId === 'fd2167ab-b0be-447a-8d83-f1ac291de6e0' || typeName.includes('required reviewers')) {
          policyTags.push('Specific Reviewers Enforced');
        } 
        // Status Check
        else if (typeId === '6d0bc69f-8b63-4b58-a9a0-f48ae6e2f6f1' || typeName.includes('status')) {
          policyTags.push('Required Status Check');
        }
        else if (typeName.length > 0) {
          policyTags.push(p.type?.displayName || 'Branch Policy');
        }
      });

      return {
        hasPolicy: matched.length > 0,
        minReviewers: minReviewers,
        policies: [...new Set(policyTags)]
      };
    }

    // 2. Fetch Repositories, Branches, Commits & PRs
    const repoPromises = targetRepos.map(async (r) => {
      const refsUrl = `https://dev.azure.com/${org}/${project}/_apis/git/repositories/${r.id}/refs?filter=heads/&api-version=${API_VERSION}`;
      const prUrl = `https://dev.azure.com/${org}/${project}/_apis/git/repositories/${r.id}/pullrequests?searchCriteria.status=all&$top=100&api-version=${API_VERSION}`;

      const [refsPromise, prsPromise] = await Promise.allSettled([
        fetchAzDo(refsUrl, authHeader),
        fetchAzDo(prUrl, authHeader)
      ]);

      let branchDetails = [];

      if (refsPromise.status === 'fulfilled' && refsPromise.value) {
        const refs = refsPromise.value.value || [];
        repoBranchCounts[r.name] = refs.length;

        branchDetails = await Promise.all(refs.map(async (ref) => {
          const bName = ref.name.replace(/^refs\/heads\//, '');
          const commitUrl = `https://dev.azure.com/${org}/${project}/_apis/git/repositories/${r.id}/commits?searchCriteria.itemVersion.version=${encodeURIComponent(bName)}&searchCriteria.itemVersionType=branch&$top=1&api-version=${API_VERSION}`;
          
          let commitData = { value: [] };
          try {
            commitData = await fetchAzDo(commitUrl, authHeader);
          } catch (e) {
            console.warn(`Could not fetch commits for branch ${bName}:`, e.message);
          }
          
          const topCommit = (commitData.value && commitData.value[0]) ? commitData.value[0] : null;

          const commitDate = topCommit?.author?.date ? new Date(topCommit.author.date) : null;
          const isStale = commitDate ? ((now - commitDate) / (1000 * 60 * 60 * 24)) > 90 : false;
          const policyInfo = getBranchPolicies(r.id, bName);

          return {
            repo: r.name,
            branch: bName,
            author: topCommit?.author?.name || 'Unknown',
            date: commitDate ? commitDate.toLocaleString() : 'N/A',
            isStale: isStale,
            msg: topCommit?.comment || '',
            hasPolicy: policyInfo.hasPolicy,
            minReviewers: policyInfo.minReviewers,
            policies: policyInfo.policies
          };
        }));
      }

      if (prsPromise.status === 'fulfilled' && prsPromise.value) {
        const prList = prsPromise.value.value || [];
        prList.forEach(pr => {
          const targetBranch = (pr.targetRefName || '').replace('refs/heads/', '');
          const policyInfo = getBranchPolicies(r.id, targetBranch);
          
          allPRs.push({
            repo: r.name,
            title: pr.title || 'Untitled PR',
            source: (pr.sourceRefName || '').replace('refs/heads/', ''),
            target: targetBranch,
            creator: pr.createdBy?.displayName || 'Unknown',
            status: pr.status || 'unknown',
            createdDate: pr.creationDate ? new Date(pr.creationDate).toLocaleDateString() : 'N/A',
            reviewersCount: (pr.reviewers || []).length,
            minRequiredReviewers: policyInfo.minReviewers,
            targetPolicies: policyInfo.policies
          });
        });
      }

      return branchDetails;
    });

    const results = await Promise.all(repoPromises);
    rawStore.repos = results.flat();
    rawStore.repoIndex = 0;

    rawStore.repoPrs = allPRs;
    rawStore.repoPrsIndex = 0;

    const activePRsCount = allPRs.filter(p => p.status === 'active').length;
    const completedPRsCount = allPRs.filter(p => p.status === 'completed').length;

    document.getElementById('kpi-1-label').textContent = 'Repository';
    document.getElementById('kpi-1-val').textContent = (targetRepos.length > 1) ? `${targetRepos.length} Repos` : targetRepos[0]?.name;
    document.getElementById('kpi-1-val').className = 'text-2xl font-extrabold text-slate-800 mt-1 truncate';
    
    document.getElementById('kpi-2-label').textContent = 'Branches';
    document.getElementById('kpi-2-val').textContent = `${rawStore.repos.length} (${rawStore.repos.filter(b => b.isStale).length} Stale)`;
    
    document.getElementById('kpi-3-label').textContent = 'Total PRs';
    document.getElementById('kpi-3-val').textContent = allPRs.length;
    
    document.getElementById('kpi-4-label').textContent = 'Active PRs';
    document.getElementById('kpi-4-val').textContent = activePRsCount;
    
    document.getElementById('kpi-5-label').textContent = 'Completed PRs';
    document.getElementById('kpi-5-val').textContent = completedPRsCount;

    renderRepoTableBatch(false);
    renderRepoPrsTableBatch(false);
    renderChart(Object.keys(repoBranchCounts), Object.values(repoBranchCounts), 'Branches per Repository');
    setStatus(`Loaded ${rawStore.repos.length} branches (${projectPolicies.length} policies found) and ${allPRs.length} PRs successfully.`, 'success');
  } catch (err) {
    setStatus(`Error fetching branches & policies: ${err.message}`, 'error');
    console.error('Full error:', err);
  }
}

function renderRepoTableBatch(append = false) {
  const tbody = document.getElementById('branchesTableBody');
  const container = document.getElementById('seeMoreRepoContainer');
  const remainingEl = document.getElementById('repoRemainingCount');

  if (!append) tbody.innerHTML = '';

  if (rawStore.repos.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-400">No branches found.</td></tr>`;
    container.classList.add('hidden');
    return;
  }

  const nextBatch = rawStore.repos.slice(rawStore.repoIndex, rawStore.repoIndex + PAGE_SIZE);
  rawStore.repoIndex += nextBatch.length;

  const html = nextBatch.map(b => {
    const policiesHtml = b.hasPolicy
      ? `<div class="flex flex-wrap gap-1 max-w-xs">
          ${b.minReviewers > 0 ? `<span class="bg-indigo-50 text-indigo-700 border border-indigo-200 text-[10px] font-bold px-1.5 py-0.5 rounded">${b.minReviewers} Reviewers Req.</span>` : ''}
          ${b.policies.map(p => `<span class="bg-blue-50 text-blue-700 border border-blue-200 text-[10px] font-semibold px-1.5 py-0.5 rounded">${p}</span>`).join('')}
         </div>`
      : `<span class="text-xs text-slate-400 italic">No Policies</span>`;

    return `
      <tr class="hover:bg-slate-50 transition">
        <td class="p-4 font-semibold text-slate-900">${b.repo}</td>
        <td class="p-4"><span class="font-mono text-xs text-blue-700 bg-blue-50 px-2 py-0.5 rounded font-semibold">${b.branch}</span></td>
        <td class="p-4">${b.isStale 
          ? '<span class="bg-amber-100 text-amber-700 text-xs px-2 py-0.5 rounded-full font-semibold">Stale</span>' 
          : '<span class="bg-emerald-100 text-emerald-700 text-xs px-2 py-0.5 rounded-full font-semibold">Active</span>'}
        </td>
        <td class="p-4">${policiesHtml}</td>
        <td class="p-4 text-xs font-medium">${b.author}</td>
        <td class="p-4 text-xs text-slate-500">${b.date}</td>
        <td class="p-4 text-xs text-slate-600 max-w-xs truncate" title="${b.msg}">${b.msg}</td>
      </tr>
    `;
  }).join('');

  tbody.insertAdjacentHTML('beforeend', html);

  const remaining = rawStore.repos.length - rawStore.repoIndex;
  if (remaining > 0) {
    container.classList.remove('hidden');
    remainingEl.textContent = remaining;
  } else {
    container.classList.add('hidden');
  }
}

function renderRepoPrsTableBatch(append = false) {
  const tbody = document.getElementById('repoPrsTableBody');
  const container = document.getElementById('seeMoreRepoPrsContainer');
  const remainingEl = document.getElementById('repoPrsRemainingCount');

  if (!append) tbody.innerHTML = '';

  if (rawStore.repoPrs.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-slate-400">No pull requests found.</td></tr>`;
    container.classList.add('hidden');
    return;
  }

  const nextBatch = rawStore.repoPrs.slice(rawStore.repoPrsIndex, rawStore.repoPrsIndex + PAGE_SIZE);
  rawStore.repoPrsIndex += nextBatch.length;

  const html = nextBatch.map(pr => `
    <tr class="hover:bg-slate-50 transition">
      <td class="p-4 font-semibold text-slate-900">${pr.repo}</td>
      <td class="p-4 font-medium text-slate-800 max-w-xs truncate" title="${pr.title}">${pr.title}</td>
      <td class="p-4 font-mono text-xs text-slate-500">${pr.source} &rarr; ${pr.target}</td>
      <td class="p-4">
        ${pr.minRequiredReviewers > 0 
          ? `<span class="bg-indigo-50 text-indigo-700 border border-indigo-200 text-xs font-bold px-2 py-0.5 rounded">${pr.minRequiredReviewers} Min Required</span>` 
          : `<span class="text-xs text-slate-400">Optional</span>`}
      </td>
      <td class="p-4 text-xs font-medium text-slate-700">${pr.creator}</td>
      <td class="p-4">
        <span class="px-2 py-0.5 rounded-full text-xs font-semibold ${
          pr.status === 'completed' ? 'bg-emerald-100 text-emerald-700' :
          pr.status === 'active' ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-600'
        }">${pr.status}</span>
      </td>
      <td class="p-4 text-xs text-slate-500">${pr.createdDate}</td>
    </tr>
  `).join('');

  tbody.insertAdjacentHTML('beforeend', html);

  const remaining = rawStore.repoPrs.length - rawStore.repoPrsIndex;
  if (remaining > 0) {
    container.classList.remove('hidden');
    remainingEl.textContent = remaining;
  } else {
    container.classList.add('hidden');
  }
}

function exportBranchesToXLSX() {
  if (!rawStore.repos || rawStore.repos.length === 0) return;
  const data = rawStore.repos.map(b => ({
    "Repository": b.repo,
    "Branch Name": b.branch,
    "Status / Health": b.isStale ? "Stale" : "Active",
    "Branch & PR Policies": b.policies ? b.policies.join(', ') : 'None',
    "Required Reviewers": b.minReviewers || 0,
    "Last Author": b.author,
    "Last Commit Date": b.date,
    "Commit Message": b.msg
  }));
  exportToExcelFile({ "Branches & Policies": data }, "AzureDevOps_Branches_Policies");
}

function exportRepoPrsToXLSX() {
  if (!rawStore.repoPrs || rawStore.repoPrs.length === 0) return;
  const data = rawStore.repoPrs.map(p => ({
    "Repository": p.repo,
    "PR Title": p.title,
    "Source Branch": p.source,
    "Target Branch": p.target,
    "Min Required Reviewers": p.minRequiredReviewers || 0,
    "Target Policies": p.targetPolicies ? p.targetPolicies.join(', ') : 'None',
    "Creator": p.creator,
    "Status": p.status,
    "Created Date": p.createdDate
  }));
  exportToExcelFile({ "Pull Requests": data }, "AzureDevOps_PullRequests");
}
