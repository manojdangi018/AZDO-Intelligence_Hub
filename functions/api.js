export async function onRequest(context) {
  const { request, env, params } = context;
  const url = new URL(request.url);

  const subPath = Array.isArray(params.path) ? params.path.join('/') : (params.path || '');
  const searchParams = url.search;

  if (!env.AZDO_PAT || !env.AZDO_ORG) {
    return new Response(JSON.stringify({ 
      error: "Azure DevOps credentials (AZDO_PAT and AZDO_ORG) are missing in Cloudflare settings." 
    }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  // Check if request is targeted at VSSPS (Graph / Identity APIs)
  const isVssps = request.headers.get('X-AzDo-Service') === 'vssps';
  const baseDomain = isVssps ? 'vssps.dev.azure.com' : 'dev.azure.com';

  const targetUrl = `https://${baseDomain}/${env.AZDO_ORG}/${subPath}${searchParams}`;
  const authHeader = btoa(`:${env.AZDO_PAT}`);

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