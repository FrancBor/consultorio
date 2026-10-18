function parseApiOrigin(value) {
  if (typeof value !== 'string') {
    return null;
  }

  try {
    const url = new URL(value);
    return url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

function errorResponse(status) {
  return Response.json(
    {
      error: {
        code: 'service_unavailable',
        message: 'The API proxy is unavailable.',
      },
    },
    {
      status,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}

export async function onRequest({ request, env }) {
  const apiOrigin = parseApiOrigin(env?.API_ORIGIN);

  if (!apiOrigin) {
    return errorResponse(503);
  }

  const incomingUrl = new URL(request.url);
  const targetUrl = new URL(apiOrigin);
  targetUrl.pathname = incomingUrl.pathname;
  targetUrl.search = incomingUrl.search;

  try {
    return await fetch(new Request(targetUrl, request));
  } catch {
    return errorResponse(502);
  }
}
