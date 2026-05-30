const ORIGIN_BASE_URL = "https://a11.funesterie.me";

function buildOriginUrl(requestUrl) {
  const url = new URL(requestUrl);
  return new URL(`${url.pathname}${url.search}`, ORIGIN_BASE_URL);
}

function copyResponseHeaders(response, routeLabel) {
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-cache");
  headers.set("x-funesterie-route", routeLabel);
  headers.delete("content-security-policy-report-only");
  return headers;
}

function rewriteArchitectureHtml(html) {
  return html
    .replace(/<title>.*?<\/title>/i, "<title>Funesterie - Architecture</title>")
    .replace(
      /<meta name="description" content="[^"]*"\s*\/?>/i,
      '<meta name="description" content="Graphe public Funesterie : agents IA, modules NOSSEN, infrastructure, données et sécurité." />'
    );
}

async function fetchOrigin(request) {
  const originUrl = buildOriginUrl(request.url);
  return fetch(originUrl, {
    method: request.method,
    headers: {
      accept: request.headers.get("accept") || "text/html,*/*",
      "accept-language": request.headers.get("accept-language") || "fr-FR,fr;q=0.9",
      "user-agent": "funesterie-architecture-route/1.1",
    },
    redirect: "follow",
    cf: {
      cacheEverything: false,
      cacheTtl: 0,
    },
  });
}

export default {
  async fetch(request) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return fetch(request);
    }

    const response = await fetchOrigin(request);
    const headers = copyResponseHeaders(response, "architecture-origin");

    if (request.method === "HEAD") {
      return new Response(null, { status: response.status, headers });
    }

    const contentType = headers.get("content-type") || "";
    if (response.ok && contentType.includes("text/html")) {
      const html = rewriteArchitectureHtml(await response.text());
      headers.set("content-type", "text/html; charset=utf-8");
      return new Response(html, { status: response.status, headers });
    }

    return new Response(response.body, { status: response.status, headers });
  },
};
