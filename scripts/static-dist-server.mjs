import { createReadStream } from "node:fs";
import { access, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const port = Number(argument("--port"));
const root = resolve(argument("--directory") ?? "");

if (!Number.isInteger(port) || port < 1 || port > 65535 || !root) {
  throw new Error("Usage: node static-dist-server.mjs --port <port> --directory <directory>");
}

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function safePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0] || "/");
  const relative = decoded.replace(/^[/\\]+/, "");
  const candidate = resolve(root, normalize(relative));
  if (candidate !== root && !candidate.startsWith(`${root}${sep}`)) return undefined;
  return candidate;
}

async function fileFor(requestUrl) {
  const requested = safePath(requestUrl);
  if (!requested) return undefined;
  try {
    const details = await stat(requested);
    if (details.isFile()) return requested;
    if (details.isDirectory()) {
      const index = join(requested, "index.html");
      await access(index);
      return index;
    }
  } catch {
    // SPA fallback below.
  }

  const fallback = join(root, "index.html");
  try {
    await access(fallback);
    return fallback;
  } catch {
    return undefined;
  }
}

const server = createServer(async (request, response) => {
  try {
    const file = await fileFor(request.url ?? "/");
    if (!file) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": contentTypes[extname(file).toLowerCase()] ?? "application/octet-stream",
    });
    createReadStream(file).pipe(response);
  } catch (error) {
    response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
    response.end(error instanceof Error ? error.message : String(error));
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`static-dist-server listening on ${port}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
