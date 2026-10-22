import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * A tiny local website used as an ingestion target in tests. It is a real HTTP
 * server, so the full fetch → robots → extract → chunk → store path runs.
 */
export function startSite() {
  const pages = new Map<string, { type: string; body: string; status?: number }>();
  const hits = new Map<string, number>();
  const server = http.createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    hits.set(path, (hits.get(path) ?? 0) + 1);
    const page = pages.get(path);
    if (!page) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(page.status ?? 200, { "content-type": page.type });
    res.end(page.body);
  });
  return new Promise<{ base: string; pages: typeof pages; hits: typeof hits; close: () => Promise<void> }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ base: `http://127.0.0.1:${port}`, pages, hits, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

export const html = (title: string, body: string, extraHead = "") =>
  `<!doctype html><html><head><title>${title}</title>${extraHead}</head><body><nav>menu</nav><main>${body}</main></body></html>`;
