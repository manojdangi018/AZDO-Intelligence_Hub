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

function sanitizeHtml(html) {
if (html == null) return '';
const parser = new DOMParser();
const doc = parser.parseFromString(String(html), 'text/html');
const blockedTags = ['script', 'iframe', 'object', 'embed', 'applet', 'base', 'meta', 'link'];
blockedTags.forEach(tag => doc.querySelectorAll(tag).forEach(node => node.remove()));

doc.querySelectorAll('*').forEach(node => {
Array.from(node.attributes).forEach(attr => {
const name = attr.name.toLowerCase();
const value = String(attr.value || '').trim().toLowerCase();
if (name.startsWith('on')) {
node.removeAttribute(attr.name);
return;
}
if (['href', 'src', 'action', 'formaction', 'xlink:href'].includes(name)) {
if (/^(javascript|vbscript):/i.test(value) || (value.startsWith('data:') && !value.startsWith('data:image/'))) {
node.removeAttribute(attr.name);
}
}
});
});
return doc.body.innerHTML;
}

function setSafeInnerHTML(element, html) {
if (!element) return;
const safe = sanitizeHtml(html);
// This assignment is intentionally kept here so callers can safely render trusted markup
// together with escaped API data without allowing executable HTML attributes or script nodes.
element.innerHTML = safe;
}

function insertSafeAdjacentHTML(element, position, html) {
if (!element) return;
const safe = sanitizeHtml(html);
element.insertAdjacentHTML(position, safe);
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
