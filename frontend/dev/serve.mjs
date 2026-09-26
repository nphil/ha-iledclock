/** Minimal static file server for the dev harness -- no external dependency, just `Bun.serve`
 * over the `dev/` directory so a real browser (or a screenshot script) has a real http:// origin
 * to navigate to. Plain JS deliberately: throwaway dev tooling, not shipped card code, so it sits
 * outside the browser-targeted tsconfig instead of dragging Bun's globals into that typecheck.
 */

import { extname, join, normalize } from "node:path";

const ROOT = import.meta.dir;
const PORT = Number(process.env.HARNESS_PORT ?? 4173);

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

Bun.serve({
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url);
    let path = normalize(decodeURIComponent(url.pathname));
    if (path === "/" || path === "") path = "/index.html";
    const filePath = join(ROOT, path);
    if (!filePath.startsWith(ROOT)) {
      return new Response("Forbidden", { status: 403 });
    }
    const file = Bun.file(filePath);
    const type = CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream";
    if (!(await file.exists())) {
      return new Response("Not found", { status: 404 });
    }
    return new Response(file, {
      headers: { "content-type": type, "content-length": String(file.size) },
    });
  },
});

console.log(`iLedClock frontend dev harness: http://localhost:${PORT}/`);
