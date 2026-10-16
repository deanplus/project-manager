import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  addStatus,
  changeCompletion,
  history,
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
  assert.ok(rootRes.body.includes('<html lang="zh-CN">'));
  assert.ok(rootRes.body.includes('data-i18n="appTitle">项目管理</h1>'));
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

test("entry detail endpoint includes completion evidence and handles missing entries", () => {
  const db = openLedger(":memory:");
  addStatus(db, { project: "alpha", summary: "Pending", status: "active" });
  const original = history(db, "alpha")[0];
  const followUp = addStatus(db, {
    project: "alpha",
    summary: "Accepted",
    status: "active",
    occurredAt: new Date(Date.parse(original.occurredAt) + 1000).toISOString(),
  }).entry;
  changeCompletion(db, original.uid, followUp.uid);
  const detail = simulateRequest(db, "GET", `/api/entries/${original.uid}`);
  assert.equal(detail.statusCode, 200);
  assert.equal(
    simulateRequest(db, "GET", `/api/entries/${original.id}`).statusCode,
    200,
  );
  for (const url of ["/api/entries/%E0%A4%A", "/api/projects/%E0%A4%A"])
    assert.equal(simulateRequest(db, "GET", url).statusCode, 400);
  assert.equal(
    (detail.json() as { effectiveStatus: string }).effectiveStatus,
    "completed",
  );
  assert.equal(
    simulateRequest(db, "GET", "/api/entries/missing").statusCode,
    404,
  );

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

test("getWebUIHTML defaults to Chinese and supports zh/en i18n switching", async () => {
  const html = getWebUIHTML();
  assert.ok(typeof html === "string");
  assert.ok(html.includes("<!DOCTYPE html>"));
  assert.match(html, /\.btn\[hidden\]\s*\{\s*display: none !important;/);
  assert.ok(html.includes('<html lang="zh-CN">'));
  assert.ok(html.includes("<title>项目管理 - 项目与动态概览</title>"));
  assert.ok(html.includes('id="appTitle" data-i18n="appTitle">项目管理</h1>'));

  const enHtml = getWebUIHTML("en");
  assert.ok(enHtml.includes('<html lang="en">'));
  assert.ok(
    enHtml.includes(
      "<title>Project Manager - Projects & Activity Feed</title>",
    ),
  );
  assert.ok(
    enHtml.includes('id="appTitle" data-i18n="appTitle">Project Manager</h1>'),
  );

  const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(scriptMatch, "expected inline script in Web UI HTML");

  const dataI18nKeys = [
    ...html.matchAll(/data-i18n(?:-placeholder)?="([^"]+)"/g),
  ].map((m) => m[1]);
  assert.ok(dataI18nKeys.length > 0);

  const elements = new Map<
    string,
    {
      textContent: string;
      innerHTML: string;
      value: string;
      placeholder: string;
      style: { display: string };
      active: boolean;
      dataset: Record<string, string>;
      attrs: Record<string, string>;
      setAttribute: (k: string, v: string) => void;
      classList: { toggle: (cls: string, force?: boolean) => void };
      addEventListener: () => void;
    }
  >();
  const getElement = (id: string) => {
    let el = elements.get(id);
    if (!el) {
      const attrs: Record<string, string> = {};
      el = {
        textContent: "",
        innerHTML: "",
        value: "",
        placeholder: "",
        style: { display: "" },
        active: false,
        dataset: {},
        attrs,
        setAttribute: (k: string, v: string) => {
          attrs[k] = v;
        },
        classList: {
          toggle: (_cls: string, force?: boolean) => {
            if (el) el.active = Boolean(force);
          },
        },
        addEventListener: () => {},
      };
      elements.set(id, el);
    }
    return el;
  };
  getElement("appTitle").dataset.i18n = "appTitle";
  getElement("tabProjects").dataset.i18n = "projects";
  getElement("tabActivity").dataset.i18n = "activityFeed";
  getElement("searchInput").dataset.i18nPlaceholder = "searchPlaceholder";

  const storage = new Map<string, string>();
  const { runInNewContext } = await import("node:vm");
  const context: Record<string, unknown> = {
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => storage.set(k, v),
    },
    document: {
      documentElement: { lang: "zh-CN" },
      title: "",
      getElementById: getElement,
      querySelectorAll: (sel: string) => {
        if (sel === "[data-i18n]") {
          return [
            getElement("appTitle"),
            getElement("tabProjects"),
            getElement("tabActivity"),
          ];
        }
        if (sel === "[data-i18n-placeholder]") {
          return [getElement("searchInput")];
        }
        return [];
      },
      addEventListener: () => {},
    },
    fetch: async (url: string) => {
      if (url === "/api/projects") {
        return {
          ok: true,
          json: async () => [
            {
              project: "alpha",
              displayName: "Alpha",
              createdAt: "2026-08-07T00:00:00.000Z",
              latestStatus: {
                status: "active",
                summary: "Working",
                occurredAt: "2026-08-07T00:00:00.000Z",
              },
            },
          ],
        };
      }
      if (url.startsWith("/api/history")) {
        return {
          ok: true,
          json: async () => [
            {
              project: "alpha",
              status: "active",
              source: "agent",
              summary: "Working",
              progress: "Step 1",
              blockers: ["B1"],
              nextSteps: ["N1"],
              decisions: ["D1"],
              tags: ["t1"],
              occurredAt: "2026-08-07T00:00:00.000Z",
            },
            {
              project: "alpha",
              status: "completed",
              source: "human",
              summary: "Second entry",
              tags: [],
              occurredAt: "2026-08-07T01:00:00.000Z",
            },
          ],
        };
      }
      return {
        ok: true,
        json: async () => ({
          totalProjects: 1,
          totalEntries: 2,
          statusCounts: { active: 1 },
        }),
      };
    },
    console,
    Date,
    String,
  };

  runInNewContext(scriptMatch[1], context);
  await new Promise((resolve) => setImmediate(resolve));

  // Verify default language is Chinese (zh) and initial date filter empty state
  assert.equal(
    (context.document as { documentElement: { lang: string } }).documentElement
      .lang,
    "zh-CN",
  );
  assert.equal(getElement("appTitle").textContent, "项目管理");
  assert.equal(getElement("tabProjects").textContent, "项目列表");
  assert.equal(getElement("tabActivity").textContent, "动态流");
  assert.equal(getElement("btnLangZh").active, true);
  assert.equal(getElement("btnLangEn").active, false);
  assert.equal(getElement("langSwitch").attrs["aria-label"], "切换语言");
  assert.ok(getElement("projectsContainer").innerHTML.includes("进行中"));
  assert.ok(getElement("projectsContainer").innerHTML.includes("查看动态 →"));
  assert.ok(getElement("timelineContainer").innerHTML.includes("暂无动态记录"));

  // Search by localized status text ("进行中")
  getElement("searchInput").value = "进行中";
  (context.render as () => void)();
  assert.ok(getElement("projectsContainer").innerHTML.includes("Alpha"));
  getElement("searchInput").value = "";

  // Clear date filter so timeline items render and verify Chinese timeline labels
  (context.clearActivityDate as () => void)();
  assert.ok(getElement("timelineContainer").innerHTML.includes("2 条动态"));
  assert.ok(getElement("timelineContainer").innerHTML.includes("⛔ 阻塞项"));
  assert.ok(getElement("timelineContainer").innerHTML.includes("🎯 下一步"));
  assert.ok(getElement("timelineContainer").innerHTML.includes("💡 决策"));

  for (const key of dataI18nKeys) {
    assert.notEqual((context.t as (k: string) => string)(key), key);
  }

  const renderItem = context.renderTimelineItem as (entry: unknown) => string;
  const completedItem = {
    id: 1,
    uid: "old",
    project: "alpha",
    status: "active",
    effectiveStatus: "completed",
    isCurrent: false,
    source: "agent",
    summary: "Review",
    progress: "Original detail",
    blockers: ["acceptance"],
    nextSteps: ["deploy"],
    tags: [],
    occurredAt: "2026-08-07T00:00:00Z",
    completedBy: {
      uid: "new",
      id: 2,
      summary: "<script>done</script>",
      occurredAt: "2026-08-08T00:00:00Z",
      recordedAt: "2026-08-09T00:00:00Z",
    },
  };
  const card = renderItem(completedItem);
  assert.match(card, /已完成/);
  assert.match(card, /已有后续更新/);
  assert.match(card, /由后续动态完成/);
  assert.match(card, /当时状态：.*进行中/);
  assert.match(card, /href="\?entry=new"/);
  assert.match(card, /&lt;script&gt;/);
  assert.match(card, /<details>/);
  assert.match(card, /Original detail/);
  runInNewContext(
    "focusedEntry = " + JSON.stringify(completedItem) + "; render();",
    context,
  );
  assert.match(getElement("timelineContainer").innerHTML, /已完成/);
  (context.setActivityGroupMode as (mode: string) => void)("flat");
  assert.match(getElement("timelineContainer").innerHTML, /已完成/);
  (context.setLang as (lang: string) => void)("en");
  assert.match(
    getElement("timelineContainer").innerHTML,
    /Completed by follow-up/,
  );
  (context.setLang as (lang: string) => void)("zh");
  (context.clearActivityDate as () => void)();

  (context.setActivityGroupMode as (mode: string) => void)("grouped");

  // Switch to English via setLang('en') and ignore invalid locale
  (context.setLang as (lang: string) => void)("invalid");
  assert.equal(getElement("appTitle").textContent, "项目管理");
  (context.setLang as (lang: string) => void)("en");
  for (const key of dataI18nKeys) {
    assert.notEqual((context.t as (k: string) => string)(key), key);
  }
  assert.equal(storage.get("pmgr_lang"), "en");
  assert.equal(
    (context.document as { documentElement: { lang: string } }).documentElement
      .lang,
    "en",
  );
  assert.equal(getElement("appTitle").textContent, "Project Manager");
  assert.equal(getElement("tabProjects").textContent, "Projects");
  assert.equal(getElement("tabActivity").textContent, "Activity Feed");
  assert.equal(
    getElement("searchInput").placeholder,
    "Search projects, status, or activity...",
  );
  assert.equal(
    getElement("langSwitch").attrs["aria-label"],
    "Language Switcher",
  );
  assert.equal(getElement("btnLangZh").active, false);
  assert.equal(getElement("btnLangEn").active, true);
  assert.ok(
    getElement("projectsContainer").innerHTML.includes("View Activity →"),
  );
  assert.ok(getElement("timelineContainer").innerHTML.includes("2 updates"));
  assert.ok(getElement("timelineContainer").innerHTML.includes("⛔ Blockers"));
  assert.ok(
    getElement("timelineContainer").innerHTML.includes("🎯 Next Steps"),
  );
  assert.ok(getElement("timelineContainer").innerHTML.includes("💡 Decisions"));

  // Unknown enum fallback returns raw value instead of dictionary key
  assert.equal(
    (context.formatStatus as (s: string) => string)("custom"),
    "custom",
  );
  assert.equal(
    (context.formatSource as (s: string) => string)("webhook"),
    "webhook",
  );

  // Switch back to Chinese via setLang('zh')
  (context.setLang as (lang: string) => void)("zh");
  assert.equal(storage.get("pmgr_lang"), "zh");
  assert.equal(getElement("appTitle").textContent, "项目管理");
  assert.equal(getElement("btnLangZh").active, true);
  assert.equal(getElement("btnLangEn").active, false);

  const originalFetch = context.fetch as (url: string) => Promise<unknown>;
  context.location = { search: "?entry=new" };
  context.URLSearchParams = URLSearchParams;
  const requests: string[] = [];
  context.fetch = async (url: string) => {
    requests.push(url);
    if (url === "/api/entries/new")
      return { ok: true, json: async () => ({ ...completedItem, uid: "new" }) };
    return originalFetch(url);
  };
  await (context.fetchData as () => Promise<void>)();
  assert.ok(requests.includes("/api/entries/new"));
  assert.match(getElement("timelineContainer").innerHTML, /由后续动态完成/);
  (context.setLang as (lang: string) => void)("en");
  assert.match(
    getElement("timelineContainer").innerHTML,
    /Completed by follow-up/,
  );
  (context.returnToActivityList as () => void)();
  assert.match(getElement("timelineContainer").innerHTML, /2 updates/);
  context.fetch = async (url: string) =>
    url === "/api/entries/new" ? { ok: false } : originalFetch(url);
  context.console = { error: () => {} };
  await (context.fetchData as () => Promise<void>)();
  assert.equal(
    getElement("timelineContainer").textContent,
    "Could not load activity. Please retry.",
  );
  context.location = { search: "" };
  context.fetch = originalFetch;
  await (context.refreshData as () => Promise<void>)();

  // Verify pre-seeded localStorage ("en") and throwing localStorage fallback
  storage.set("pmgr_lang", "en");
  runInNewContext(scriptMatch[1], { ...context });
  assert.equal(getElement("appTitle").textContent, "Project Manager");

  const throwingContext = {
    ...context,
    localStorage: {
      getItem: () => {
        throw new Error("disabled");
      },
      setItem: () => {
        throw new Error("disabled");
      },
    },
  };
  runInNewContext(scriptMatch[1], throwingContext);
  assert.equal(getElement("appTitle").textContent, "项目管理");
});
