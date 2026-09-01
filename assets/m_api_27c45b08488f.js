const API_VERSION = "7.1-preview.1";







window.AZDO_CONFIG = window.AZDO_CONFIG || {
  backendUrl: '',
  backendMode: false
};

function isBackendMode() {
  return Boolean(String(window.AZDO_CONFIG?.backendUrl || '').trim());
}

function getAzDoAuthHeader(pat = '') {
  const token = String(pat || '').trim();
  return token ? 'Basic ' + btoa(':' + token) : '';
}

function getBackendUrl() {
  return String(window.AZDO_CONFIG?.backendUrl || '').trim().replace(/\/$/, '');
}

async function fetchAzDo(url, authHeader, options = {}) {
  let requestUrl = url;
  const requestOptions = { ...options, headers: { ...(options.headers || {}) } };

  if (isBackendMode() && getBackendUrl()) {
    requestUrl = `${getBackendUrl()}/api/proxy?target=${encodeURIComponent(url)}`;
    delete requestOptions.headers.Authorization;
    delete requestOptions.headers.authorization;
  } else {
    requestOptions.headers.Authorization = authHeader || '';
  }

  requestOptions.headers.Accept = 'application/json';
  if (!requestOptions.headers['Content-Type'] && !requestOptions.headers['content-type']) {
    requestOptions.headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(requestUrl, requestOptions);
  if (!res.ok) {
    if (res.status === 401 || res.status === 203) throw new Error('Authentication failed: Invalid PAT, missing scopes, or backend credentials are not configured.');
    if (res.status === 403) throw new Error('Access denied: your Azure DevOps identity does not have permission for this resource.');
    if (res.status === 404) throw new Error('Resource not found: Verify your Organization & Project names.');
    let detail = '';
    try { detail = await res.text(); } catch (_) {}
    throw new Error(`Azure DevOps API Error: ${res.status}${res.statusText ? ` ${res.statusText}` : ''}${detail ? ` — ${detail.slice(0, 240)}` : ''}`);
  }

  

  if (res.status === 204) return {};
  return await res.json();
}





function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>\'"`]/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;', '`': '&#96;'
  }[ch]));
}

window.isBackendMode = isBackendMode;
window.getAzDoAuthHeader = getAzDoAuthHeader;
window.escapeHtml = escapeHtml;
