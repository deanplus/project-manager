import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { request } from "node:http";
import {
  addStatus,
  completeActivity,
  convertNextStep,
  createTodo,
  current,
  exportLedger,
  getEntry,
  history,
  importLedger,
  listTodos,
  openLedger,
  setProjectMetadata,
  startServer,
  updateTodo,
  run,
} from "../src/index.js";

test("Todos are independent, source-linked, idempotent, portable, and leave history intact", () => {
  const db = openLedger(":memory:");
  const copy = openLedger(":memory:");
  try {
    const entry = addStatus(db, {
      project: "demo",
      status: "active",
      summary: "Work",
      nextSteps: ["one", "two"],
      externalRef: "retry",
    }).entry;
    assert.equal(listTodos(db).length, 2);
    addStatus(db, {
      project: "demo",
      summary: "Retry",
      nextSteps: ["three"],
      externalRef: "retry",
    });
    assert.equal(listTodos(db).length, 2);
    assert.equal(
      convertNextStep(db, entry.uid, 0).uid,
      listTodos(db).find((t) => t.stepIndex === 0)!.uid,
    );
    const free = createTodo(db, { title: "Standalone" });
    assert.equal(free.project, null);
    updateTodo(db, free.uid, { project: "demo" });
    const linked = createTodo(db, { title: "Follow up", entryUid: entry.uid });
    assert.equal(linked.project, "demo");
    assert.throws(() => createTodo(db, { title: " " }));
    assert.throws(() => createTodo(db, { title: "x", project: "missing" }));
    assert.throws(() => updateTodo(db, linked.uid, { project: null }));
    assert.throws(() => convertNextStep(db, entry.uid, -1));
    completeActivity(db, entry.uid);
    assert.equal(getEntry(db, entry.uid)!.effectiveStatus, "completed");
    assert.equal(getEntry(db, entry.uid)!.status, "active");
    assert.equal(current(db, "demo")[0].status, "active");
    assert.ok(listTodos(db).every((t) => t.status === "open"));
    const count = history(db).length;
    completeActivity(db, entry.uid);
    assert.equal(history(db).length, count);
    const done = updateTodo(db, free.uid, { status: "completed" });
    assert.equal(
      updateTodo(db, free.uid, { status: "completed" }).completedAt,
      done.completedAt,
    );
    const bundle = exportLedger(db);
    importLedger(copy, [bundle]);
    importLedger(copy, [bundle]);
    assert.deepEqual(exportLedger(copy), bundle);
    updateTodo(copy, free.uid, { status: "open" });
    assert.throws(() => importLedger(copy, [bundle]), /conflicting todo/);
    assert.equal(
      listTodos(copy).find((t) => t.uid === free.uid)!.status,
      "open",
    );
    assert.equal(
      updateTodo(db, free.uid, { status: "cancelled" }).completedAt,
      null,
    );
  } finally {
    db.close();
    copy.close();
  }
});

test("legacy steps only convert explicitly; project-only todos survive scoped exports", () => {
  const db = openLedger(":memory:");
  const copy = openLedger(":memory:");
  try {
    importLedger(db, [
      {
        project: "legacy",
        status: "active",
        summary: "old",
        nextSteps: ["later"],
      },
    ]);
    assert.equal(listTodos(db).length, 0);
    const entry = history(db)[0];
    convertNextStep(db, entry.uid, 0);
    convertNextStep(db, entry.uid, 0);
    assert.equal(listTodos(db).length, 1);
    setProjectMetadata(db, { project: "empty" });
    createTodo(db, { title: "Plan", project: "empty" });
    importLedger(copy, [exportLedger(db, "empty")]);
    assert.equal(listTodos(copy, "empty").length, 1);
  } finally {
    db.close();
    copy.close();
  }
});

test("dashboard write APIs enforce local origin, validate input, and persist changes", async () => {
  const db = openLedger(":memory:");
  const entry = addStatus(db, {
    project: "demo",
    status: "active",
    summary: "pending",
  }).entry;
  const server = await startServer({ port: 0, open: false, db });
  const post = (
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(server.url + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: server.url,
        ...headers,
      },
      body: JSON.stringify(body),
    });
  try {
    assert.equal(
      (
        await post(
          "/api/todos",
          { title: "x" },
          { Origin: "https://evil.example" },
        )
      ).status,
      403,
    );
    assert.equal(
      await new Promise<number | undefined>((resolve, reject) => {
        const req = request(
          server.url + "/api/todos",
          {
            method: "POST",
            headers: {
              Host: "evil.example",
              "Content-Type": "application/json",
            },
          },
          (res) => {
            res.resume();
            resolve(res.statusCode);
          },
        );
        req.on("error", reject);
        req.end('{"title":"x"}');
      }),
      403,
    );
    assert.equal(
      (
        await post(
          "/api/todos",
          { title: "x" },
          { "Content-Type": "text/plain" },
        )
      ).status,
      415,
    );
    assert.equal(
      (await post("/api/todos", { title: "x".repeat(40000) })).status,
      413,
    );
    assert.equal((await post("/api/todos", { title: "" })).status, 400);
    const response = await post("/api/todos", { title: "independent" });
    assert.equal(response.status, 200);
    const todo = (await response.json()) as { uid: string };
    assert.equal(
      (await post("/api/todos/" + todo.uid, { status: "completed" })).status,
      200,
    );
    assert.equal(listTodos(db)[0].status, "completed");
    assert.equal(
      (await post("/api/entries/" + entry.uid + "/todos", { title: "next" }))
        .status,
      200,
    );
    assert.equal(
      (await post("/api/entries/" + entry.uid + "/complete", {})).status,
      200,
    );
    assert.equal(getEntry(db, entry.uid)!.effectiveStatus, "completed");
    assert.equal(
      listTodos(db).find((t) => t.entryUid === entry.uid)!.status,
      "open",
    );
    assert.equal(
      (
        (await fetch(server.url + "/api/todos?project=demo").then((r) =>
          r.json(),
        )) as unknown[]
      ).length,
      1,
    );
  } finally {
    await server.close();
    db.close();
  }
});

test("Todo CLI creates, lists, and completes standalone work", () => {
  const directory = mkdtempSync(join(tmpdir(), "pmgr-todo-cli-"));
  const previous = process.env.PMGR_DB_PATH;
  process.env.PMGR_DB_PATH = join(directory, "ledger.sqlite");
  const execute = (args: string[]) => {
    let out = "";
    run(args, (t) => {
      out += t;
    });
    return out;
  };
  try {
    const todo = JSON.parse(
      execute(["todo-add", "--title", "Independent", "--json"]),
    ) as { uid: string };
    execute(["todo-update", "--uid", todo.uid, "--status", "completed"]);
    assert.equal(
      JSON.parse(execute(["todos", "--json"]))[0].status,
      "completed",
    );
    assert.match(execute(["todos"]), /completed.*Independent/);
  } finally {
    if (previous === undefined) delete process.env.PMGR_DB_PATH;
    else process.env.PMGR_DB_PATH = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("completing an older activity preserves current project context without duplicating Todos", () => {
  const db = openLedger(":memory:");
  try {
    const older = addStatus(db, {
      project: "demo",
      status: "active",
      summary: "Old",
      occurredAt: "2026-01-01T00:00:00Z",
    }).entry;
    const latest = addStatus(db, {
      project: "demo",
      status: "blocked",
      summary: "Current",
      progress: "Partial",
      blockers: ["Approval"],
      nextSteps: ["Wait"],
      decisions: ["Keep"],
      tags: ["urgent"],
      occurredAt: "2026-01-02T00:00:00Z",
    }).entry;
    completeActivity(db, older.uid);
    const now = current(db, "demo")[0];
    for (const field of [
      "status",
      "progress",
      "blockers",
      "nextSteps",
      "decisions",
      "tags",
    ] as const)
      assert.deepEqual(now[field], latest[field]);
    assert.equal(listTodos(db).length, 1);
    assert.equal(convertNextStep(db, now.uid, 0).uid, listTodos(db)[0].uid);
    assert.equal(listTodos(db).length, 1);
    const copy = openLedger(":memory:");
    try {
      importLedger(copy, [exportLedger(db)]);
      assert.equal(
        convertNextStep(copy, now.uid, 0).uid,
        listTodos(copy)[0].uid,
      );
      assert.equal(listTodos(copy).length, 1);
    } finally {
      copy.close();
    }
  } finally {
    db.close();
  }
});

test("HTTP body decoding preserves UTF-8 across chunks", async () => {
  const db = openLedger(":memory:");
  const server = await startServer({ port: 0, open: false, db });
  try {
    const data = Buffer.from(JSON.stringify({ title: "中文" }));
    const cut = data.indexOf(Buffer.from("中")) + 1;
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(
        server.url + "/api/todos",
        { method: "POST", headers: { "Content-Type": "application/json" } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on("error", reject);
      req.write(data.subarray(0, cut));
      setTimeout(() => req.end(data.subarray(cut)), 20);
    });
    assert.equal(status, 200);
    assert.equal(listTodos(db)[0].title, "中文");
  } finally {
    await server.close();
    db.close();
  }
});
