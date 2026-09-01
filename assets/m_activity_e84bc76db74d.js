async function fetchUserActivityData() {
  const org = extractOrgName(document.getElementById('targetOrg').value);
  const selectedProject = document.getElementById('projectSelect').value;
  const pat = document.getElementById('targetPat').value.trim();
  const rawQuery = document.getElementById('targetUserQuery').value.trim();
  const rawTimeframe = document.getElementById('userTimeframeDays')?.value;
  const timeframeDays = rawTimeframe !== undefined && rawTimeframe !== '' ? parseInt(rawTimeframe, 10) : 0;

  if (!selectedProject) {
    return showModal('Please select a project first.', 'projectSelect');
  }

  if (!rawQuery) {
    return showModal('Please enter a User Email or Name to search.', 'targetUserQuery');
  }

  const authHeader = getAzDoAuthHeader(pat);
  showSection('activity');
  startFetching(`Searching activity in project "${selectedProject}" for "${rawQuery}"...`);

  

  const queryLower = rawQuery.toLowerCase();
  const emailPrefix = queryLower.includes('@') ? queryLower.split('@')[0] : queryLower;
  const nameParts = emailPrefix.split(/[\._\-\s]+/).filter(p => p.length >= 2);
  const formattedName = nameParts.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');

  

  const searchAuthors = Array.from(new Set([rawQuery, emailPrefix, formattedName, formattedName.toLowerCase()].filter(Boolean)));

  function matchesUser(authorName, authorEmail, committerName, committerEmail) {
    const aName = (authorName || '').toLowerCase();
    const aEmail = (authorEmail || '').toLowerCase();
    const cName = (committerName || '').toLowerCase();
    const cEmail = (committerEmail || '').toLowerCase();

    

    if (aEmail.includes(queryLower) || cEmail.includes(queryLower) ||
        aName.includes(queryLower) || cName.includes(queryLower) ||
        aEmail.includes(emailPrefix) || cEmail.includes(emailPrefix) ||
        aName.includes(emailPrefix) || cName.includes(emailPrefix)) {
      return true;
    }

    

    if (nameParts.length > 0) {
      const allInAuthor = nameParts.every(p => aName.includes(p) || aEmail.includes(p));
      const allInCommitter = nameParts.every(p => cName.includes(p) || cEmail.includes(p));
      if (allInAuthor || allInCommitter) return true;
    }

    return false;
  }

  let cutoffDate = null;
  let fromDateIso = null;
  if (timeframeDays > 0) {
    const d = new Date();
    d.setDate(d.getDate() - timeframeDays);
    cutoffDate = d;
    fromDateIso = d.toISOString();
  }

  let userCommits = [];
  let userPRs = [];
  const reposTouched = new Set();
  let foundDisplayName = '';
  let commitRepoErrors = 0;
  let prRepoErrors = 0;

  try {
    

    const projReposUrl = `https://dev.azure.com/${org}/${encodeURIComponent(selectedProject)}/_apis/git/repositories?api-version=${API_VERSION}`;
    const projReposRes = await fetchAzDo(projReposUrl, authHeader);
    const repos = projReposRes?.value || [];

    if (!repos || repos.length === 0) {
      throw new Error(`No Git repositories found in project "${selectedProject}".`);
    }

    

    const BATCH_SIZE = 4;
    for (let i = 0; i < repos.length; i += BATCH_SIZE) {
      const batch = repos.slice(i, i + BATCH_SIZE);

      await Promise.all(batch.map(async (r) => {
        

        const commitsPromise = (async () => {
          for (const authorParam of searchAuthors) {
            try {
              let url = `https://dev.azure.com/${org}/${encodeURIComponent(selectedProject)}/_apis/git/repositories/${r.id}/commits?searchCriteria.author=${encodeURIComponent(authorParam)}&$top=1000&api-version=${API_VERSION}`;
              if (fromDateIso) {
                url += `&searchCriteria.fromDate=${encodeURIComponent(fromDateIso)}`;
              }

              const res = await fetchAzDo(url, authHeader);
              const commits = res?.value || [];

              commits.forEach((c) => {
                if (matchesUser(c.author?.name, c.author?.email, c.committer?.name, c.committer?.email)) {
                  const commitDate = new Date(c.author?.date || c.committer?.date);
                  if (!cutoffDate || commitDate >= cutoffDate) {
                    reposTouched.add(r.name);
                    if (!foundDisplayName && c.author?.name) {
                      foundDisplayName = c.author.name;
                    }
                    userCommits.push({
                      repo: r.name,
                      branch: r.defaultBranch ? r.defaultBranch.replace(/^refs\/heads\

                      commitId: (c.commitId || '').substring(0, 8),
                      rawDate: commitDate,
                      date: isNaN(commitDate.getTime()) ? 'N/A' : commitDate.toLocaleDateString(),
                      comment: c.comment || 'No commit message'
                    });
                  }
                }
              });

              if (commits.length > 0) break; 

            } catch (err) {
              

              commitRepoErrors++;
            }
          }
        })();

        

        const prsPromise = (async () => {
          try {
            const prUrl = `https://dev.azure.com/${org}/${encodeURIComponent(selectedProject)}/_apis/git/repositories/${r.id}/pullrequests?searchCriteria.status=all&$top=500&api-version=${API_VERSION}`;
            const prRes = await fetchAzDo(prUrl, authHeader);
            const prList = prRes?.value || [];

            prList.forEach((pr) => {
              const creatorEmail = pr.createdBy?.uniqueName || '';
              const creatorName = pr.createdBy?.displayName || '';

              if (matchesUser(creatorName, creatorEmail, null, null)) {
                const prDate = new Date(pr.creationDate);
                if (!cutoffDate || prDate >= cutoffDate) {
                  reposTouched.add(r.name);
                  userPRs.push({
                    id: pr.pullRequestId || pr.id || '',
                    repo: r.name,
                    title: pr.title || 'Untitled PR',
                    source: (pr.sourceRefName || '').replace('refs/heads/', ''),
                    target: (pr.targetRefName || '').replace('refs/heads/', ''),
                    status: pr.status || 'unknown',
                    createdDate: isNaN(prDate.getTime()) ? 'N/A' : prDate.toLocaleDateString(),
                    rawDate: prDate
                  });
                }
              }
            });
          } catch (err) {
            prRepoErrors++;
          }
        })();

        return Promise.all([commitsPromise, prsPromise]);
      }));
    }

    

    const seen = new Set();
    userCommits = userCommits.filter((c) => {
      const key = `${escapeHtml(c.repo)}_${escapeHtml(c.commitId)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    

    const seenPrs = new Set();
    userPRs = userPRs.filter((p) => {
      const key = `${p.repo}_${p.title}_${p.createdDate}`;
      if (seenPrs.has(key)) return false;
      seenPrs.add(key);
      return true;
    });

    

    userCommits.sort((a, b) => b.rawDate - a.rawDate);
    userPRs.sort((a, b) => b.rawDate - a.rawDate);

    rawStore.commits = userCommits;

    

    

    

    sortByLatestDate(rawStore.commits, ['rawDate']);

    rawStore.commitsIndex = 0;
    rawStore.repoPrs = userPRs;

    

    document.getElementById('kpi-1-label').textContent = 'Active Scope';
    document.getElementById('kpi-1-val').textContent = foundDisplayName || rawQuery;
    document.getElementById('kpi-1-val').className = 'text-2xl font-extrabold text-slate-800 mt-1 truncate';
    document.getElementById('kpi-2-label').textContent = 'Project Repos Touched';
    document.getElementById('kpi-2-val').textContent = reposTouched.size;
    document.getElementById('kpi-3-label').textContent = 'Commits Made';
    document.getElementById('kpi-3-val').textContent = userCommits.length;
    document.getElementById('kpi-4-label').textContent = 'Pull Requests';
    document.getElementById('kpi-4-val').textContent = userPRs.length;
    document.getElementById('kpi-5-label').textContent = 'Status';
    document.getElementById('kpi-5-val').textContent = userCommits.length > 0 ? 'Active' : 'No Commits';

    renderCommitsTableBatch(false);

    document.getElementById('userPrTableBody').innerHTML =
      userPRs.length === 0
        ? `<tr><td colspan="5" class="p-4 text-center text-slate-400">No pull requests found for "${rawQuery}" in project ${selectedProject}.</td></tr>`
        : userPRs
            .map(
              (pr, rowIndex) => `
          <tr class="hover:bg-slate-50 transition" data-detail-type="user-pr" data-detail-index="${rowIndex}">
            <td class="p-4 font-semibold text-slate-900">${escapeHtml(pr.repo)}</td>
            <td class="p-4 font-medium text-slate-800">${escapeHtml(pr.title)}</td>
            <td class="p-4 font-mono text-xs text-slate-500">${escapeHtml(pr.source)} &rarr; ${escapeHtml(pr.target)}</td>
            <td class="p-4"><span class="px-2 py-0.5 rounded-full text-xs font-semibold ${
              pr.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
            }">${escapeHtml(pr.status)}</span></td>
            <td class="p-4 text-xs text-slate-500">${escapeHtml(pr.createdDate)}</td>
          </tr>
        `
            )
            .join('');

    const repoCommitMap = {};
    userCommits.forEach((c) => {
      repoCommitMap[c.repo] = (repoCommitMap[c.repo] || 0) + 1;
    });

    renderChart(
      Object.keys(repoCommitMap),
      Object.values(repoCommitMap),
      `Commits in ${selectedProject} by ${foundDisplayName || rawQuery}`
    );

    stopFetching();
    setStatus(
      `Found ${userCommits.length} commits and ${userPRs.length} PRs in project "${escapeHtml(selectedProject)}" for "${escapeHtml(rawQuery)}".${commitRepoErrors || prRepoErrors ? ` ${commitRepoErrors + prRepoErrors} repository scan request(s) failed or were denied.` : ''}`,
      'success'
    );
  } catch (err) {
    stopFetching();
    setStatus(`Error fetching user activity: ${err.message}`, 'error');
  }
}

function renderCommitsTableBatch(append = false) {
  const tbody = document.getElementById('userCommitsTableBody');
  const container = document.getElementById('seeMoreCommitsContainer');
  const remainingEl = document.getElementById('commitsRemainingCount');

  if (!append) tbody.innerHTML = '';

  if (rawStore.commits.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-slate-400">No commits found in this project for the selected timeframe.</td></tr>`;
    if (container) container.classList.add('hidden');
    return;
  }

  const nextBatch = rawStore.commits.slice(
    rawStore.commitsIndex,
    rawStore.commitsIndex + PAGE_SIZE
  );
  rawStore.commitsIndex += nextBatch.length;

  const batchStartIndex = rawStore.commitsIndex - nextBatch.length;

  const html = nextBatch
    .map(
      (c, rowIndex) => `
    <tr class="hover:bg-slate-50 transition" data-detail-type="user-commit" data-detail-index="${batchStartIndex + rowIndex}">
      <td class="p-4 font-semibold text-slate-900">${escapeHtml(c.repo)}</td>
      <td class="p-4"><span class="font-mono text-xs text-blue-700 bg-blue-50 px-2 py-0.5 rounded font-semibold">${escapeHtml(c.branch)}</span></td>
      <td class="p-4 font-mono text-xs text-blue-600 bg-blue-50 px-2 py-0.5 rounded font-semibold">${escapeHtml(c.commitId)}</td>
      <td class="p-4 text-xs text-slate-500">${escapeHtml(c.date)}</td>
      <td class="p-4 text-xs text-slate-700">${escapeHtml(c.comment)}</td>
    </tr>
  `
    )
    .join('');

  tbody.insertAdjacentHTML('beforeend', html);

  const remaining = rawStore.commits.length - rawStore.commitsIndex;
  if (remaining > 0) {
    if (container) container.classList.remove('hidden');
    if (remainingEl) remainingEl.textContent = remaining;
  } else {
    if (container) container.classList.add('hidden');
  }
}
