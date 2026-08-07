import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  addStatus,
  getWebUIHTML,
  handleRequest,
  openBrowser,
  openLedger,
  run,
  setProjectMetadata,
  startServer,
} from "../src/index.js";

type MockResponse = {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  json: () => unknown;
};

function simulateRequest(
  db: ReturnType<typeof openLedger>,
  method: string,
  url?: string,
  hostHeader?: string,
): MockResponse {
  const req = new EventEmitter() as unknown as IncomingMessage;
  req.method = method;
  req.url = url as string;
  req.headers = hostHeader ? { host: hostHeader } : {};

  let statusCode = 200;
  let headers: Record<string, string> = {};
  let body = "";

  const res = {
    writeHead(code: number, hdrs: Record<string, string>) {
      statusCode = code;
      headers = hdrs;
    },
    end(data?: string) {
      if (data) body += data;
    },
  } as unknown as ServerResponse;

  handleRequest(req, res, db);

  return {
    statusCode,
    headers,
    body,
    json: () => (body ? JSON.parse(body) : null),
  };
}

test("server handles Web UI and REST API request routing", () => {
  const db = openLedger(":memory:");
  setProjectMetadata(db, {
    project: "alpha",
    displayName: "Alpha Project",
    description: "Alpha description",
    notes: "Alpha note",
  });
  addStatus(db, {
    project: "alpha",
    status: "active",
    summary: "Alpha started",
    progress: "50%",
    blockers: ["B1"],
    nextSteps: ["N1"],
    decisions: ["D1"],
    tags: ["t1"],
  });

  setProjectMetadata(db, {
    project: "beta",
    displayName: "Beta Project",
  });

  // Test GET / with empty/undefined url and host header
  const rootRes = simulateRequest(db, "GET", "", "customhost:8080");
  assert.equal(rootRes.statusCode, 200);
  assert.equal(rootRes.headers["Content-Type"], "text/html; charset=utf-8");
  assert.ok(rootRes.body.includes("Project Manager"));

  // Test GET /index.html
  const indexRes = simulateRequest(db, "GET", "/index.html");
  assert.equal(indexRes.statusCode, 200);

  // Test GET /api/projects
  const projectsRes = simulateRequest(db, "GET", "/api/projects");
  assert.equal(projectsRes.statusCode, 200);
  assert.equal((projectsRes.json() as unknown[]).length, 2);

  // Test GET /api/projects?query=alpha
  const queryRes = simulateRequest(db, "GET", "/api/projects?query=alpha");
  assert.equal(queryRes.statusCode, 200);
  assert.equal((queryRes.json() as unknown[]).length, 1);

  // Test GET /api/projects/:slug (found)
  const projAlphaRes = simulateRequest(db, "GET", "/api/projects/alpha");
  assert.equal(projAlphaRes.statusCode, 200);
  assert.equal((projAlphaRes.json() as { project: string }).project, "alpha");

  // Test GET /api/projects/:slug (not found)
  const proj404Res = simulateRequest(db, "GET", "/api/projects/nonexistent");
  assert.equal(proj404Res.statusCode, 404);
  assert.equal(
    (proj404Res.json() as { error: string }).error,
    "Project not found",
  );

  // Test GET /api/history without query params
  const defaultHistoryRes = simulateRequest(db, "GET", "/api/history");
  assert.equal(defaultHistoryRes.statusCode, 200);

  // Test GET /api/history with valid numeric limit and offset
  const historyRes = simulateRequest(
    db,
    "GET",
    "/api/history?project=alpha&limit=10&offset=5",
  );
  assert.equal(historyRes.statusCode, 200);

  // Test GET /api/history with fallback limit/offset NaN
  const historyFallbackRes = simulateRequest(
    db,
    "GET",
    "/api/history?limit=invalid&offset=invalid",
  );
  assert.equal(historyFallbackRes.statusCode, 200);

  // Test GET /api/stats
  const statsRes = simulateRequest(db, "GET", "/api/stats");
  assert.equal(statsRes.statusCode, 200);
  const stats = statsRes.json() as {
    totalProjects: number;
    totalEntries: number;
    statusCounts: Record<string, number>;
  };
  assert.equal(stats.totalProjects, 2);
  assert.equal(stats.totalEntries, 1);
  assert.equal(stats.statusCounts.active, 1);
  assert.equal(stats.statusCounts.none, 1);

  // Test 404 for unknown route
  const notFoundRes = simulateRequest(db, "GET", "/api/unknown");
  assert.equal(notFoundRes.statusCode, 404);

  // Test 405 Method Not Allowed
  const postRes = simulateRequest(db, "POST", "/api/projects");
  assert.equal(postRes.statusCode, 405);

  db.close();
});

test("startServer initializes HTTP server, closes clean, and handles 500 error boundary", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pmgr-server-"));
  const dbFile = join(directory, "test-server.sqlite");
  const previousDb = process.env.PMGR_DB_PATH;
  const previousPort = process.env.PORT;
  process.env.PMGR_DB_PATH = dbFile;
  process.env.PORT = "0";

  // Test startServer with custom host and PORT env
  const serverWithHost = await startServer({ host: "localhost", open: false });
  assert.equal(serverWithHost.host, "localhost");
  await serverWithHost.close();

  delete process.env.PORT;
  const userDb = openLedger(":memory:");
  const serverWithDb = await startServer({ port: 0, open: false, db: userDb });
  assert.ok(serverWithDb.url.length > 0);
  await serverWithDb.close();
  userDb.close();

  // Test startServer with default options (options = undefined / empty)
  const defaultServerInst = await startServer({ port: 0 });
  assert.ok(defaultServerInst.url.length > 0);
  await defaultServerInst.close();

  const serverInst = await startServer({ port: 0, open: false });
  assert.ok(serverInst.url.length > 0);
  assert.equal(serverInst.host, "127.0.0.1");

  // Test createServer callback event firing
  const req = new EventEmitter() as unknown as IncomingMessage;
  req.method = "GET";
  req.url = "/api/projects";
  req.headers = { host: "localhost" };

  let statusCode = 0;
  let responseData = "";
  const res = {
    writeHead(code: number) {
      statusCode = code;
    },
    end(data?: string) {
      if (data) responseData += data;
    },
  } as unknown as ServerResponse;

  serverInst.server.emit("request", req, res);
  assert.equal(statusCode, 200);
  assert.ok(responseData.includes("[]"));

  // Test 500 error catch block in createServer handler for Error and non-Error
  const brokenDbError = {
    prepare() {
      throw new Error("Simulated DB Failure");
    },
  } as unknown as ReturnType<typeof openLedger>;

  const brokenDbString = {
    prepare() {
      throw "String Exception";
    },
  } as unknown as ReturnType<typeof openLedger>;

  let errCode = 0;
  let errData = "";
  const errRes = {
    writeHead(code: number) {
      errCode = code;
    },
    end(data?: string) {
      if (data) errData += data;
    },
  } as unknown as ServerResponse;

  const brokenServerInst = await startServer({
    port: 0,
    open: false,
    db: brokenDbError,
  });
  brokenServerInst.server.emit("request", req, errRes);
  assert.equal(errCode, 500);
  assert.ok(errData.includes("Simulated DB Failure"));
  await brokenServerInst.close();

  let stringErrCode = 0;
  let stringErrData = "";
  const stringErrRes = {
    writeHead(code: number) {
      stringErrCode = code;
    },
    end(data?: string) {
      if (data) stringErrData += data;
    },
  } as unknown as ServerResponse;

  const stringBrokenServerInst = await startServer({
    port: 0,
    open: false,
    db: brokenDbString,
  });
  stringBrokenServerInst.server.emit("request", req, stringErrRes);
  assert.equal(stringErrCode, 500);
  assert.ok(stringErrData.includes("String Exception"));
  await stringBrokenServerInst.close();

  // Test address non-object null and string fallback in server listen callback
  const mockServerInst = await startServer({ port: 0, open: false });
  mockServerInst.server.address = () => null;
  await mockServerInst.close();

  const mockServerInst2 = await startServer({ port: 0, open: false });
  mockServerInst2.server.address = () => "pipe-address";
  await mockServerInst2.close();

  // Test close error callback rejection (double close)
  await serverInst.close();
  await assert.rejects(async () => {
    await serverInst.close();
  });

  if (previousDb) process.env.PMGR_DB_PATH = previousDb;
  else delete process.env.PMGR_DB_PATH;
  if (previousPort) process.env.PORT = previousPort;
  else delete process.env.PORT;

  rmSync(directory, { recursive: true, force: true });
});

test("openBrowser executes without throwing on all platforms", () => {
  const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
  try {
    Object.defineProperty(process, "platform", { value: "darwin" });
    openBrowser("http://localhost:3000");

    Object.defineProperty(process, "platform", { value: "win32" });
    openBrowser("http://localhost:3000");

    Object.defineProperty(process, "platform", { value: "linux" });
    openBrowser("http://localhost:3000");
  } finally {
    if (originalPlatform) {
      Object.defineProperty(process, "platform", originalPlatform);
    }
  }
});

test("CLI serve command supports port, host, no-open, and json output", async () => {
  const directory = mkdtempSync(join(tmpdir(), "pmgr-cli-serve-"));
  const dbFile = join(directory, "serve.sqlite");
  const previousDb = process.env.PMGR_DB_PATH;
  process.env.PMGR_DB_PATH = dbFile;

  let outputText = "";
  const write = (str: string) => {
    outputText += str;
  };

  const instance = (await run(
    ["serve", "--port", "0", "--host", "127.0.0.1", "--no-open", "--json"],
    write,
  )) as Awaited<ReturnType<typeof startServer>>;

  assert.ok(outputText.includes('"url"'));
  assert.ok(instance && typeof instance.close === "function");
  await instance.close();

  outputText = "";
  const instance2 = (await run(
    ["status", "serve", "--port", "0", "--open"],
    write,
  )) as Awaited<ReturnType<typeof startServer>>;
  assert.ok(outputText.includes("Server running at"));
  await instance2.close();

  outputText = "";
  process.env.PORT = "0";
  const instance3 = (await run(["serve"], write)) as Awaited<
    ReturnType<typeof startServer>
  >;
  assert.ok(outputText.includes("Server running at"));
  await instance3.close();
  delete process.env.PORT;

  if (previousDb) process.env.PMGR_DB_PATH = previousDb;
  else delete process.env.PMGR_DB_PATH;
  rmSync(directory, { recursive: true, force: true });
});

test("getWebUIHTML returns HTML string", () => {
  const html = getWebUIHTML();
  assert.ok(typeof html === "string");
  assert.ok(html.includes("<!DOCTYPE html>"));
});
