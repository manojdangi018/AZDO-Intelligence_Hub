const API_VERSION = "7.1-preview.1";

async function fetchAzDo(url, authHeader, options = {}) {
  // Ensure token string is trimmed and properly formatted
  const cleanAuth = authHeader.trim();
  
  const headers = { 
    'Authorization': cleanAuth, 
    'Accept': 'application/json',
    ...(options.headers || {})
  };

  // Only set Content-Type if sending a payload body (e.g. POST/PATCH)
  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, { 
    ...options,
    headers: headers
  });

  if (!res.ok) {
    if (res.status === 401 || res.status === 203) {
      throw new Error('Authentication failed: Invalid PAT or missing scopes.');
    }
    if (res.status === 404) {
      throw new Error('Resource not found: Verify your Organization & Project names.');
    }
    throw new Error(`Azure DevOps API Error: ${res.status} ${res.statusText}`);
  }
  return await res.json();
}
