import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import test from "node:test";
import {
  addStatus,
  convertNextStep,
  createTodo,
  current,
  exportLedger,
  history,
  importLedger,
  listTodos,
  openLedger,
  openWork,
  run,
  setProjectMetadata,
  startServer,
  updateTodo,
  type Todo,
} from "../src/index.js";

const start = "2026-11-04T10:00:00Z";
const due = "2026-11-04T11:00:00Z";
const metadata = {
  startAt: start,
  dueAt: due,
  content: "  detail\n第二行  ",
};
const nulls = { startAt: null, dueAt: null, content: null };
function fields(todo: Pick<Todo, "startAt" | "dueAt" | "content">) {
  return {
    startAt: todo.startAt,
    dueAt: todo.dueAt,
    content: todo.content,
  };
}

test("Todo creation defaults cover direct, snapshot and conversion paths", () => {
  const db = openLedger(":memory:");
  try {
    const free = createTodo(db, { title: "  direct  " });
    assert.equal(free.title, "direct");
    assert.deepEqual(fields(free), nulls);
    addStatus(db, { project: "demo", summary: "new", nextSteps: ["snapshot"] });
    importLedger(db, [
      { project: "legacy", summary: "old", nextSteps: ["legacy"] },
    ]);
    convertNextStep(db, current(db, "legacy")[0].uid, 0);
    for (const todo of listTodos(db)) assert.deepEqual(fields(todo), nulls);
    const timed = createTodo(db, {
      title: "timed",
      ...metadata,
      startAt: "2026-11-04T18:00:00+08:00",
    });
    assert.deepEqual(fields(timed), metadata);
    assert.equal(timed.status, "open");
    assert.equal(timed.completedAt, null);
    for (const input of [
      { startAt: start },
      { dueAt: due },
      { startAt: due, dueAt: due },
    ])
      assert.doesNotThrow(() =>
        createTodo(db, { title: "optional", ...input }),
      );
    assert.equal(
      createTodo(db, {
        title: "negative zero",
        dueAt: "2026-11-04T11:00:00-00:00",
      }).dueAt,
      due,
    );
    assert.equal(
      createTodo(db, { title: "leap", dueAt: "2024-02-29T00:00:00Z" }).dueAt,
      "2024-02-29T00:00:00Z",
    );
  } finally {
    db.close();
  }
});

test("strict schedule validation rejects normalization, precision and zone mistakes atomically", () => {
  const db = openLedger(":memory:");
  try {
    const invalid = [
      "",
      "2026-11-04",
      "2026-11-04T10:00Z",
      "2026-11-04T10:00:00",
      "2026-11-04T10:00:00.000Z",
      "2026-11-04T10:00:00.5Z",
      "2026-02-30T00:00:00Z",
      "2026-02-29T00:00:00Z",
      "2026-13-01T00:00:00Z",
      "2026-11-04T24:00:00Z",
      "2026-11-04T10:60:00Z",
      "2026-11-04T10:00:60Z",
      "2026-11-04t10:00:00z",
      "2026-11-04T10:00:00+24:00",
      "2026-11-04T10:00:00+08:60",
      "0000-01-01T00:00:00+01:00",
      "9999-12-31T23:59:59-01:00",
      123,
      {},
      false,
    ];
    for (const value of invalid) {
      for (const key of ["startAt", "dueAt"])
        assert.throws(() => createTodo(db, { title: "bad", [key]: value }));
    }
    assert.equal(listTodos(db).length, 0);
    const todo = createTodo(db, { title: "keep", ...metadata });
    for (const patch of [
      { startAt: "2026-11-04T11:00:01Z" },
      { dueAt: "2026-11-04T09:59:59Z" },
      { title: "" },
      { title: null },
      { title: "x".repeat(2001) },
      { content: 1 },
      { content: "x".repeat(8001) },
      { status: null },
      { status: "in-progress" },
      { project: "missing" },
    ]) {
      assert.throws(() =>
        updateTodo(db, todo.uid, {
          status: "completed",
          content: "changed",
          ...patch,
        }),
      );
      assert.deepEqual(listTodos(db), [todo]);
    }
    assert.throws(
      () => updateTodo(db, randomUUID(), { title: "missing" }),
      /todo not found/,
    );
  } finally {
    db.close();
  }
});

test("partial edits preserve identity and lifecycle; blank content and explicit null clear", () => {
  const db = openLedger(":memory:");
  try {
    const todo = createTodo(db, { title: "old", ...metadata });
    for (const key of [
      "uid",
      "entryUid",
      "stepIndex",
      "createdAt",
      "completedAt",
      "source",
      "externalRef",
    ])
      assert.throws(
        () => updateTodo(db, todo.uid, { [key]: null, title: "bad" }),
        /unknown field/,
      );
    assert.deepEqual(updateTodo(db, todo.uid, {}), todo);
    let changed = updateTodo(db, todo.uid, {
      title: "  renamed  ",
      status: "completed",
    });
    assert.equal(changed.uid, todo.uid);
    assert.equal(changed.createdAt, todo.createdAt);
    assert.equal(changed.title, "renamed");
    assert.ok(changed.completedAt);
    assert.deepEqual(fields(changed), metadata);
    assert.equal(
      updateTodo(db, todo.uid, { status: "completed", content: "other" })
        .completedAt,
      changed.completedAt,
    );
    for (const content of ["", " \n\t ", null])
      assert.equal(updateTodo(db, todo.uid, { content }).content, null);
    assert.equal(
      updateTodo(db, todo.uid, { content: "中".repeat(8000) }).content!.length,
      8000,
    );
    assert.equal(
      updateTodo(db, todo.uid, { content: "😀".repeat(4000) }).content!.length,
      8000,
    );
    assert.throws(() =>
      updateTodo(db, todo.uid, { content: "😀".repeat(4001) }),
    );
    changed = updateTodo(db, todo.uid, {
      startAt: null,
      dueAt: null,
      content: null,
    });
    assert.equal(changed.status, "completed");
    assert.deepEqual(fields(changed), nulls);
    updateTodo(db, todo.uid, metadata);
    for (const status of ["open", "cancelled"])
      assert.equal(updateTodo(db, todo.uid, { status }).completedAt, null);
    assert.deepEqual(fields(listTodos(db)[0]), metadata);
    setProjectMetadata(db, { project: "demo" });
    updateTodo(db, todo.uid, { project: "demo" });
    assert.equal(updateTodo(db, todo.uid, { project: null }).project, null);
  } finally {
    db.close();
  }
});

test("edits preserve pins, carry and source identity, while reuse follows current titles", () => {
  const db = openLedger(":memory:");
  try {
    const entry = addStatus(db, {
      project: "demo",
      summary: "first",
      nextSteps: ["Old"],
    }).entry;
    const uid = entry.nextTodoUids![0];
    const original = listTodos(db)[0];
    const renamed = updateTodo(db, uid, { title: "New", ...metadata });
    assert.equal(renamed.entryUid, original.entryUid);
    assert.equal(renamed.stepIndex, original.stepIndex);
    assert.deepEqual(current(db, "demo")[0].nextTodoUids, [uid]);
    assert.equal(history(db)[0].nextTodos![0].title, "New");
    let work = openWork(db, "demo")[0];
    assert.equal(work.kind, "todo");
    if (work.kind === "todo") assert.deepEqual(fields(work), metadata);
    assert.equal(work.pinIndex, 0);
    assert.throws(
      () => updateTodo(db, uid, { project: null, title: "bad" }),
      /source-linked/,
    );
    const reused = addStatus(db, {
      project: "demo",
      summary: "reuse",
      nextSteps: ["New"],
      nextMode: "carry",
    }).entry;
    assert.deepEqual(reused.nextTodoUids, [uid]);
    addStatus(db, {
      project: "demo",
      summary: "old is new",
      nextSteps: ["Old"],
      nextMode: "carry",
    });
    assert.equal(listTodos(db).length, 2);
    const collision = createTodo(db, { project: "demo", title: "New" });
    updateTodo(db, collision.uid, { title: "New" });
    assert.equal(listTodos(db).length, 3);
    const unassigned = createTodo(db, { title: "unassigned", ...metadata });
    addStatus(db, {
      project: "demo",
      summary: "pin unassigned",
      nextTodoUids: [unassigned.uid],
      nextMode: "carry",
    });
    updateTodo(db, unassigned.uid, { title: "unassigned edit" });
    assert.throws(
      () => updateTodo(db, unassigned.uid, { project: "demo" }),
      /referenced/,
    );
    const free = createTodo(db, { title: "free" });
    updateTodo(db, free.uid, { title: "free edit", ...metadata });
    work = openWork(db).find(
      (item) => item.kind === "todo" && item.uid === free.uid,
    )!;
    if (work.kind === "todo") assert.deepEqual(fields(work), metadata);
    assert.equal(work.project, null);
    updateTodo(db, uid, { status: "completed" });
    assert.ok(
      !openWork(db, "demo").some(
        (item) => item.kind === "todo" && item.uid === uid,
      ),
    );
    const carried = addStatus(db, {
      project: "demo",
      summary: "carry",
      nextMode: "carry",
    }).entry;
    assert.ok(!carried.nextTodoUids!.includes(uid));
    assert.deepEqual(entry.nextTodoUids, [uid]);
    // Replacing a commitment remains a separate creation/closure operation.
    const replacement = createTodo(db, {
      title: "new occurrence",
      project: "demo",
      dueAt: due,
    });
    const replaced = addStatus(db, {
      project: "demo",
      summary: "changed decision",
      nextMode: "carry",
      nextTodoUids: [replacement.uid],
      closeTodos: [{ uid: collision.uid, status: "cancelled" }],
    });
    assert.ok(replaced.entry.nextTodoUids!.includes(replacement.uid));
    assert.equal(
      listTodos(db).find((t) => t.uid === collision.uid)!.status,
      "cancelled",
    );
  } finally {
    db.close();
  }
});

test("fixed-UID text retry limitation after rename stays read-only; external-ref replay is unaffected", () => {
  const db = openLedger(":memory:");
  try {
    const input = {
      uid: randomUUID(),
      project: "demo",
      summary: "write",
      occurredAt: start,
      nextSteps: ["Old"],
    };
    const entry = addStatus(db, input).entry;
    updateTodo(db, entry.nextTodoUids![0], { title: "New", ...metadata });
    const before = exportLedger(db);
    assert.throws(() => addStatus(db, input), /conflicting entry uid/);
    assert.equal(
      addStatus(db, { ...input, nextSteps: ["New"] }).inserted,
      false,
    );
    assert.deepEqual(exportLedger(db), before);
    const ext = addStatus(db, {
      project: "demo",
      summary: "external",
      externalRef: "replay",
      nextSteps: ["External"],
    });
    updateTodo(db, ext.entry.nextTodoUids![0], { title: "Edited" });
    const again = exportLedger(db);
    assert.equal(
      addStatus(db, {
        project: "demo",
        summary: "different",
        externalRef: "replay",
        nextSteps: ["ignored"],
      }).inserted,
      false,
    );
    assert.deepEqual(exportLedger(db), again);
  } finally {
    db.close();
  }
});

test("v5 round-trips renamed legacy Todos and enforces versioned provenance and identity", () => {
  const db = openLedger(":memory:");
  const copy = openLedger(":memory:");
  try {
    importLedger(db, [
      { project: "demo", summary: "legacy", nextSteps: ["Old", "Unconverted"] },
    ]);
    const entry = current(db, "demo")[0];
    const todo = convertNextStep(db, entry.uid, 0);
    updateTodo(db, todo.uid, { title: "New", ...metadata });
    assert.equal(convertNextStep(db, entry.uid, 0).title, "New");
    assert.equal(current(db, "demo")[0].nextSteps[0], "Old");
    const legacy = openWork(db, "demo").find(
      (item) => item.kind === "legacy-step",
    )!;
    assert.equal("content" in legacy, false);
    const bundle = exportLedger(db);
    assert.equal(bundle.version, 5);
    importLedger(copy, [bundle]);
    const offset = structuredClone(bundle);
    offset.todos![0].startAt = "2026-11-04T18:00:00+08:00";
    importLedger(copy, [offset]);
    assert.deepEqual(exportLedger(copy), bundle);
    const badBundles = [
      { ...bundle, version: 6 },
      {
        ...bundle,
        todos: bundle.todos!.map((t) => ({ ...t, content: undefined })),
      },
      {
        ...bundle,
        todos: bundle.todos!.map((t) => ({
          ...t,
          dueAt: "2026-11-04T09:00:00Z",
        })),
      },
      { ...bundle, todos: bundle.todos!.map((t) => ({ ...t, stepIndex: 2 })) },
      {
        ...bundle,
        todos: bundle.todos!.map((t) => ({ ...t, entryUid: randomUUID() })),
      },
      {
        ...bundle,
        todos: bundle.todos!.map((t) => ({ ...t, project: "other" })),
      },
      {
        ...bundle,
        todos: bundle.todos!.map((t) => ({ ...t, source: "agent" })),
      },
    ];
    for (const bad of badBundles) {
      const empty = openLedger(":memory:");
      try {
        assert.throws(() => importLedger(empty, [bad]));
        assert.equal(history(empty).length, 0);
        assert.equal(listTodos(empty).length, 0);
      } finally {
        empty.close();
      }
    }
    const conflict = structuredClone(bundle);
    conflict.todos![0].content = "different";
    assert.throws(() => importLedger(copy, [conflict]), /conflicting todo uid/);
    assert.deepEqual(exportLedger(copy), bundle);
    for (const version of [3, 4]) {
      const empty = openLedger(":memory:");
      try {
        assert.throws(
          () => importLedger(empty, [{ ...bundle, version }]),
          /unknown field/,
        );
        const oldTodos = bundle.todos!.map((t) =>
          Object.fromEntries(
            Object.entries(t).filter(
              ([key]) => !["startAt", "dueAt", "content"].includes(key),
            ),
          ),
        );
        assert.throws(
          () => importLedger(empty, [{ ...bundle, version, todos: oldTodos }]),
          /invalid next step index/,
        );
        oldTodos[0].title = "Old";
        importLedger(empty, [{ ...bundle, version, todos: oldTodos }]);
        assert.deepEqual(fields(listTodos(empty)[0]), nulls);
      } finally {
        empty.close();
      }
    }
    const refs = addStatus(db, {
      project: "refs",
      summary: "new",
      nextSteps: ["ref"],
    }).entry;
    const corrupt = exportLedger(db, "refs");
    corrupt.todos![0].uid = randomUUID();
    assert.throws(
      () => importLedger(copy, [corrupt]),
      /invalid next step index/,
    );
    assert.ok(refs.nextTodoUids);
  } finally {
    db.close();
    copy.close();
  }
});

test("migration 6 preserves version-5 rows and interleaved patches from two connections", () => {
  const dir = mkdtempSync(join(tmpdir(), "pmgr-todo-migrate-"));
  const path = join(dir, "ledger.sqlite");
  const raw = new Database(path);
  raw.exec(
    readFileSync(new URL("./fixtures/schema-v5.sql", import.meta.url), "utf8"),
  );
  raw
    .prepare(
      "INSERT INTO projects(slug,display_name,created_at) VALUES ('demo','demo',?)",
    )
    .run(start);
  const entryUid = randomUUID();
  const pinnedUid = randomUUID();
  raw
    .prepare(
      "INSERT INTO status_entries(project_id,uid,status,summary,occurred_at,recorded_at,source,next_todo_uids_json) VALUES (1,?,'active','old',?,?,'human',?)",
    )
    .run(entryUid, start, start, JSON.stringify([pinnedUid]));
  const oldTodos = [
    {
      uid: pinnedUid,
      title: "pin",
      project: "demo",
      entryUid,
      stepIndex: 0,
      status: "open",
      createdAt: start,
      completedAt: null,
    },
    {
      uid: randomUUID(),
      title: "linked",
      project: "demo",
      entryUid,
      stepIndex: null,
      status: "open",
      createdAt: start,
      completedAt: null,
    },
    ...["completed", "cancelled"].map((status) => ({
      uid: randomUUID(),
      title: status,
      project: null,
      entryUid: null,
      stepIndex: null,
      status,
      createdAt: start,
      completedAt: status === "completed" ? due : null,
    })),
  ];
  for (const t of oldTodos)
    raw
      .prepare(
        "INSERT INTO todos(uid,title,project,entry_uid,step_index,status,created_at,completed_at) VALUES (?,?,?,?,?,?,?,?)",
      )
      .run(
        t.uid,
        t.title,
        t.project,
        t.entryUid,
        t.stepIndex,
        t.status,
        t.createdAt,
        t.completedAt,
      );
  raw.close();
  let db: ReturnType<typeof openLedger> | undefined;
  let other: ReturnType<typeof openLedger> | undefined;
  try {
    db = openLedger(path);
    assert.deepEqual(
      listTodos(db).map((t) => {
        const row = { ...t } as Partial<Todo>;
        delete row.startAt;
        delete row.dueAt;
        delete row.content;
        return row;
      }),
      oldTodos.sort((a, b) => a.uid.localeCompare(b.uid)),
    );
    for (const todo of listTodos(db)) assert.deepEqual(fields(todo), nulls);
    assert.equal(
      (
        db.prepare("SELECT max(version) AS v FROM schema_migrations").get() as {
          v: number;
        }
      ).v,
      6,
    );
    const uid = listTodos(db)[0].uid;
    other = openLedger(path);
    updateTodo(db, uid, { content: "first" });
    updateTodo(other, uid, { dueAt: due });
    updateTodo(db, uid, { content: "last" });
    assert.deepEqual(fields(listTodos(other)[0]), {
      ...nulls,
      dueAt: due,
      content: "last",
    });
    const saved = exportLedger(db);
    other.close();
    other = undefined;
    db.close();
    db = openLedger(path);
    assert.deepEqual(exportLedger(db), saved);
    const fresh = openLedger(":memory:");
    try {
      assert.deepEqual(
        db.prepare("PRAGMA table_info(todos)").all(),
        fresh.prepare("PRAGMA table_info(todos)").all(),
      );
    } finally {
      fresh.close();
    }
  } finally {
    other?.close();
    db?.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI edits, clear flags, JSON projections and JSON/JSONL scoped round trips", () => {
  const dir = mkdtempSync(join(tmpdir(), "pmgr-todo-cli-"));
  const previous = process.env.PMGR_DB_PATH;
  process.env.PMGR_DB_PATH = join(dir, "test.sqlite");
  const cli = (...args: string[]) => {
    let text = "";
    run(args, (chunk) => {
      text += chunk;
    });
    return text;
  };
  try {
    const todo = JSON.parse(
      cli(
        "status",
        "todo-add",
        "--title",
        "old",
        "--content",
        metadata.content,
        "--start-at",
        start,
        "--due-at",
        due,
        "--json",
      ),
    ) as Todo;
    assert.deepEqual(fields(todo), metadata);
    cli(
      "add",
      "--project",
      "demo",
      "--summary",
      "pin",
      "--next-todo",
      todo.uid,
    );
    const updated = JSON.parse(
      cli(
        "todo-update",
        "--uid",
        todo.uid,
        "--title",
        "new",
        "--clear-content",
        "--json",
      ),
    );
    assert.equal(updated.content, null);
    assert.equal(updated.dueAt, due);
    for (const field of ["content", "start-at", "due-at"]) {
      assert.throws(
        () =>
          cli(
            "todo-update",
            "--uid",
            todo.uid,
            `--${field}`,
            field === "content" ? "x" : start,
            `--clear-${field}`,
          ),
        /cannot specify both/,
      );
      cli("todo-update", "--uid", todo.uid, `--clear-${field}`);
      assert.throws(
        () => cli("todo-add", "--title", "bad", `--clear-${field}`),
        /unknown flag/,
      );
    }
    for (const field of ["start-at", "due-at"])
      assert.throws(() =>
        cli("todo-update", "--uid", todo.uid, `--${field}`, ""),
      );
    for (const field of [
      "entry",
      "source",
      "external-ref",
      "created-at",
      "completed-at",
    ])
      assert.throws(
        () => cli("todo-update", "--uid", todo.uid, `--${field}`, "bad"),
        /unknown flag/,
      );
    cli(
      "todo-update",
      "--uid",
      todo.uid,
      "--content",
      metadata.content,
      "--start-at",
      start,
      "--due-at",
      due,
    );
    assert.deepEqual(fields(JSON.parse(cli("todos", "--json"))[0]), metadata);
    assert.deepEqual(fields(JSON.parse(cli("next", "--json"))[0]), metadata);
    assert.deepEqual(
      fields(JSON.parse(cli("current", "--json"))[0].openWork[0]),
      metadata,
    );
    for (const action of ["next", "current", "todos"])
      assert.ok(cli(action).includes(` [due ${due}]`));
    cli("todo-update", "--uid", todo.uid, "--clear-due-at");
    for (const action of ["next", "current", "todos"])
      assert.ok(!cli(action).includes(" [due "));
    assert.equal(cli("next"), `demo\t${todo.uid}\tpinned\tnew\n`);
    cli("todo-update", "--uid", todo.uid, "--due-at", due);
    assert.throws(
      () => cli("todo-update", "--uid", todo.uid, "--content", ""),
      /requires a value/,
    );
    assert.throws(
      () => cli("todo-add", "--title", "bad", "--content", ""),
      /requires a value/,
    );
    cli("todo-update", "--uid", todo.uid, "--content", " \n ");
    assert.equal(JSON.parse(cli("todos", "--json"))[0].content, null);
    cli("todo-update", "--uid", todo.uid, "--content", "中".repeat(8000));
    assert.equal(JSON.parse(cli("todos", "--json"))[0].content.length, 8000);
    assert.throws(() =>
      cli("todo-update", "--uid", todo.uid, "--content", "中".repeat(8001)),
    );
    cli("todo-update", "--uid", todo.uid, "--content", metadata.content);
    for (const action of [
      "todo-add",
      "todo-update",
      "todos",
      "next",
      "current",
    ])
      assert.match(cli("help", action), /planned start/);
    assert.match(cli("status", "todo-update", "--help"), /--clear-due-at/);
    for (const format of ["json", "jsonl"]) {
      const exported = cli("export", "--project", "demo", "--format", format);
      const bundle = JSON.parse(exported);
      assert.equal(bundle.version, 5);
      assert.equal(bundle.todos[0].project, null);
      const file = join(dir, `copy.${format}`);
      writeFileSync(file, exported);
      process.env.PMGR_DB_PATH = join(dir, `copy-${format}.sqlite`);
      cli("import", file, "--json");
      assert.deepEqual(JSON.parse(cli("export")), bundle);
      process.env.PMGR_DB_PATH = join(dir, "test.sqlite");
    }
  } finally {
    if (previous === undefined) delete process.env.PMGR_DB_PATH;
    else process.env.PMGR_DB_PATH = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("HTTP supports full-length content and metadata patches without changing dashboard controls", async () => {
  const db = openLedger(":memory:");
  const server = await startServer({ port: 0, open: false, db });
  const post = (path: string, input: unknown) =>
    fetch(server.url + path, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: server.url },
      body: JSON.stringify(input),
    });
  try {
    const response = await post("/api/todos", {
      title: "中".repeat(2000),
      ...metadata,
      content: "中".repeat(8000),
    });
    assert.equal(response.status, 200);
    const todo = (await response.json()) as Todo;
    assert.equal(todo.content!.length, 8000);
    assert.equal(
      (await post(`/api/todos/${todo.uid}`, { content: "中".repeat(8001) }))
        .status,
      400,
    );
    const changed = await post(`/api/todos/${todo.uid}`, {
      title: "renamed",
      status: "completed",
    });
    assert.equal(changed.status, 200);
    assert.equal(((await changed.json()) as Todo).content, todo.content);
    assert.equal(
      (await post(`/api/todos/${todo.uid}`, { dueAt: "bad", status: "open" }))
        .status,
      400,
    );
    assert.equal(listTodos(db)[0].status, "completed");
    assert.equal(
      (await post(`/api/todos/${todo.uid}`, { source: "agent" })).status,
      400,
    );
    // Escaped content can exceed the independent 32 KiB transport limit.
    const escaped = await post(`/api/todos/${todo.uid}`, {
      content: "\u0000".repeat(7999) + "x",
    });
    assert.equal(escaped.status, 413);
    await post(`/api/todos/${todo.uid}`, {
      content: null,
      dueAt: null,
      startAt: null,
    });
    const listed = (await fetch(server.url + "/api/todos").then((r) =>
      r.json(),
    )) as Todo[];
    assert.deepEqual(fields(listed[0]), nulls);
    assert.equal(
      (await post("/api/todos", { title: "x".repeat(40000) })).status,
      413,
    );
    const entry = addStatus(db, { project: "demo", summary: "source" }).entry;
    assert.equal(
      (await post(`/api/entries/${entry.uid}/todos`, { title: "linked" }))
        .status,
      200,
    );
    assert.equal(
      (
        await post(`/api/entries/${entry.uid}/todos`, {
          title: "linked",
          content: "unsupported",
        })
      ).status,
      400,
    );
  } finally {
    await server.close();
    db.close();
  }
});

test("only the final planned-start names are accepted and v5 requires each metadata key", () => {
  const db = openLedger(":memory:");
  const copy = openLedger(":memory:");
  const dir = mkdtempSync(join(tmpdir(), "pmgr-final-names-"));
  const previous = process.env.PMGR_DB_PATH;
  process.env.PMGR_DB_PATH = join(dir, "test.sqlite");
  try {
    const todo = createTodo(db, { title: "final policy", ...metadata });
    const obsoleteKey = "startedAt";
    assert.throws(
      () => createTodo(db, { title: "bad", [obsoleteKey]: start }),
      /unknown field/,
    );
    assert.throws(
      () => updateTodo(db, todo.uid, { [obsoleteKey]: start }),
      /unknown field/,
    );
    const columns = db.prepare("PRAGMA table_info(todos)").all() as {
      name: string;
    }[];
    assert.ok(columns.some((c) => c.name === "start_at"));
    assert.ok(!columns.some((c) => c.name === "started_at"));
    for (const flag of ["--started-at", "--clear-started-at"])
      assert.throws(
        () =>
          run(
            [
              "todo-update",
              "--uid",
              todo.uid,
              flag,
              ...(flag.includes("clear") ? [] : [start]),
            ],
            () => {},
          ),
        /unknown flag|requires a value/,
      );
    const bundle = exportLedger(db);
    for (const key of ["startAt", "dueAt", "content"]) {
      const missing = structuredClone(bundle);
      delete (missing.todos![0] as unknown as Record<string, unknown>)[key];
      assert.throws(
        () => importLedger(copy, [missing]),
        /require startAt, dueAt, and content/,
      );
      assert.equal(listTodos(copy).length, 0);
    }
    const obsolete = structuredClone(bundle);
    (obsolete.todos![0] as unknown as Record<string, unknown>)[obsoleteKey] =
      start;
    assert.throws(() => importLedger(copy, [obsolete]), /unknown field/);
    updateTodo(db, todo.uid, { content: null });
    const canonical = exportLedger(db);
    importLedger(copy, [canonical]);
    const normalized = structuredClone(canonical);
    normalized.todos![0].content = " \n ";
    normalized.todos![0].startAt = "2026-11-04T18:00:00+08:00";
    importLedger(copy, [normalized]);
    assert.deepEqual(exportLedger(copy), canonical);
  } finally {
    db.close();
    copy.close();
    if (previous === undefined) delete process.env.PMGR_DB_PATH;
    else process.env.PMGR_DB_PATH = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("date correction preserves the commitment; supersession keeps unrelated pinned or unpinned work", () => {
  for (const pinned of [true, false]) {
    const db = openLedger(":memory:");
    try {
      setProjectMetadata(db, { project: "demo" });
      const kept = createTodo(db, { project: "demo", title: "A" });
      const old = createTodo(db, { project: "demo", title: "B", dueAt: due });
      const initial = addStatus(db, {
        project: "demo",
        summary: "initial",
        nextTodoUids: [...(pinned ? [kept.uid] : []), old.uid],
      }).entry;
      updateTodo(db, old.uid, {
        title: "B corrected",
        dueAt: "2026-11-04T12:00:00Z",
      });
      assert.equal(history(db).length, 1);
      assert.deepEqual(
        current(db, "demo")[0].nextTodoUids,
        initial.nextTodoUids,
      );
      assert.equal(
        listTodos(db).find((t) => t.uid === old.uid)!.title,
        "B corrected",
      );
      const replacement = createTodo(db, {
        project: "demo",
        title: "B new commitment",
        dueAt: "2026-11-05T12:00:00Z",
      });
      addStatus(db, {
        project: "demo",
        summary: "new decision",
        progress: "Commitment changed, superseding B",
        nextMode: "carry",
        nextTodoUids: [kept.uid, replacement.uid],
        closeTodos: [{ uid: old.uid, status: "cancelled" }],
      });
      assert.equal(history(db).length, 2);
      assert.deepEqual(
        openWork(db, "demo").map((t) => (t.kind === "todo" ? t.uid : "legacy")),
        [kept.uid, replacement.uid],
      );
      assert.equal(
        listTodos(db).find((t) => t.uid === old.uid)!.status,
        "cancelled",
      );
      assert.equal(
        listTodos(db).find((t) => t.uid === kept.uid)!.status,
        "open",
      );
    } finally {
      db.close();
    }
  }
});
