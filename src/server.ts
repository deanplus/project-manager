import { spawn } from "node:child_process";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { URL } from "node:url";
import {
  countEntries,
  createTodo,
  listTodos,
  updateTodo,
  convertNextStep,
  completeActivity,
  getEntry,
  history,
  listProjects,
  openLedger,
  type Ledger,
} from "./db.js";
import { ValidationError } from "./domain.js";
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
  const command =
    platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args =
    platform === "darwin"
      ? [url]
      : platform === "win32"
        ? ["/c", "start", "", url]
        : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.on("error", () => {
    /* ignore background launch errors */
  });
  // Detach so a long-lived browser does not keep this process alive.
  child.unref();
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
  if (
    req.method === "POST" &&
    /^\/api\/(todos(?:\/[^/]+)?|entries\/[^/]+\/(complete|todos))$/.test(
      (req.url || "").split("?")[0],
    )
  ) {
    void handleMutation(req, res, db);
    return;
  }
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
  let entryRef: string | undefined;
  let projectSlug: string | undefined;
  try {
    if (pathname.startsWith("/api/entries/"))
      entryRef = decodeURIComponent(pathname.slice("/api/entries/".length));
    if (pathname.startsWith("/api/projects/"))
      projectSlug = decodeURIComponent(pathname.slice("/api/projects/".length));
  } catch {
    sendJson(res, 400, { error: "Invalid URL encoding" });
    return;
  }

  if (pathname === "/" || pathname === "/index.html") {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
    });
    res.end(getWebUIHTML());
    return;
  }

  if (pathname === "/api/todos") {
    const status = query.status;
    if (
      status !== undefined &&
      status !== "open" &&
      status !== "completed" &&
      status !== "cancelled"
    ) {
      sendJson(res, 400, { error: "invalid todo status" });
      return;
    }
    sendJson(
      res,
      200,
      listTodos(
        db,
        query.project,
        status === undefined
          ? {}
          : { status: status as "open" | "completed" | "cancelled" },
      ),
    );
    return;
  }
  if (pathname === "/api/projects") {
    const projects = listProjects(db, { query: query.query });
    sendJson(res, 200, projects);
    return;
  }

  if (pathname.startsWith("/api/projects/")) {
    const slug = projectSlug;
    const projects = listProjects(db);
    const target = projects.find((p) => p.project === slug);
    if (!target) {
      sendJson(res, 404, { error: "Project not found" });
    } else {
      sendJson(res, 200, target);
    }
    return;
  }

  if (pathname.startsWith("/api/entries/")) {
    const entry = getEntry(db, entryRef as string);
    sendJson(res, entry ? 200 : 404, entry ?? { error: "Entry not found" });
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

async function handleMutation(
  req: IncomingMessage,
  res: ServerResponse,
  db: Ledger,
): Promise<void> {
  try {
    const host = req.headers.host;
    if (
      !host ||
      !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host) ||
      (req.headers.origin !== undefined &&
        req.headers.origin !== `http://${host}`) ||
      (req.headers["sec-fetch-site"] !== undefined &&
        !["same-origin", "none"].includes(
          String(req.headers["sec-fetch-site"]),
        ))
    ) {
      sendJson(res, 403, {
        error: "Only same-origin local writes are allowed",
      });
      return;
    }
    if (req.headers["content-type"] !== "application/json") {
      sendJson(res, 415, { error: "JSON required" });
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const bytes = Buffer.from(chunk);
      size += bytes.length;
      if (size > 32768) {
        sendJson(res, 413, { error: "Request too large" });
        return;
      }
      chunks.push(bytes);
    }
    const input: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    const parts = new URL(req.url!, `http://${host}`).pathname
      .split("/")
      .map(decodeURIComponent);
    let result: unknown;
    if (parts[2] === "todos")
      result = parts[3]
        ? updateTodo(db, parts[3], input)
        : createTodo(db, input);
    else {
      if (!input || typeof input !== "object" || Array.isArray(input))
        throw new ValidationError("expected an object");
      const data = input as Record<string, unknown>;
      if (parts[4] === "complete") {
        if (Object.keys(data).length)
          throw new ValidationError("unexpected fields");
        result = completeActivity(db, parts[3]);
      } else if (Object.keys(data).length === 1 && "index" in data)
        result = convertNextStep(db, parts[3], data.index as number);
      else {
        if (Object.keys(data).some((key) => key !== "title"))
          throw new ValidationError("unexpected fields");
        result = createTodo(db, { title: data.title, entryUid: parts[3] });
      }
    }
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(
      res,
      error instanceof ValidationError ||
        error instanceof SyntaxError ||
        error instanceof URIError
        ? 400
        : 500,
      { error: error instanceof Error ? error.message : "Request failed" },
    );
  }
}
