const API_VERSION = "7.1-preview.1";

async function fetchAzDo(endpoint, options = {}) {
  let targetPath = endpoint;
  let isVssps = false;

  // Detect and normalize vssps.dev.azure.com endpoints
  if (targetPath.includes("vssps.dev.azure.com/")) {
    isVssps = true;
    const urlObj = new URL(targetPath);
    const pathParts = urlObj.pathname.split("/").filter(Boolean);
    pathParts.shift(); // Remove org name
    targetPath = `/api/${pathParts.join("/")}${urlObj.search}`;
  } else if (targetPath.startsWith("https://dev.azure.com/")) {
    const urlObj = new URL(targetPath);
    const pathParts = urlObj.pathname.split("/").filter(Boolean);
    pathParts.shift(); // Remove org name
    targetPath = `/api/${pathParts.join("/")}${urlObj.search}`;
  } else if (!targetPath.startsWith("/api/")) {
    targetPath = `/api/${targetPath.replace(/^\//, '')}`;
  }

  const customHeaders = {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };

  if (isVssps) {
    customHeaders['X-AzDo-Service'] = 'vssps';
  }

  const res = await fetch(targetPath, {
    ...options,
    headers: customHeaders
  });

  if (!res.ok) {
    if (res.status === 401 || res.status === 203) {
      throw new Error('Authentication failed: Invalid PAT or missing scopes in Cloudflare.');
    }
    if (res.status === 404) {
      throw new Error('Resource not found: Verify Organization & Project configuration.');
    }
    const errorData = await res.json().catch(() => ({}));
    throw new Error(errorData.error || `Azure DevOps API Error: ${res.statusText}`);
  }

  return await res.json();
}