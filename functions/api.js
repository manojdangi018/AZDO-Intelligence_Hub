export async function onRequest(context) {
  const { request, env, params } = context;
  const url = new URL(request.url);

  const subPath = Array.isArray(params.path) ? params.path.join('/') : (params.path || '');
  const searchParams = url.search;

  // 1. Read org and token from custom headers (or fallback to env variables)
  const targetOrg = request.headers.get('X-AzDo-Org') || env.AZDO_ORG;
  const targetPat = request.headers.get('X-AzDo-Token') || env.AZDO_PAT;

  if (!targetOrg || !targetPat) {
    return new Response(JSON.stringify({ 
      error: "Missing Azure DevOps Organization or Personal Access Token (PAT)." 
    }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  // 2. Check if request is targeted at VSSPS (Identity/Graph APIs)
  const isVssps = request.headers.get('X-AzDo-Service') === 'vssps';
  const baseDomain = isVssps ? 'vssps.dev.azure.com' : 'dev.azure.com';

  const targetUrl = `https://${baseDomain}/${encodeURIComponent(targetOrg)}/${subPath}${searchParams}`;
  const authHeader = btoa(`:${targetPat}`);

  try {
    const azdoResponse = await fetch(targetUrl, {
      method: request.method,
      headers: {
        "Authorization": `Basic ${authHeader}`,
        "Content-Type": "application/json"
      },
      body: request.method !== "GET" && request.method !== "HEAD" ? request.body : undefined
    });

    const data = await azdoResponse.text();

    return new Response(data, {
      status: azdoResponse.status,
      headers: {
        "Content-Type": "application/json"
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}