const AZDO_API_VERSION = '7.1';
const API_VERSION = AZDO_API_VERSION;
const AZDO_STABLE_API_VERSION = AZDO_API_VERSION;

class AzureDevOpsApiError extends Error {
constructor(message, status = 0, details = {}) {
super(message);
this.name = 'AzureDevOpsApiError';
this.status = status;
this.statusText = details.statusText || '';
this.code = details.code || null;
this.activityId = details.activityId || null;
this.requestId = details.requestId || null;
this.rawMessage = details.rawMessage || '';
}
}

function escapeHtml(value) {
return String(value ?? '').replace(/[&<>'"`]/g, ch => ({
'&':'&amp;',
'<':'&lt;',
'>':'&gt;',
"'":'&#39;',
'"':'&quot;',
'`':'&#96;'
}[ch]));
}

function sanitizeHtml(html, contextElement = null) {
if (html == null) return '';
const source = String(html);
let root = null;
let host = null;
const tag = contextElement?.tagName?.toLowerCase() || '';

// HTML parsing is context-sensitive. In particular, parsing a <tr> or <td>
// through DOMParser/body turns table rows/cells into invalid body content and
// breaks table rendering. Build the same DOM context as the real target first.
if (['tbody', 'thead', 'tfoot'].includes(tag)) {
  host = document.createElement('table');
  root = document.createElement(tag);
  host.appendChild(root);
  root.innerHTML = source;
} else if (tag === 'tr') {
  host = document.createElement('table');
  const tbody = document.createElement('tbody');
  root = document.createElement('tr');
  tbody.appendChild(root);
  host.appendChild(tbody);
  root.innerHTML = source;
} else if (['td', 'th'].includes(tag)) {
  host = document.createElement('table');
  const tbody = document.createElement('tbody');
  const tr = document.createElement('tr');
  root = document.createElement(tag);
  tr.appendChild(root);
  tbody.appendChild(tr);
  host.appendChild(tbody);
  root.innerHTML = source;
} else if (tag === 'select') {
  root = document.createElement('select');
  root.innerHTML = source;
} else if (tag === 'datalist') {
  root = document.createElement('datalist');
  root.innerHTML = source;
} else {
  const template = document.createElement('template');
  template.innerHTML = source;
  root = template.content;
  host = template;
}

const blockedTags = [
  'script', 'iframe', 'object', 'embed', 'applet', 'base',
  'meta', 'link', 'style', 'form'
];
blockedTags.forEach(tagName => {
  root.querySelectorAll(tagName).forEach(node => node.remove());
});

root.querySelectorAll('*').forEach(node => {
  Array.from(node.attributes).forEach(attr => {
    const name = attr.name.toLowerCase();
    const value = String(attr.value || '').trim();

    // Never allow inline event handlers.
    if (name.startsWith('on')) {
      node.removeAttribute(attr.name);
      return;
    }

    // Prevent scriptable URL schemes and unsafe data URLs.
    if (['href', 'src', 'action', 'formaction', 'xlink:href'].includes(name)) {
      if (/^(javascript|vbscript):/i.test(value) ||
          (value.toLowerCase().startsWith('data:') &&
           !value.toLowerCase().startsWith('data:image/'))) {
        node.removeAttribute(attr.name);
      }
    }
  });
});

return host && typeof host.innerHTML === 'string' ? host.innerHTML : root.innerHTML;
}

function setSafeInnerHTML(element, html) {
if (!element) return;
element.innerHTML = sanitizeHtml(html, element);
}

function insertSafeAdjacentHTML(element, position, html) {
if (!element) return;
element.insertAdjacentHTML(position, sanitizeHtml(html, element));
}

function createBasicAuthHeader(pat) {
const token = String(pat || '').trim();
if (!token) throw new Error('Personal Access Token (PAT) is required.');
return 'Basic ' + btoa(':' + token);
}

async function fetchAzDo(url, authHeader, options = {}) {
let res;
try {
res = await fetch(url, {
...options,
headers: {
'Authorization': authHeader,
'Accept': 'application/json',
'Content-Type': 'application/json',
...(options.headers || {})
}
});
} catch (networkError) {
throw new AzureDevOpsApiError(
`Unable to reach Azure DevOps. Check network connectivity and the request URL. ${networkError?.message || ''}`.trim(),
0,
{ rawMessage: networkError?.message || '' }
);
}

if (!res.ok) {
let payload = null;
try { payload = await res.json(); } catch (_) {}
const headers = res.headers;
const activityId = headers.get('ActivityId') || headers.get('X-VSS-ActivityId') || null;
const requestId = headers.get('X-VSS-E2EID') || headers.get('X-MSEdge-Ref') || null;
const apiMessage = payload?.message || payload?.error?.message || payload?.error_description || '';
let message;
switch (res.status) {
case 400:
message = `Bad request sent to Azure DevOps${apiMessage ? `: ${apiMessage}` : '.'}`;
break;
case 401:
case 203:
message = 'Authentication failed: Invalid PAT or missing required PAT scopes.';
break;
case 403:
message = `Access denied: Your PAT/user does not have permission to access this Azure DevOps resource${apiMessage ? ` (${apiMessage})` : '.'}`;
break;
case 404:
message = `Resource not found: Verify your Organization, Project, Repository, or resource name${apiMessage ? ` (${apiMessage})` : '.'}`;
break;
case 409:
message = `Azure DevOps reported a conflict${apiMessage ? `: ${apiMessage}` : '.'}`;
break;
case 429:
message = `Azure DevOps rate limit reached (HTTP 429). Please wait and try again${apiMessage ? `: ${apiMessage}` : '.'}`;
break;
default:
if (res.status >= 500) {
message = `Azure DevOps server error (${res.status}). Please try again later${apiMessage ? `: ${apiMessage}` : '.'}`;
} else {
message = `Azure DevOps API error ${res.status}${res.statusText ? ` (${res.statusText})` : ''}${apiMessage ? `: ${apiMessage}` : '.'}`;
}
}
const context = [activityId ? `ActivityId: ${activityId}` : '', requestId ? `RequestId: ${requestId}` : ''].filter(Boolean).join(' | ');
if (context) message += ` ${context}`;
throw new AzureDevOpsApiError(message, res.status, {
statusText: res.statusText,
activityId,
requestId,
rawMessage: apiMessage
});
}

return await res.json();
}
