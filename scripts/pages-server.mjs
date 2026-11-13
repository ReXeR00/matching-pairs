// Static server that behaves like GitHub Pages for a project site, for local
// and CI testing of the production build. Dependency-free, read-only.
//   node scripts/pages-server.mjs [distDir] [port]
// Env: PAGES_DIST (default "dist"), PORT (default 4173), EXPECTED_BASE (default "/matching-pairs/").
// GitHub Pages behaviour emulated:
//   /matching-pairs           -> 301 /matching-pairs/
//   existing file             -> 200
//   directory                 -> 301 to trailing slash, then its index.html
//   /x without extension      -> x.html if it exists
//   anything else in the site -> 404 status with the site's 404.html (if present)
//   paths outside the site    -> plain 404
import http from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const dist = path.resolve(process.argv[2] || process.env.PAGES_DIST || "dist");
const port = Number(process.argv[3] || process.env.PORT || 4173);
const base = process.env.EXPECTED_BASE || "/matching-pairs/";

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".txt": "text/plain; charset=utf-8",
};

const isFile = (f) => existsSync(f) && statSync(f).isFile();
const isDir = (f) => existsSync(f) && statSync(f).isDirectory();

function send(res, status, file, method) {
  const body = readFileSync(file);
  res.writeHead(status, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "content-length": body.length });
  res.end(method === "HEAD" ? undefined : body);
}

// inSite: the path is inside this project site (outside it, GitHub serves another site's 404)
function notFound(res, method, inSite = true) {
  const page = path.join(dist, "404.html");
  if (inSite && isFile(page)) return send(res, 404, page, method);
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end(method === "HEAD" ? undefined : "404 Not Found (GitHub Pages: no 404.html in this site)");
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    return notFound(res, req.method);
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405);
    return res.end();
  }
  if (pathname === base.slice(0, -1)) {
    res.writeHead(301, { location: base + url.search });
    return res.end();
  }
  if (!pathname.startsWith(base)) return notFound(res, req.method, false);

  const rel = pathname.slice(base.length);
  const file = path.resolve(dist, rel);
  if (file !== dist && !file.startsWith(dist + path.sep)) return notFound(res, req.method); // no path traversal

  if (isDir(file)) {
    if (!pathname.endsWith("/")) {
      res.writeHead(301, { location: pathname + "/" + url.search });
      return res.end();
    }
    const index = path.join(file, "index.html");
    return isFile(index) ? send(res, 200, index, req.method) : notFound(res, req.method);
  }
  if (isFile(file)) return send(res, 200, file, req.method);
  if (!path.extname(file) && isFile(file + ".html")) return send(res, 200, file + ".html", req.method);
  return notFound(res, req.method);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`GitHub Pages-like server: http://127.0.0.1:${port}${base} -> ${dist}`);
});
