const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = __dirname;
const port = Number.parseInt(process.env.ALPHAONZE_PORT || "8088", 10);
const host = process.env.ALPHAONZE_HOST || "0.0.0.0";

const routes = new Map([
  ["/", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/index.html", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/afkop.png", { file: "afkop.png", type: "image/png" }],
]);

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    "Cache-Control": "no-store",
    ...headers,
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const method = req.method || "GET";
  if (method !== "GET" && method !== "HEAD") {
    send(res, 405, "method_not_allowed\n", { Allow: "GET, HEAD" });
    return;
  }

  const url = new URL(req.url || "/", "http://localhost");
  if (url.pathname === "/health") {
    send(res, 200, method === "HEAD" ? "" : "ok\n", { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }

  const route = routes.get(url.pathname);
  if (!route) {
    send(res, 404, "not_found\n", { "Content-Type": "text/plain; charset=utf-8" });
    return;
  }

  const filePath = path.join(root, route.file);
  fs.stat(filePath, (statError, stat) => {
    if (statError || !stat.isFile()) {
      send(res, 404, "not_found\n", { "Content-Type": "text/plain; charset=utf-8" });
      return;
    }

    res.writeHead(200, {
      "Content-Type": route.type,
      "Content-Length": stat.size,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "X-Frame-Options": "DENY",
      "Cache-Control": "no-store",
    });

    if (method === "HEAD") {
      res.end();
      return;
    }

    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(port, host, () => {
  console.log(`AlphaOnze AFK listening on http://${host}:${port}`);
});
