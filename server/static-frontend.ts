import { readFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
/** Same-origin static frontend; never proxies Firebase/Graph or serves repository files. */
export async function serveFrontend(
  req: IncomingMessage,
  res: ServerResponse,
  directory: string,
) {
  const raw = req.url?.split("?")[0] ?? "/";
  if (raw.startsWith("/api/") || ["/health", "/healthz"].includes(raw))
    return false;
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  const root = resolve(directory);
  let path: string;
  try {
    path =
      raw === "/"
        ? resolve(root, "index.html")
        : resolve(root, "." + decodeURIComponent(raw));
  } catch {
    return false;
  }
  if (!path.startsWith(root + sep) || raw.includes("..")) return false;
  if (raw === "/") path = resolve(root, "index.html");
  const types: Record<string, string> = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
    ".ico": "image/x-icon",
  };
  const type = types[extname(path)];
  if (!type) return false;
  try {
    const bytes = await readFile(path);
    res.writeHead(200, {
      "content-type": type,
      "cache-control":
        extname(path) === ".html" ? "no-store" : "public,max-age=3600",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "cross-origin-opener-policy": "same-origin-allow-popups",
      "content-security-policy":
        "default-src 'self'; script-src 'self' https://apis.google.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://apis.google.com https://*.firebaseapp.com; frame-src https://*.firebaseapp.com https://login.microsoftonline.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
    });
    res.end(req.method === "HEAD" ? undefined : bytes);
    return true;
  } catch {
    return false;
  }
}
