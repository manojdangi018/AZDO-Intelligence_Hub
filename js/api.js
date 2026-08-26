const API_VERSION = "7.1-preview.1";

async function fetchAzDo(url, authHeader, options = {}) {
  const headers = { 
    'Authorization': authHeader.trim(), 
    'Accept': 'application/json',
    ...(options.headers || {})
  };

  // Only attach Content-Type if a request body is present (POST/PATCH)
  // This prevents browser CORS preflight blocking on GET requests
  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }

  try {
    const res = await fetch(url, { 
      ...options,
      headers: headers
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 203) {
        throw new Error('Authentication failed (401): Invalid or expired PAT token.');
      }
      if (res.status === 404) {
        throw new Error('Resource not found (404): Please verify your Organization name.');
      }
      throw new Error(`Azure DevOps API Error (${res.status}): ${res.statusText}`);
    }

    return await res.json();
  } catch (err) {
    if (err.name === 'TypeError' || err.message === 'Failed to fetch') {
      throw new Error('CORS / Network Error: Please check that your PAT token is valid, active, and has "Project & Team (Read)" permissions.');
    }
    throw err;
  }
}
