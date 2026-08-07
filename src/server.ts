import { exec } from "node:child_process";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { URL } from "node:url";
import {
  countEntries,
  history,
  listProjects,
  openLedger,
  type Ledger,
} from "./db.js";
import { getWebUIHTML } from "./web/ui.js";

export type ServerOptions = {
  port?: number;
  host?: string;
  open?: boolean;
  db?: Ledger;
};

export type ServerInstance = {
  server: Server;
  url: string;
  port: number;
  host: string;
  close: () => Promise<void>;
};

export function openBrowser(url: string): void {
  const platform = process.platform;
  let command = "";
  if (platform === "darwin") {
    command = `open "${url}"`;
  } else if (platform === "win32") {
    command = `start "" "${url}"`;
  } else {
    command = `xdg-open "${url}"`;
  }
  exec(command, () => {
    /* ignore background exec errors */
  });
}

function parseQueryParams(url: URL): Record<string, string> {
  const params: Record<string, string> = {};
  for (const [key, value] of url.searchParams.entries()) {
    params[key] = value;
  }
  return params;
}

function sendJson(
  res: ServerResponse,
  statusCode: number,
  data: unknown,
): void {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-cache",
  });
  res.end(JSON.stringify(data));
}

export function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  db: Ledger,
): void {
  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const reqUrl = new URL(
    req.url || "/",
    `http://${req.headers.host || "localhost"}`,
  );
  const pathname = reqUrl.pathname;
  const query = parseQueryParams(reqUrl);

  if (pathname === "/" || pathname === "/index.html") {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
    });
    res.end(getWebUIHTML());
    return;
  }

  if (pathname === "/api/projects") {
    const projects = listProjects(db, { query: query.query });
    sendJson(res, 200, projects);
    return;
  }

  if (pathname.startsWith("/api/projects/")) {
    const slug = decodeURIComponent(pathname.slice("/api/projects/".length));
    const projects = listProjects(db);
    const target = projects.find((p) => p.project === slug);
    if (!target) {
      sendJson(res, 404, { error: "Project not found" });
    } else {
      sendJson(res, 200, target);
    }
    return;
  }

  if (pathname === "/api/history") {
    const project = query.project;
    const since = query.since;
    const until = query.until;
    const rawLimit = Number(query.limit ?? 100);
    const rawOffset = Number(query.offset ?? 0);

    const entries = history(db, project, {
      since,
      until,
      limit: Number.isInteger(rawLimit) && rawLimit >= 0 ? rawLimit : 100,
      offset: Number.isInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0,
    });
    sendJson(res, 200, entries);
    return;
  }

  if (pathname === "/api/stats") {
    const projects = listProjects(db);
    const totalEntries = countEntries(db);
    const statusCounts: Record<string, number> = {};

    for (const proj of projects) {
      const st = proj.latestStatus?.status || "none";
      statusCounts[st] = (statusCounts[st] || 0) + 1;
    }

    sendJson(res, 200, {
      totalProjects: projects.length,
      totalEntries,
      statusCounts,
    });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

export function startServer(
  options: ServerOptions = {},
): Promise<ServerInstance> {
  const host = options.host ?? "127.0.0.1";
  const port =
    options.port ??
    (process.env.PORT ? Number(process.env.PORT) : /* c8 ignore next */ 3000);
  const db = options.db || openLedger();
  const shouldOpen = options.open ?? true;

  const server = createServer((req, res) => {
    try {
      handleRequest(req, res, db);
    } catch (err) {
      sendJson(res, 500, {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      /* c8 ignore start -- server.address() ternary branch is Node network adapter glue */
      const address = server.address();
      const actualPort =
        typeof address === "object" && address !== null ? address.port : port;
      /* c8 ignore stop */
      const url = `http://${host}:${actualPort}`;

      if (shouldOpen) {
        openBrowser(url);
      }

      resolve({
        server,
        url,
        port: actualPort,
        host,
        close: () =>
          new Promise<void>((resClose, rejClose) => {
            server.close((err) => {
              if (!options.db) {
                db.close();
              }
              if (err) rejClose(err);
              else resClose();
            });
          }),
      });
    });
  });
}
