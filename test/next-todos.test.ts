import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addStatus,
  at,
  completeActivity,
  convertNextStep,
  createTodo,
  current,
  exportLedger,
  getEntry,
  handleRequest,
  history,
  importLedger,
  importStatuses,
  listTodos,
  openLedger,
  run,
  setProjectMetadata,
  startServer,
  updateTodo,
  validateStatusEntry,
  type Ledger,
  type Todo,
} from "../src/index.js";
import type { IncomingMessage, ServerResponse } from "node:http";

const occurred = "2026-03-01T00:00:00.000Z";
const recorded = "2026-03-01T01:00:00.000Z";

test("domain accepts ref lists and rejects mixed, duplicate, and oversized values", () => {
  const uid = randomUUID();
  const parsed = validateStatusEntry({
    project: "demo",
    summary: "refs",
    nextTodoUids: [uid],
    nextSteps: [],
    occurredAt: occurred,
  });
  assert.deepEqual(parsed.nextTodoUids, [uid]);
  assert.deepEqual(parsed.nextSteps, []);
  const empty = validateStatusEntry({
    project: "demo",
    summary: "none",
    nextTodoUids: [],
  });
  assert.deepEqual(empty.nextTodoUids, []);
  const absent = validateStatusEntry({
    project: "demo",
    summary: "legacy",
    nextSteps: ["keep"],
    nextTodoUids: null,
  });
  assert.equal("nextTodoUids" in absent, false);
  assert.deepEqual(absent.nextSteps, ["keep"]);
  assert.throws(
    () =>
      validateStatusEntry({
        project: "demo",
        summary: "mixed",
        nextSteps: ["text"],
        nextTodoUids: [uid],
      }),
    /cannot combine nextSteps text with nextTodoUids/,
  );
  assert.throws(
    () =>
      validateStatusEntry({
        project: "demo",
        summary: "dup",
        nextTodoUids: [uid, uid],
      }),
    /duplicate uid/,
  );
  assert.throws(
    () =>
      validateStatusEntry({
        project: "demo",
        summary: "bad",
        nextTodoUids: ["not-a-uuid"],
      }),
    /UUID/,
  );
  assert.throws(
    () =>
      validateStatusEntry({
        project: "demo",
        summary: "shape",
        nextTodoUids: "nope",
      }),
    /at most 100 uuids/,
  );
  assert.throws(
    () =>
      validateStatusEntry({
        project: "demo",
        summary: "long",
        nextTodoUids: Array.from({ length: 101 }, () => randomUUID()),
      }),
    /at most 100 uuids/,
  );
  assert.throws(
    () =>
      validateStatusEntry({
        project: "demo",
        summary: "both",
        nextTodoUids: [],
        nextStepsSourceUid: uid,
      }),
    /invalid next step provenance/,
  );
  const rejected = openLedger(":memory:");
  try {
    assert.throws(
      () =>
        addStatus(rejected, {
          project: "demo",
          summary: "copy",
          nextSteps: ["x"],
          nextStepsSourceUid: uid,
        }),
      /new snapshots cannot set nextStepsSourceUid/,
    );
  } finally {
    rejected.close();
  }
});

test("new writes store refs, keep Todo status independent, and resolve live rows", () => {
  const db = openLedger(":memory:");
  try {
    const first = addStatus(db, {
      project: "demo",
      status: "active",
      summary: "Start",
      nextSteps: ["Alpha", "Alpha"],
      occurredAt: occurred,
    }).entry;
    assert.deepEqual(first.nextSteps, []);
    assert.equal(first.nextTodoUids?.length, 2);
    assert.equal(new Set(first.nextTodoUids).size, 2);
    assert.equal(listTodos(db).length, 2);
    const pinned = first.nextTodoUids![0];
    updateTodo(db, pinned, { status: "cancelled" });
    const column = db
      .prepare("SELECT next_todo_uids_json FROM status_entries WHERE uid = ?")
      .get(first.uid) as { next_todo_uids_json: string };
    assert.equal(getEntry(db, first.uid)?.nextTodos?.[0]?.status, "cancelled");
    assert.equal(
      db
        .prepare("SELECT next_todo_uids_json FROM status_entries WHERE uid = ?")
        .get(first.uid) && column.next_todo_uids_json,
      column.next_todo_uids_json,
    );
    const cleared = addStatus(db, {
      project: "demo",
      status: "active",
      summary: "Unpin",
      nextTodoUids: [],
      occurredAt: "2026-03-02T00:00:00.000Z",
    }).entry;
    assert.deepEqual(cleared.nextTodoUids, []);
    assert.equal(
      listTodos(db).find((todo) => todo.uid === pinned)?.status,
      "cancelled",
    );
    assert.equal(
      at(db, "demo", "2026-03-02T00:00:00.000Z")?.nextTodos,
      undefined,
    );
    assert.deepEqual(
      at(db, "demo", "2026-03-01T00:00:00.000Z")?.nextTodoUids,
      first.nextTodoUids,
    );
    assert.equal(current(db, "demo")[0].nextTodos?.length, 0);
    db.prepare("DELETE FROM todos WHERE uid = ?").run(first.nextTodoUids![1]);
    assert.equal(
      history(db).find((entry) => entry.uid === first.uid)?.nextTodos?.[1]
        ?.title,
      first.nextTodoUids![1],
    );
  } finally {
    db.close();
  }
});

test("legacy conversion keeps indexes until every step has a Todo, then materializes refs", () => {
  const db = openLedger(":memory:");
  const copy = openLedger(":memory:");
  try {
    importLedger(db, [
      {
        project: "legacy",
        status: "active",
        summary: "old",
        nextSteps: ["A", "B"],
        occurredAt: "2026-04-01T00:00:00.000Z",
      },
    ]);
    const source = history(db)[0];
    assert.equal("nextTodoUids" in source, false);
    const version2 = exportLedger(db);
    assert.equal(version2.version, 2);
    assert.equal("todos" in version2, false);
    assert.equal("nextTodoUids" in version2.entries[0], false);
    const version2Copy = openLedger(":memory:");
    try {
      importLedger(version2Copy, [version2]);
      assert.deepEqual(exportLedger(version2Copy), version2);
    } finally {
      version2Copy.close();
    }
    const first = convertNextStep(db, source.uid, 0);
    updateTodo(db, first.uid, { status: "completed" });
    completeActivity(db, source.uid);
    const copied = current(db, "legacy")[0];
    assert.deepEqual(copied.nextSteps, ["A", "B"]);
    assert.equal(copied.nextStepsSourceUid, source.uid);
    assert.equal(copied.nextTodoUids, undefined);
    completeActivity(db, copied.uid);
    const recopied = current(db, "legacy")[0];
    assert.deepEqual(recopied.nextSteps, ["A", "B"]);
    assert.equal(recopied.nextStepsSourceUid, source.uid);
    const second = convertNextStep(db, recopied.uid, 1);
    assert.equal(second.title, "B");
    assert.equal(second.stepIndex, 1);
    assert.equal(listTodos(db).length, 2);
    assert.equal(
      listTodos(db).find((todo) => todo.uid === first.uid)?.status,
      "completed",
    );
    completeActivity(db, recopied.uid);
    const materialized = current(db, "legacy")[0];
    assert.deepEqual(materialized.nextSteps, []);
    assert.deepEqual(materialized.nextTodoUids, [first.uid, second.uid]);
    assert.equal(materialized.nextStepsSourceUid, undefined);
    assert.equal(listTodos(db).length, 2);
    assert.equal(materialized.nextTodos?.[0]?.status, "completed");
    assert.equal(materialized.nextTodos?.[1]?.status, "open");
    completeActivity(db, materialized.uid);
    assert.deepEqual(current(db, "legacy")[0].nextTodoUids, [
      first.uid,
      second.uid,
    ]);
    assert.equal(listTodos(db).length, 2);
    const bundle = exportLedger(db);
    assert.equal(bundle.version, 4);
    assert.equal(
      "nextTodoUids" in
        bundle.entries.find((entry) => entry.uid === source.uid)!,
      false,
    );
    importLedger(copy, [bundle]);
    importLedger(copy, [bundle]);
    assert.deepEqual(exportLedger(copy), bundle);
    assert.equal(
      listTodos(copy).find((todo) => todo.uid === first.uid)?.status,
      "completed",
    );
  } finally {
    db.close();
    copy.close();
  }
});

test("empty legacy completion materializes explicit refs and does not invent Todos", () => {
  const db = openLedger(":memory:");
  try {
    importLedger(db, [
      {
        project: "quiet",
        status: "active",
        summary: "empty",
        occurredAt: "2026-04-02T00:00:00.000Z",
      },
    ]);
    const entry = history(db)[0];
    completeActivity(db, entry.uid);
    const followUp = current(db, "quiet")[0];
    assert.deepEqual(followUp.nextTodoUids, []);
    assert.deepEqual(followUp.nextSteps, []);
    assert.equal(followUp.nextStepsSourceUid, undefined);
    assert.equal(listTodos(db).length, 0);
  } finally {
    db.close();
  }
});

test("ownership rejects cross-project refs and any project change after a historical pin", () => {
  const db = openLedger(":memory:");
  try {
    setProjectMetadata(db, { project: "alpha" });
    setProjectMetadata(db, { project: "beta" });
    const free = createTodo(db, { title: "Shared" });
    const owned = createTodo(db, { title: "Alpha only", project: "alpha" });
    const pinned = addStatus(db, {
      project: "alpha",
      status: "active",
      summary: "Pin",
      nextTodoUids: [free.uid, owned.uid],
      occurredAt: occurred,
    }).entry;
    assert.throws(
      () =>
        addStatus(db, {
          project: "beta",
          status: "active",
          summary: "Nope",
          nextTodoUids: [owned.uid],
          occurredAt: "2026-03-02T00:00:00.000Z",
        }),
      /cross-project next todo ref/,
    );
    assert.equal(history(db, "beta").length, 0);
    assert.throws(
      () =>
        addStatus(db, {
          project: "alpha",
          status: "active",
          summary: "Missing",
          nextTodoUids: [randomUUID()],
          occurredAt: "2026-03-02T00:00:00.000Z",
        }),
      /dangling next todo uid/,
    );
    assert.throws(
      () => updateTodo(db, free.uid, { project: "alpha" }),
      /referenced todo project cannot change/,
    );
    addStatus(db, {
      project: "alpha",
      status: "active",
      summary: "Unpin",
      nextTodoUids: [],
      occurredAt: "2026-03-03T00:00:00.000Z",
    });
    assert.throws(
      () => updateTodo(db, free.uid, { project: "beta" }),
      /referenced todo project cannot change/,
    );
    assert.equal(
      updateTodo(db, owned.uid, { project: "alpha" }).project,
      "alpha",
    );
    assert.throws(
      () => updateTodo(db, owned.uid, { project: null }),
      /referenced todo project cannot change/,
    );
    const loose = createTodo(db, { title: "Loose", project: "alpha" });
    assert.equal(updateTodo(db, loose.uid, { project: null }).project, null);
    assert.throws(
      () => updateTodo(db, loose.uid, { project: "missing" }),
      /project not found/,
    );
    const linked = createTodo(db, { title: "Linked", entryUid: pinned.uid });
    assert.equal(
      updateTodo(db, linked.uid, { project: "alpha" }).project,
      "alpha",
    );
    const bundle = exportLedger(db, "alpha");
    assert.ok(bundle.todos?.some((todo: Todo) => todo.uid === free.uid));
    const beta = exportLedger(db, "beta");
    assert.equal(beta.version, 2);
    assert.equal("todos" in beta, false);
  } finally {
    db.close();
  }
});

test("import fails atomically on dangling, mixed, and cross-project refs", () => {
  const db = openLedger(":memory:");
  try {
    const entryUid = randomUUID();
    const todoUid = randomUUID();
    const baseEntry = {
      uid: entryUid,
      project: "alpha",
      status: "active",
      summary: "Imported",
      nextSteps: [],
      nextTodoUids: [todoUid],
      occurredAt: occurred,
      recordedAt: recorded,
      source: "import",
    };
    const todo = {
      uid: todoUid,
      title: "Work",
      project: "beta",
      entryUid: null,
      stepIndex: null,
      status: "open",
      createdAt: recorded,
      completedAt: null,
    };
    assert.throws(
      () =>
        importLedger(db, [
          {
            project: "keep",
            status: "active",
            summary: "should roll back",
            occurredAt: "2026-01-01T00:00:00.000Z",
          },
          { version: 4, entries: [baseEntry], completions: [], todos: [] },
        ]),
      /dangling next todo uid/,
    );
    assert.equal(history(db).length, 0);
    assert.throws(
      () =>
        importLedger(db, [
          { version: 4, entries: [baseEntry], completions: [], todos: [todo] },
        ]),
      /cross-project next todo ref/,
    );
    assert.equal(history(db).length, 0);
    assert.throws(
      () =>
        importLedger(db, [
          {
            version: 4,
            entries: [
              { ...baseEntry, nextSteps: ["text"], nextTodoUids: [todoUid] },
            ],
            completions: [],
            todos: [{ ...todo, project: "alpha" }],
          },
        ]),
      /cannot combine/,
    );
    assert.throws(
      () => importLedger(db, [{ version: 4, entries: [], completions: [] }]),
      /invalid ledger bundle/,
    );
    const good = {
      version: 4,
      entries: [baseEntry],
      completions: [],
      todos: [{ ...todo, project: "alpha" }],
    };
    importLedger(db, [good]);
    const mismatched = structuredClone(good);
    mismatched.todos[0].stepIndex = 0;
    mismatched.todos[0].entryUid = entryUid;
    mismatched.todos[0].uid = randomUUID();
    const fresh = openLedger(":memory:");
    try {
      assert.throws(
        () => importLedger(fresh, [mismatched]),
        /invalid next step index/,
      );
      const negative = structuredClone(good);
      negative.todos[0].entryUid = entryUid;
      negative.todos[0].stepIndex = -1;
      assert.throws(
        () => importLedger(fresh, [negative]),
        /invalid next step index/,
      );
      const fractional = structuredClone(good);
      fractional.todos[0].entryUid = entryUid;
      fractional.todos[0].stepIndex = 1.5;
      assert.throws(
        () => importLedger(fresh, [fractional]),
        /invalid next step index/,
      );
      const unlinked = structuredClone(good);
      unlinked.todos[0].entryUid = null;
      unlinked.todos[0].stepIndex = 0;
      assert.throws(
        () => importLedger(fresh, [unlinked]),
        /next step requires a source/,
      );
      const legacy = openLedger(":memory:");
      try {
        importLedger(legacy, [
          {
            uid: randomUUID(),
            project: "legacy",
            status: "active",
            summary: "text",
            nextSteps: ["Only"],
            occurredAt: occurred,
            source: "import",
          },
        ]);
        const legacyEntry = history(legacy)[0];
        assert.throws(
          () =>
            importLedger(legacy, [
              {
                version: 3,
                entries: [],
                completions: [],
                todos: [
                  {
                    uid: randomUUID(),
                    title: "Wrong",
                    project: "legacy",
                    entryUid: legacyEntry.uid,
                    stepIndex: 0,
                    status: "open",
                    createdAt: recorded,
                    completedAt: null,
                  },
                ],
              },
            ]),
          /invalid next step index/,
        );
      } finally {
        legacy.close();
      }
    } finally {
      fresh.close();
    }
  } finally {
    db.close();
  }
});

test("open Todo listing prefers current pins and CLI rejects mixed next flags", () => {
  const directory = mkdtempSync(join(tmpdir(), "pmgr-refs-"));
  const previous = process.env.PMGR_DB_PATH;
  process.env.PMGR_DB_PATH = join(directory, "ledger.sqlite");
  const execute = (args: string[]) => {
    let out = "";
    run(args, (text) => {
      out += text;
    });
    return out;
  };
  try {
    execute(["set-project", "--project", "demo"]);
    const first = JSON.parse(
      execute(["todo-add", "--title", "First", "--project", "demo", "--json"]),
    ) as Todo;
    const second = JSON.parse(
      execute(["todo-add", "--title", "Second", "--project", "demo", "--json"]),
    ) as Todo;
    const third = JSON.parse(
      execute(["todo-add", "--title", "Third", "--project", "demo", "--json"]),
    ) as Todo;
    const added = JSON.parse(
      execute([
        "add",
        "--project",
        "demo",
        "--status",
        "active",
        "--summary",
        "Order",
        "--next-todo",
        second.uid,
        "--next-todo",
        first.uid,
        "--json",
      ]),
    ) as { nextTodoUids?: string[] };
    assert.deepEqual(added.nextTodoUids, [second.uid, first.uid]);
    const open = JSON.parse(
      execute(["todos", "--project", "demo", "--status", "open", "--json"]),
    ) as Todo[];
    assert.deepEqual(
      open.map((todo) => todo.uid),
      [second.uid, first.uid, third.uid],
    );
    const createdOrder = [first, second, third]
      .slice()
      .sort(
        (left, right) =>
          left.createdAt.localeCompare(right.createdAt) ||
          left.uid.localeCompare(right.uid),
      )
      .map((todo) => todo.uid);
    assert.deepEqual(
      JSON.parse(execute(["todos", "--status", "open", "--json"])).map(
        (todo: Todo) => todo.uid,
      ),
      createdOrder,
    );
    execute(["todo-update", "--uid", second.uid, "--status", "completed"]);
    assert.deepEqual(
      JSON.parse(
        execute(["todos", "--project", "demo", "--status", "open", "--json"]),
      ).map((todo: Todo) => todo.uid),
      [first.uid, third.uid],
    );
    assert.deepEqual(
      JSON.parse(
        execute([
          "todos",
          "--project",
          "demo",
          "--status",
          "completed",
          "--json",
        ]),
      ).map((todo: Todo) => todo.uid),
      [second.uid],
    );
    assert.throws(
      () => execute(["todos", "--status", "later"]),
      /--status must be open, completed, or cancelled/,
    );
    assert.throws(
      () =>
        execute([
          "add",
          "--project",
          "demo",
          "--summary",
          "Mixed",
          "--next",
          "Text",
          "--next-todo",
          first.uid,
        ]),
      /cannot combine --next and --next-todo/,
    );
    assert.throws(
      () =>
        execute([
          "add",
          "--project",
          "demo",
          "--summary",
          "Dup",
          "--next-todo",
          first.uid,
          "--next-todo",
          first.uid,
        ]),
      /duplicate uid/,
    );
    const created = JSON.parse(
      execute([
        "add",
        "--project",
        "fresh",
        "--status",
        "active",
        "--summary",
        "Sugar",
        "--next",
        "One",
        "--next",
        "One",
        "--json",
      ]),
    ) as { nextSteps: string[]; nextTodoUids: string[] };
    assert.deepEqual(created.nextSteps, []);
    assert.equal(created.nextTodoUids.length, 2);
  } finally {
    if (previous === undefined) delete process.env.PMGR_DB_PATH;
    else process.env.PMGR_DB_PATH = previous;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("malformed todo imports and missing activity completion are rejected", () => {
  const db = openLedger(":memory:");
  try {
    const entry = addStatus(db, {
      project: "demo",
      status: "active",
      summary: "Base",
      occurredAt: occurred,
    }).entry;
    const todo = createTodo(db, { title: "Loose", project: "demo" });
    assert.throws(
      () => updateTodo(db, randomUUID(), { status: "open" }),
      /todo not found/,
    );
    assert.throws(
      () => updateTodo(db, todo.uid, { status: "later" }),
      /invalid todo status/,
    );
    assert.throws(() => completeActivity(db, randomUUID()), /entry not found/);
    const baseTodo = {
      uid: randomUUID(),
      title: "Ok",
      project: "demo",
      entryUid: null,
      stepIndex: null,
      status: "open",
      createdAt: recorded,
      completedAt: null,
    };
    const bundle = (override: Record<string, unknown>) => [
      {
        version: 3 as const,
        entries: [],
        completions: [],
        todos: [{ ...baseTodo, uid: randomUUID(), ...override }],
      },
    ];
    assert.throws(
      () => importLedger(db, bundle({ title: 1 })),
      /invalid todo title/,
    );
    assert.throws(
      () => importLedger(db, bundle({ title: "   " })),
      /invalid todo title/,
    );
    assert.throws(
      () => importLedger(db, bundle({ title: "x".repeat(2001) })),
      /invalid todo title/,
    );
    assert.throws(
      () => importLedger(db, bundle({ status: "later" })),
      /invalid todo status/,
    );
    assert.throws(
      () => importLedger(db, bundle({ completedAt: recorded })),
      /invalid completion timestamp/,
    );
    assert.throws(
      () => importLedger(db, bundle({ entryUid: randomUUID() })),
      /invalid todo source/,
    );
    assert.throws(
      () => importLedger(db, bundle({ entryUid: entry.uid, project: "other" })),
      /invalid todo source/,
    );
    assert.throws(
      () => createTodo(db, { title: "Missing", entryUid: randomUUID() }),
      /entry not found/,
    );
    const elsewhere = addStatus(db, {
      project: "other",
      status: "active",
      summary: "Elsewhere",
      occurredAt: "2026-03-02T00:00:00.000Z",
    }).entry;
    assert.throws(
      () =>
        createTodo(db, {
          title: "Mismatch",
          project: "demo",
          entryUid: elsewhere.uid,
        }),
      /source project mismatch/,
    );
    const legacy = importLedger(db, [
      {
        project: "legacy",
        status: "active",
        summary: "source",
        nextSteps: ["A"],
        occurredAt: "2026-04-01T00:00:00.000Z",
      },
    ])[0].entry;
    completeActivity(db, legacy.uid);
    const copied = current(db, "legacy")[0];
    for (const bad of [
      {
        project: "legacy",
        summary: "missing origin",
        nextSteps: ["A"],
        nextStepsSourceUid: randomUUID(),
        occurredAt: "2026-04-03T00:00:00.000Z",
      },
      {
        project: "legacy",
        summary: "copy of a copy",
        nextSteps: ["A"],
        nextStepsSourceUid: copied.uid,
        occurredAt: "2026-04-04T00:00:00.000Z",
      },
      {
        project: "demo",
        summary: "wrong project",
        nextSteps: ["A"],
        nextStepsSourceUid: legacy.uid,
        occurredAt: "2026-04-05T00:00:00.000Z",
      },
      {
        project: "legacy",
        summary: "not later",
        nextSteps: ["A"],
        nextStepsSourceUid: legacy.uid,
        occurredAt: legacy.occurredAt,
      },
      {
        project: "legacy",
        summary: "different text",
        nextSteps: ["B"],
        nextStepsSourceUid: legacy.uid,
        occurredAt: "2026-04-06T00:00:00.000Z",
      },
    ])
      assert.throws(
        () => importLedger(db, [bad]),
        /invalid next step provenance/,
      );
    setProjectMetadata(db, { project: "pins" });
    const left = createTodo(db, { title: "Left", project: "pins" });
    const right = createTodo(db, { title: "Right", project: "pins" });
    const done = createTodo(db, { title: "Done", project: "pins" });
    addStatus(db, {
      project: "pins",
      status: "active",
      summary: "Pinned done",
      nextTodoUids: [done.uid],
      occurredAt: "2026-05-02T00:00:00.000Z",
    });
    updateTodo(db, done.uid, { status: "completed" });
    const openPins = listTodos(db, "pins", { status: "open" }).map(
      (todo) => todo.uid,
    );
    assert.deepEqual(openPins.slice().sort(), [left.uid, right.uid].sort());
  } finally {
    db.close();
  }
});

test("non-Error mutation failures use the generic message", async () => {
  const db = openLedger(":memory:");
  const proxy = new Proxy(db, {
    get(target, prop, receiver) {
      if (prop === "prepare")
        return () => {
          throw "boom";
        };
      return Reflect.get(target, prop, receiver);
    },
  });
  const server = await startServer({
    port: 0,
    open: false,
    db: proxy as unknown as Ledger,
  });
  try {
    const response = await fetch(server.url + "/api/todos", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: server.url,
      },
      body: '{"title":"x"}',
    });
    assert.equal(response.status, 500);
    assert.equal(
      ((await response.json()) as { error: string }).error,
      "Request failed",
    );
  } finally {
    await server.close();
    db.close();
  }
});

test("HTTP todo listing accepts a status filter", async () => {
  const db = openLedger(":memory:");
  const server = await startServer({ port: 0, open: false, db });
  try {
    addStatus(db, {
      project: "demo",
      status: "active",
      summary: "Listed",
      nextSteps: ["Open work"],
    });
    assert.equal(
      (await fetch(server.url + "/api/todos?status=nope")).status,
      400,
    );
    const body = (await fetch(server.url + "/api/todos?status=open").then(
      (response) => response.json(),
    )) as Todo[];
    assert.equal(body.length, 1);
    assert.equal(body[0]?.status, "open");
    assert.equal(listTodos(db, undefined, {}).length, 1);
    assert.equal(
      (
        await fetch(server.url + "/api/todos", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: server.url,
            "sec-fetch-site": "cross-site",
          },
          body: "{}",
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(server.url + "/api/todos", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: server.url,
            "sec-fetch-site": "same-origin",
          },
          body: "not-json",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(server.url + "/api/todos/%E0%A4%A", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: server.url,
          },
          body: "{}",
        })
      ).status,
      400,
    );
    const legacyEntry = importLedger(db, [
      {
        project: "oldstep",
        status: "active",
        summary: "convertible",
        nextSteps: ["Step"],
        occurredAt: "2026-01-01T00:00:00.000Z",
      },
    ])[0].entry;
    const postEntry = (path: string, body: unknown) =>
      fetch(server.url + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: server.url,
        },
        body: JSON.stringify(body),
      });
    assert.equal(
      (await postEntry("/api/entries/" + legacyEntry.uid + "/complete", null))
        .status,
      400,
    );
    assert.equal(
      (await postEntry("/api/entries/" + legacyEntry.uid + "/complete", []))
        .status,
      400,
    );
    assert.equal(
      (await postEntry("/api/entries/" + legacyEntry.uid + "/todos", "x"))
        .status,
      400,
    );
    assert.equal(
      (
        await postEntry("/api/entries/" + legacyEntry.uid + "/complete", {
          extra: true,
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await postEntry("/api/entries/" + legacyEntry.uid + "/todos", {
          index: 0,
        })
      ).status,
      200,
    );
    assert.equal(
      (
        await postEntry("/api/entries/" + legacyEntry.uid + "/todos", {
          index: 0,
          extra: true,
        })
      ).status,
      400,
    );
    let posted = 0;
    handleRequest(
      { method: "POST", url: undefined, headers: {} } as IncomingMessage,
      {
        writeHead(code: number) {
          posted = code;
        },
        end() {},
      } as ServerResponse,
      db,
    );
    assert.equal(posted, 405);
    db.close();
    assert.equal(
      (
        await fetch(server.url + "/api/todos", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: server.url,
          },
          body: '{"title":"x"}',
        })
      ).status,
      500,
    );
    const legacy = openLedger(":memory:");
    try {
      importLedger(legacy, [
        {
          project: "old",
          status: "active",
          summary: "strings",
          nextSteps: ["Later"],
        },
      ]);
      createTodo(legacy, { title: "Aside", project: "old" });
      assert.equal(listTodos(legacy, "old", { status: "open" }).length, 1);
      addStatus(legacy, {
        project: "old",
        status: "active",
        summary: "Clear pins",
        nextTodoUids: [],
        occurredAt: "2026-05-01T00:00:00.000Z",
      });
      assert.equal(listTodos(legacy, "old", { status: "open" }).length, 1);
      assert.throws(
        () => listTodos(legacy, "old", { status: "later" as Todo["status"] }),
        /invalid todo status/,
      );
    } finally {
      legacy.close();
    }
  } finally {
    await server.close();
    if (db.open) db.close();
  }
});

test("importStatuses rejects dangling and cross-project refs atomically", () => {
  const db = openLedger(":memory:");
  try {
    setProjectMetadata(db, { project: "beta" });
    const owned = createTodo(db, { title: "Beta work", project: "beta" });
    const occurredAt = "2026-07-01T00:00:00.000Z";
    const keep = {
      project: "keep",
      status: "active" as const,
      summary: "should roll back",
      occurredAt,
    };
    assert.throws(
      () =>
        importStatuses(db, [
          keep,
          {
            project: "alpha",
            status: "active",
            summary: "dangling",
            nextTodoUids: [randomUUID()],
            occurredAt: "2026-07-02T00:00:00.000Z",
          },
        ]),
      /dangling next todo uid/,
    );
    assert.equal(history(db).length, 0);
    assert.throws(
      () =>
        importStatuses(db, [
          keep,
          {
            project: "alpha",
            status: "active",
            summary: "foreign",
            nextTodoUids: [owned.uid],
            occurredAt: "2026-07-02T00:00:00.000Z",
          },
        ]),
      /cross-project next todo ref/,
    );
    assert.equal(history(db).length, 0);
    assert.equal(listTodos(db).length, 1);
  } finally {
    db.close();
  }
});

test("importLedger rejects refs whose Todos are absent from the payload", () => {
  const entry = {
    uid: randomUUID(),
    project: "demo",
    status: "active" as const,
    summary: "Pinned locally",
    nextSteps: [] as string[],
    occurredAt: "2026-07-03T00:00:00.000Z",
    recordedAt: "2026-07-03T01:00:00.000Z",
    source: "import" as const,
  };
  const populated = openLedger(":memory:");
  const empty = openLedger(":memory:");
  try {
    const local = createTodo(populated, { title: "Already here" });
    const bundle = {
      version: 4 as const,
      entries: [{ ...entry, nextTodoUids: [local.uid] }],
      completions: [],
      todos: [],
    };
    const keep = {
      project: "keep",
      status: "active" as const,
      summary: "rolls back",
      occurredAt: "2026-07-01T00:00:00.000Z",
    };
    assert.throws(
      () => importLedger(populated, [keep, bundle]),
      /dangling next todo uid/,
    );
    assert.equal(history(populated).length, 0);
    assert.equal(listTodos(populated).length, 1);
    assert.throws(
      () =>
        importLedger(empty, [
          { version: 4, entries: [], completions: [], todos: null },
        ]),
      /invalid ledger bundle/,
    );
    assert.throws(
      () => importLedger(empty, [keep, bundle]),
      /dangling next todo uid/,
    );
    assert.equal(history(empty).length, 0);
    assert.equal(listTodos(empty).length, 0);
  } finally {
    populated.close();
    empty.close();
  }
});

test("fixed-UID text retries match the stored refs without duplicating Todos", () => {
  const db = openLedger(":memory:");
  try {
    const occurredAt = "2026-08-01T00:00:00.000Z";
    const uid = randomUUID();
    const input = {
      uid,
      project: "demo",
      status: "active" as const,
      summary: "Work",
      nextSteps: ["Alpha", "Beta"],
      occurredAt,
    };
    const first = addStatus(db, input);
    assert.equal(first.inserted, true);
    const original = listTodos(db);
    assert.equal(original.length, 2);
    updateTodo(db, original[0].uid, { status: "completed" });
    const retry = addStatus(db, input);
    assert.equal(retry.inserted, false);
    assert.equal(retry.entry.uid, uid);
    assert.equal(listTodos(db).length, 2);
    assert.deepEqual(
      listTodos(db).map((todo) => todo.uid),
      original.map((todo) => todo.uid),
    );
    assert.equal(
      listTodos(db).find((todo) => todo.uid === original[0].uid)?.status,
      "completed",
    );
    const referenced = randomUUID();
    const withRef = {
      uid: referenced,
      project: "demo",
      status: "active" as const,
      summary: "Referenced",
      nextSteps: ["Gamma"],
      occurredAt: "2026-08-02T00:00:00.000Z",
      externalRef: "fixed-retry",
    };
    assert.equal(addStatus(db, withRef).inserted, true);
    const second = addStatus(db, withRef);
    assert.equal(second.inserted, false);
    assert.equal(second.entry.uid, referenced);
    assert.equal(listTodos(db).length, 3);
    const bare = randomUUID();
    const empty = {
      uid: bare,
      project: "demo",
      status: "active" as const,
      summary: "Empty",
      nextSteps: [] as string[],
      occurredAt: "2026-08-03T00:00:00.000Z",
    };
    assert.equal(addStatus(db, empty).inserted, true);
    assert.equal(addStatus(db, empty).inserted, false);
    assert.throws(
      () => addStatus(db, { ...input, summary: "Changed" }),
      /conflicting entry uid/,
    );
    assert.throws(
      () =>
        addStatus(db, {
          ...input,
          nextSteps: [],
          nextTodoUids: [randomUUID()],
        }),
      /conflicting entry uid/,
    );
    assert.throws(
      () => addStatus(db, { ...input, nextSteps: ["Alpha"] }),
      /conflicting entry uid/,
    );
    assert.throws(
      () => addStatus(db, { ...input, nextSteps: ["Alpha", "Other"] }),
      /conflicting entry uid/,
    );
    assert.equal(listTodos(db).length, 3);
    db.prepare("DELETE FROM todos WHERE uid = ?").run(original[1].uid);
    assert.throws(() => addStatus(db, input), /conflicting entry uid/);
    const legacyUid = randomUUID();
    importStatuses(db, [
      {
        uid: legacyUid,
        project: "old",
        status: "active",
        summary: "Legacy",
        nextSteps: ["Text"],
        occurredAt: "2026-08-04T00:00:00.000Z",
      },
    ]);
    assert.throws(
      () =>
        importStatuses(db, [
          {
            uid: legacyUid,
            project: "old",
            status: "active",
            summary: "Changed",
            nextSteps: ["Text"],
            occurredAt: "2026-08-04T00:00:00.000Z",
          },
        ]),
      /conflicting entry uid/,
    );
    assert.throws(
      () =>
        addStatus(db, {
          uid: legacyUid,
          project: "old",
          status: "active",
          summary: "Legacy",
          nextSteps: ["Text"],
          occurredAt: "2026-08-04T00:00:00.000Z",
        }),
      /conflicting entry uid/,
    );
  } finally {
    db.close();
  }
});

test("importStatuses cannot reference a Todo that already exists outside the payload", () => {
  const db = openLedger(":memory:");
  try {
    const local = createTodo(db, { title: "Already stored" });
    assert.equal(local.project, null);
    assert.throws(
      () =>
        importStatuses(db, [
          {
            project: "keep",
            status: "active",
            summary: "rolls back",
            occurredAt: "2026-07-01T00:00:00.000Z",
          },
          {
            project: "demo",
            status: "active",
            summary: "pins a local todo",
            nextTodoUids: [local.uid],
            occurredAt: "2026-07-02T00:00:00.000Z",
          },
        ]),
      /dangling next todo uid/,
    );
    assert.equal(history(db).length, 0);
    assert.deepEqual(
      listTodos(db).map((todo) => todo.uid),
      [local.uid],
    );
  } finally {
    db.close();
  }
});

test("import identity stays strict when a refs snapshot is rewritten as text", () => {
  const db = openLedger(":memory:");
  try {
    const uid = randomUUID();
    const occurredAt = "2026-09-01T00:00:00.000Z";
    const created = addStatus(db, {
      uid,
      project: "demo",
      status: "active",
      summary: "Exported",
      nextSteps: ["Alpha", "Beta"],
      occurredAt,
      externalRef: "portable",
    });
    const bundle = exportLedger(db);
    importLedger(db, [structuredClone(bundle)]);
    const before = exportLedger(db);
    assert.deepEqual(before, bundle);
    const stored = history(db).find((entry) => entry.uid === uid);
    assert.deepEqual(stored?.nextSteps, []);
    assert.deepEqual(stored?.nextTodoUids, created.entry.nextTodoUids);
    const mutated = structuredClone(bundle);
    const entry = mutated.entries.find((item) => item.uid === uid);
    assert.ok(entry);
    delete entry.nextTodoUids;
    entry.nextSteps = ["Alpha", "Beta"];
    assert.throws(
      () =>
        importLedger(db, [
          {
            project: "keep",
            status: "active",
            summary: "rolls back",
            occurredAt: "2026-09-02T00:00:00.000Z",
          },
          mutated,
        ]),
      /conflicting entry uid/,
    );
    assert.equal(history(db, "keep").length, 0);
    assert.deepEqual(exportLedger(db), before);
    assert.equal(listTodos(db).length, 2);
    assert.deepEqual(
      history(db).find((item) => item.uid === uid)?.nextTodoUids,
      created.entry.nextTodoUids,
    );
  } finally {
    db.close();
  }
});
