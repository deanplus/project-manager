import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  addStatus,
  at,
  convertNextStep,
  countEntries,
  createTodo,
  current,
  exportLedger,
  getEntry,
  history,
  importLedger,
  listTodos,
  openLedger,
  openWork,
  run,
  setProjectMetadata,
  updateTodo,
  type Ledger,
  type OpenWorkItem,
  type StatusEntry,
  type Todo,
} from "../src/index.js";

function cliTest(
  name: string,
  body: (cli: (args: string[]) => string, db: Ledger, dir: string) => void,
) {
  test(name, () => {
    const dir = mkdtempSync(join(tmpdir(), "pmgr-open-work-"));
    const previous = process.env.PMGR_DB_PATH;
    process.env.PMGR_DB_PATH = join(dir, "test.sqlite");
    const db = openLedger();
    const cli = (args: string[]) => {
      let output = "";
      run(args, (text) => {
        output += text;
      });
      return output;
    };
    try {
      body(cli, db, dir);
    } finally {
      db.close();
      if (previous === undefined) delete process.env.PMGR_DB_PATH;
      else process.env.PMGR_DB_PATH = previous;
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
const addArgs = (summary: string, ...args: string[]) => [
  "add",
  "--project",
  "demo",
  "--status",
  "active",
  "--summary",
  summary,
  "--json",
  ...args,
];
const nextArgs = ["next", "--project", "demo", "--json"];
const legacyInput = (project = "demo") => ({
  project,
  status: "active",
  summary: "Legacy",
  nextSteps: ["A", "B"],
  occurredAt: "2026-01-01T00:00:00.000Z",
});

test("F1: pending legacy carry rejects explicit empty refs and preserves portable state", () => {
  for (const partiallyConverted of [false, true]) {
    const db = openLedger(":memory:");
    const copy = openLedger(":memory:");
    try {
      const origin = importLedger(db, [legacyInput()])[0].entry;
      const converted = partiallyConverted
        ? convertNextStep(db, origin.uid, 0)
        : undefined;
      const before = exportLedger(db);
      assert.throws(
        () =>
          addStatus(db, {
            project: "demo",
            status: "active",
            summary: "Reject mixed carry",
            occurredAt: "2026-01-02T00:00:00.000Z",
            nextMode: "carry",
            nextTodoUids: [],
            closeTodos: converted
              ? [{ uid: converted.uid, status: "completed" }]
              : [],
          }),
        {
          name: "ValidationError",
          message:
            "project demo has unconverted legacy next steps; run pmgr todo-convert --project demo or pass --replace-next",
        },
      );
      // Rejecting after a closure must roll back both Todo state and the snapshot.
      assert.deepEqual(exportLedger(db), before);
      const carried = addStatus(db, {
        project: "demo",
        status: "active",
        summary: "Carry without explicit refs",
        occurredAt: "2026-01-02T00:00:00.000Z",
        nextMode: "carry",
      }).entry;
      assert.deepEqual(carried.nextSteps, origin.nextSteps);
      assert.equal(carried.nextStepsSourceUid, origin.uid);
      assert.equal(Object.hasOwn(carried, "nextTodoUids"), false);
      const bundle = exportLedger(db);
      importLedger(copy, [bundle]);
      assert.deepEqual(exportLedger(copy), bundle);
    } finally {
      copy.close();
      db.close();
    }
  }
});

cliTest(
  "AC1-5: CLI carries pins, exposes live open work, and pins independent Todos",
  (cli, db) => {
    const a = JSON.parse(cli(addArgs("First", "--next", "A"))) as StatusEntry;
    const b = JSON.parse(cli(addArgs("Second", "--next", "B"))) as StatusEntry;
    assert.deepEqual(b.nextTodoUids?.slice(0, 1), a.nextTodoUids);
    assert.equal(b.nextTodoUids?.length, 2);
    assert.deepEqual(
      (JSON.parse(cli(nextArgs)) as OpenWorkItem[]).map((item) => [
        item.title,
        item.pinned,
      ]),
      [
        ["A", true],
        ["B", true],
      ],
    );
    const plain = JSON.parse(cli(addArgs("Plain"))) as StatusEntry;
    assert.deepEqual(plain.nextTodoUids, b.nextTodoUids);
    cli(["todo-update", "--uid", a.nextTodoUids![0], "--status", "cancelled"]);
    const view = JSON.parse(
      cli(["current", "--project", "demo", "--json"]),
    ) as (StatusEntry & { openWork: OpenWorkItem[] })[];
    assert.equal(view[0].nextTodos?.[0].status, "cancelled");
    assert.deepEqual(
      view[0].openWork.map((item) => item.title),
      ["B"],
    );
    const filtered = JSON.parse(cli(addArgs("Drop cancelled"))) as StatusEntry;
    assert.deepEqual(filtered.nextTodoUids, b.nextTodoUids?.slice(1));
    const before = countEntries(db);
    const c = JSON.parse(
      cli(["todo-add", "--project", "demo", "--title", "C", "--json"]),
    ) as Todo;
    assert.equal(countEntries(db), before);
    assert.deepEqual(
      (JSON.parse(cli(nextArgs)) as OpenWorkItem[]).map((item) => [
        item.title,
        item.pinned,
      ]),
      [
        ["B", true],
        ["C", false],
      ],
    );
    const pinned = JSON.parse(
      cli(addArgs("Pin C", "--next-todo", c.uid)),
    ) as StatusEntry;
    assert.deepEqual(pinned.nextTodoUids, [...filtered.nextTodoUids!, c.uid]);
    assert.match(
      cli(["current", "--project", "demo"]),
      /\n  - B \[pinned\]\n  - C \[pinned\]/,
    );
    assert.doesNotMatch(cli(["history", "--project", "demo"]), /\n  -/);
    for (const entry of history(db)) assert.equal("openWork" in entry, false);
    assert.equal("openWork" in getEntry(db, pinned.uid)!, false);
    assert.equal("openWork" in at(db, "demo", pinned.occurredAt)!, false);
  },
);

cliTest(
  "AC3: cancelling the only pin leaves an empty checklist and raw current pins",
  (cli) => {
    const a = JSON.parse(cli(addArgs("First", "--next", "A"))) as StatusEntry;
    cli(["todo-update", "--uid", a.nextTodoUids![0], "--status", "cancelled"]);
    assert.deepEqual(JSON.parse(cli(nextArgs)), []);
    assert.equal(cli(["next", "--project", "demo"]), "No open work.\n");
    const rows = JSON.parse(cli(["current", "--json"])) as (StatusEntry & {
      openWork: OpenWorkItem[];
    })[];
    assert.deepEqual(rows[0].openWork, []);
    assert.equal(rows[0].nextTodos?.[0].status, "cancelled");
  },
);

cliTest(
  "AC6,8: close and replace are atomic; unpinning never changes status",
  (cli, db) => {
    const a = JSON.parse(cli(addArgs("First", "--next", "A"))) as StatusEntry;
    const b = JSON.parse(
      cli(
        addArgs("Finish A", "--next", "B", "--done-todo", a.nextTodoUids![0]),
      ),
    ) as StatusEntry;
    assert.equal(b.nextTodoUids?.length, 1);
    const done = listTodos(db).find((todo) => todo.title === "A")!;
    assert.equal(done.status, "completed");
    assert.ok(done.completedAt);
    const before = exportLedger(db);
    assert.throws(
      () => cli(addArgs("Invalid", "--next", "C", "--done-todo", randomUUID())),
      /does not belong/,
    );
    assert.deepEqual(exportLedger(db), before);
    assert.throws(
      () =>
        cli(
          addArgs(
            "Rollback closure",
            "--done-todo",
            b.nextTodoUids![0],
            "--next-todo",
            randomUUID(),
          ),
        ),
      /dangling/,
    );
    assert.deepEqual(exportLedger(db), before);
    for (const flags of [
      ["--done-todo", done.uid, "--cancel-todo", done.uid],
      ["--done-todo", done.uid, "--next-todo", done.uid],
    ])
      assert.throws(() => cli(addArgs("Conflict", ...flags)), /cannot close/);
    const cleared = JSON.parse(
      cli(addArgs("Clear", "--replace-next")),
    ) as StatusEntry;
    assert.deepEqual(cleared.nextTodoUids, []);
    assert.equal(
      listTodos(db).find((todo) => todo.title === "B")!.status,
      "open",
    );
    const d = JSON.parse(
      cli(
        addArgs(
          "Replace",
          "--replace-next",
          "--next",
          "D",
          "--cancel-todo",
          b.nextTodoUids![0],
        ),
      ),
    ) as StatusEntry;
    assert.equal(d.nextTodoUids?.length, 1);
    assert.deepEqual(
      openWork(db, "demo").map((item) => item.title),
      ["D"],
    );
    assert.equal(
      listTodos(db).find((todo) => todo.title === "B")!.completedAt,
      null,
    );
    cli(addArgs("No-op close", "--done-todo", done.uid));
    assert.equal(
      listTodos(db).find((todo) => todo.uid === done.uid)!.completedAt,
      done.completedAt,
    );
  },
);

cliTest(
  "AC7: exact titles reuse prior open Todos; duplicate new titles stay separate",
  (cli, db) => {
    cli(addArgs("Base"));
    const old = createTodo(db, { title: "A", project: "demo" });
    const pinned = JSON.parse(
      cli(addArgs("Reuse", "--next", " A ")),
    ) as StatusEntry;
    assert.deepEqual(pinned.nextTodoUids, [old.uid]);
    assert.equal(listTodos(db).length, 1);
    assert.equal(listTodos(db)[0].entryUid, null);
    const repeated = JSON.parse(
      cli(addArgs("Two new", "--next", "B", "--next", "B")),
    ) as StatusEntry;
    assert.equal(repeated.nextTodoUids?.length, 3);
    assert.equal(listTodos(db).length, 3);
    const replace = JSON.parse(
      cli(addArgs("Reuse replace", "--replace-next", "--next", "A")),
    ) as StatusEntry;
    assert.deepEqual(replace.nextTodoUids, [old.uid]);
    cli(addArgs("Case sensitive", "--next", "a"));
    assert.equal(listTodos(db).length, 4);
  },
);

cliTest(
  "AC9-10: legacy carry preserves source; conversion is idempotent and materializes open refs",
  (cli, db, dir) => {
    const origin = importLedger(db, [legacyInput()])[0].entry;
    const carried = JSON.parse(cli(addArgs("Carry legacy"))) as StatusEntry;
    assert.deepEqual(carried.nextSteps, ["A", "B"]);
    assert.equal(carried.nextStepsSourceUid, origin.uid);
    assert.equal(carried.nextTodoUids, undefined);
    const before = exportLedger(db);
    assert.throws(
      () => cli(addArgs("Mixed", "--next", "X")),
      /project demo has unconverted legacy next steps; run pmgr todo-convert --project demo or pass --replace-next/,
    );
    assert.deepEqual(exportLedger(db), before);
    const one = JSON.parse(
      cli([
        "todo-convert",
        "--entry",
        String(carried.id),
        "--index",
        "0",
        "--json",
      ]),
    ) as Todo[];
    const mixed = JSON.parse(cli(nextArgs)) as OpenWorkItem[];
    assert.deepEqual(
      mixed.map((item) => [item.kind, item.title, item.pinIndex]),
      [
        ["todo", "A", 0],
        ["legacy-step", "B", 1],
      ],
    );
    assert.equal(mixed[1].entryUid, origin.uid);
    assert.match(
      cli(["next", "--project", "demo"]),
      new RegExp(`${origin.uid}#1\\tpinned\\tB`),
    );
    const n = countEntries(db);
    const converted = JSON.parse(
      cli(["todo-convert", "--project", "demo", "--json"]),
    ) as Todo[];
    assert.equal(converted[0].uid, one[0].uid);
    assert.deepEqual(
      JSON.parse(cli(["todo-convert", "--project", "demo", "--json"])),
      converted,
    );
    assert.equal(countEntries(db), n);
    cli(["todo-update", "--uid", converted[0].uid, "--status", "completed"]);
    const materialized = JSON.parse(cli(addArgs("Refs"))) as StatusEntry;
    assert.deepEqual(materialized.nextTodoUids, [converted[1].uid]);
    assert.equal(materialized.nextStepsSourceUid, undefined);
    assert.deepEqual(materialized.nextSteps, []);
    assert.deepEqual(getEntry(db, origin.uid)?.nextSteps, ["A", "B"]);
    importLedger(db, [legacyInput("other")]);
    const all = JSON.parse(cli(["todo-convert", "--all", "--json"])) as Todo[];
    assert.deepEqual(
      all.map((todo) => todo.title),
      ["A", "B"],
    );
    assert.deepEqual(JSON.parse(cli(["todo-convert", "--all", "--json"])), all);
    // Portable round trip retains raw formats and never uses CLI carry/reuse behavior.
    const file = join(dir, "bundle.json");
    writeFileSync(file, JSON.stringify(exportLedger(db)));
    const copy = openLedger(":memory:");
    try {
      importLedger(copy, [exportLedger(db)]);
      assert.deepEqual(exportLedger(copy), exportLedger(db));
    } finally {
      copy.close();
    }
  },
);

cliTest(
  "legacy replace explicitly bypasses conversion and conversion validates selectors",
  (cli, db) => {
    importLedger(db, [legacyInput()]);
    const replaced = JSON.parse(
      cli(addArgs("Replace legacy", "--replace-next", "--next", "X")),
    ) as StatusEntry;
    assert.equal(replaced.nextTodoUids?.length, 1);
    assert.deepEqual(
      JSON.parse(cli(["todo-convert", "--project", "unknown", "--json"])),
      [],
    );
    for (const args of [
      [],
      ["--all", "--project", "demo"],
      ["--entry", replaced.uid],
      ["--index", "0"],
      ["--all", "--index", "0"],
      ["--entry", replaced.uid, "--index", "-1"],
      ["--entry", replaced.uid, "--index", "1.5"],
    ]) {
      assert.throws(() => cli(["todo-convert", ...args]));
    }
  },
);

test("AC11: global open work groups projects, de-duplicates shared pins, and ends with unassigned", () => {
  const db = openLedger(":memory:");
  try {
    const loose = createTodo(db, { title: "Loose" });
    const shared = createTodo(db, { title: "Shared" });
    const older = addStatus(db, {
      project: "older",
      summary: "Older",
      occurredAt: "2026-01-01T00:00:00Z",
      nextTodoUids: [shared.uid],
    }).entry;
    const newer = addStatus(db, {
      project: "newer",
      summary: "Newer",
      occurredAt: "2026-02-01T00:00:00Z",
      nextTodoUids: [shared.uid],
    }).entry;
    createTodo(db, { title: "Backlog", project: "newer" });
    setProjectMetadata(db, { project: "no-snapshot" });
    createTodo(db, { title: "Plan", project: "no-snapshot" });
    assert.deepEqual(
      current(db).map((entry) => entry.uid),
      [newer.uid, older.uid],
    );
    const items = openWork(db);
    assert.deepEqual(
      items.map((item) => [item.project, item.title, item.pinned]),
      [
        ["newer", "Shared", true],
        ["newer", "Backlog", false],
        ["no-snapshot", "Plan", false],
        [null, "Loose", false],
      ],
    );
    assert.equal(
      items.filter((item) => item.kind === "todo" && item.uid === shared.uid)
        .length,
      1,
    );
    assert.equal(
      items.at(-1)?.kind === "todo" && items.at(-1)?.title,
      loose.title,
    );
    assert.equal(openWork(db, "older")[0].project, "older");
    assert.deepEqual(openWork(db, "unknown"), []);
  } finally {
    db.close();
  }
});

test("R4.4 prefers pinned exact matches, then oldest createdAt/uid, and preserves provenance", () => {
  const db = openLedger(":memory:");
  try {
    setProjectMetadata(db, { project: "demo" });
    const old = createTodo(db, { title: "A", project: "demo" });
    const pinned = createTodo(db, { title: "A", project: "demo" });
    db.prepare("UPDATE todos SET created_at = ? WHERE uid = ?").run(
      "2026-01-01T00:00:00.000Z",
      old.uid,
    );
    addStatus(db, {
      project: "demo",
      summary: "Pin",
      nextTodoUids: [pinned.uid],
    });
    assert.deepEqual(
      addStatus(db, { project: "demo", summary: "Reuse", nextSteps: ["A"] })
        .entry.nextTodoUids,
      [pinned.uid],
    );
    addStatus(db, { project: "demo", summary: "Clear" });
    assert.deepEqual(
      addStatus(db, { project: "demo", summary: "Oldest", nextSteps: ["A"] })
        .entry.nextTodoUids,
      [old.uid],
    );
    assert.equal(
      listTodos(db).find((todo) => todo.uid === old.uid)?.entryUid,
      null,
    );
  } finally {
    db.close();
  }
});

test("AC12-13: domain defaults replace; carry retries use stored suffix despite status changes", () => {
  const db = openLedger(":memory:");
  try {
    const a = addStatus(db, {
      project: "demo",
      summary: "First",
      nextSteps: ["A"],
      occurredAt: "2026-01-01T00:00:00Z",
    }).entry;
    const input = {
      uid: randomUUID(),
      project: "demo",
      summary: "Carry",
      nextSteps: ["B"],
      nextMode: "carry",
      occurredAt: "2026-02-01T00:00:00Z",
    };
    const first = addStatus(db, input);
    assert.equal(first.entry.nextTodoUids?.length, 2);
    updateTodo(db, first.entry.nextTodoUids![1], { status: "cancelled" });
    addStatus(db, {
      project: "demo",
      summary: "Later",
      nextSteps: ["C"],
      occurredAt: "2026-03-01T00:00:00Z",
    });
    const before = exportLedger(db);
    assert.equal(addStatus(db, input).inserted, false);
    assert.deepEqual(exportLedger(db), before);
    for (const change of [
      { summary: "Changed" },
      { nextSteps: ["Changed"] },
      { nextTodoUids: [a.nextTodoUids![0]], nextSteps: [] },
    ])
      assert.throws(
        () => addStatus(db, { ...input, ...change }),
        /conflicting entry uid/,
      );
    const blank = {
      uid: randomUUID(),
      project: "demo",
      summary: "Plain",
      nextMode: "carry",
      occurredAt: "2026-04-01T00:00:00Z",
    };
    assert.equal(addStatus(db, blank).inserted, true);
    assert.equal(addStatus(db, blank).inserted, false);
    const refs = {
      uid: randomUUID(),
      project: "demo",
      summary: "Refs",
      nextMode: "carry",
      nextTodoUids: [a.nextTodoUids![0]],
      occurredAt: "2026-05-01T00:00:00Z",
    };
    assert.equal(addStatus(db, refs).inserted, true);
    assert.equal(addStatus(db, refs).inserted, false);
    assert.deepEqual(
      addStatus(db, { project: "demo", summary: "Default" }).entry.nextTodoUids,
      [],
    );
    importLedger(db, [legacyInput("legacy")]);
    const legacy = {
      uid: randomUUID(),
      project: "legacy",
      summary: "Carry old",
      nextMode: "carry",
      occurredAt: "2026-06-01T00:00:00Z",
    };
    assert.equal(addStatus(db, legacy).inserted, true);
    assert.equal(addStatus(db, legacy).inserted, false);
    const convert = current(db, "legacy")[0];
    convertNextStep(db, convert.uid, 0);
    assert.equal(addStatus(db, legacy).inserted, false);
  } finally {
    db.close();
  }
});

cliTest(
  "AC13: external-ref replay bypasses close/reuse/carry and changes no Todos",
  (cli, db) => {
    const a = JSON.parse(cli(addArgs("First", "--next", "A"))) as StatusEntry;
    const args = addArgs(
      "Close A",
      "--next",
      "B",
      "--done-todo",
      a.nextTodoUids![0],
      "--external-ref",
      "replay",
    );
    const first = JSON.parse(cli(args)) as StatusEntry;
    updateTodo(db, a.nextTodoUids![0], { status: "open" });
    const before = exportLedger(db);
    const replay = JSON.parse(
      cli([...args, "--cancel-todo", randomUUID()]),
    ) as StatusEntry;
    assert.equal(replay.uid, first.uid);
    assert.deepEqual(exportLedger(db), before);
  },
);

cliTest(
  "AC14: help, aliases, text output, and unknown flag validation",
  (cli) => {
    assert.match(cli(["--help"]), /next\s+List all open work/);
    assert.match(cli(["--help"]), /todo-convert/);
    for (const flag of ["replace-next", "done-todo", "cancel-todo"])
      assert.match(cli(["add", "--help"]), new RegExp(`--${flag}`));
    assert.match(cli(["todo-convert", "--help"]), /--all/);
    assert.deepEqual(
      JSON.parse(cli(["status", "next", "--project", "unknown", "--json"])),
      [],
    );
    assert.equal(cli(["next"]), "No open work.\n");
    cli(addArgs("Start", "--next", "A"));
    assert.match(cli(["next"]), /^demo\t[\da-f-]+\tpinned\tA\n$/);
    for (const action of ["next", "todo-convert", "add"])
      assert.throws(() => cli([action, "--typo", "x"]), /unknown flag/);
    for (const flag of ["replace-next", "done-todo", "cancel-todo", "all"])
      assert.throws(
        () =>
          cli([
            "current",
            `--${flag}`,
            ...(flag.endsWith("todo") ? [randomUUID()] : []),
          ]),
        /unknown flag/,
      );
  },
);

test("R4 validation and ownership roll back close operations", () => {
  const db = openLedger(":memory:");
  try {
    addStatus(db, { project: "other", summary: "Other" });
    const foreign = createTodo(db, { project: "other", title: "Foreign" });
    const loose = createTodo(db, { title: "Loose" });
    addStatus(db, {
      project: "demo",
      summary: "Pin loose",
      nextTodoUids: [loose.uid],
    });
    const before = exportLedger(db);
    for (const closeTodos of [
      [{ uid: foreign.uid, status: "completed" }],
      [{ uid: loose.uid, status: "open" }],
      [{ uid: loose.uid, status: "completed", extra: true }],
      null,
    ])
      assert.throws(() =>
        addStatus(db, { project: "demo", summary: "Invalid", closeTodos }),
      );
    assert.throws(() =>
      addStatus(db, {
        project: "demo",
        summary: "Invalid",
        nextMode: "append",
      }),
    );
    assert.deepEqual(exportLedger(db), before);
    const closed = addStatus(db, {
      project: "demo",
      summary: "Close loose",
      nextMode: "carry",
      closeTodos: [{ uid: loose.uid, status: "cancelled" }],
    }).entry;
    assert.deepEqual(closed.nextTodoUids, []);
    assert.deepEqual(openWork(db, "demo"), []);
    assert.throws(
      () =>
        importLedger(db, [
          { project: "demo", summary: "Not portable", nextMode: "carry" },
        ]),
      /unknown field/,
    );
  } finally {
    db.close();
  }
});

cliTest(
  "duplicate titles stay separate even when the first occurrence reuses prior work",
  (cli, db) => {
    cli(addArgs("Base", "--next", "A"));
    const prior = listTodos(db)[0];
    const entry = JSON.parse(
      cli(addArgs("Duplicate", "--next", "A", "--next", "A")),
    ) as StatusEntry;
    assert.equal(entry.nextTodoUids?.length, 2);
    assert.equal(entry.nextTodoUids?.[0], prior.uid);
    assert.equal(listTodos(db).length, 2);
  },
);

test("carried refs respect the existing portable limit and roll back atomically", () => {
  const db = openLedger(":memory:");
  try {
    addStatus(db, {
      project: "demo",
      summary: "Full",
      nextSteps: Array.from({ length: 100 }, (_, i) => `Task ${i}`),
    });
    const before = exportLedger(db);
    assert.throws(
      () =>
        addStatus(db, {
          project: "demo",
          summary: "Overflow",
          nextMode: "carry",
          nextSteps: ["New"],
        }),
      /at most 100/,
    );
    assert.deepEqual(exportLedger(db), before);
  } finally {
    db.close();
  }
});

test("openWork preserves pin gaps and orders equal-time backlog by UID", () => {
  const db = openLedger(":memory:");
  try {
    const first = addStatus(db, {
      project: "demo",
      summary: "Pins",
      nextSteps: ["Closed", "Pinned"],
    }).entry;
    const a = createTodo(db, { title: "A", project: "demo" });
    const b = createTodo(db, { title: "B", project: "demo" });
    db.prepare("UPDATE todos SET created_at = ? WHERE uid IN (?, ?)").run(
      "2026-01-01T00:00:00.000Z",
      a.uid,
      b.uid,
    );
    updateTodo(db, first.nextTodoUids![0], { status: "completed" });
    const work = openWork(db, "demo");
    assert.deepEqual(
      work.map((item) => item.pinIndex),
      [1, null, null],
    );
    assert.deepEqual(
      work.slice(1).map((item) => item.kind === "todo" && item.uid),
      [a.uid, b.uid].sort(),
    );
    assert.equal(listTodos(db).length, 4);
  } finally {
    db.close();
  }
});

cliTest(
  "partial legacy carry can close converted work without resurrecting its string",
  (cli, db) => {
    const entry = importLedger(db, [legacyInput()])[0].entry;
    const converted = convertNextStep(db, entry.uid, 0);
    const copied = JSON.parse(
      cli(addArgs("Close legacy", "--cancel-todo", converted.uid)),
    ) as StatusEntry;
    assert.deepEqual(copied.nextSteps, ["A", "B"]);
    assert.equal(copied.nextStepsSourceUid, entry.uid);
    assert.deepEqual(
      openWork(db, "demo").map((item) => [
        item.kind,
        item.title,
        item.pinIndex,
      ]),
      [["legacy-step", "B", 1]],
    );
    const before = exportLedger(db);
    assert.throws(
      () =>
        cli(
          addArgs(
            "Fail after close",
            "--done-todo",
            converted.uid,
            "--next",
            "New",
          ),
        ),
      /unconverted legacy/,
    );
    assert.deepEqual(exportLedger(db), before);
  },
);

test("only current pins authorize closing an unassigned Todo", () => {
  const db = openLedger(":memory:");
  try {
    const loose = createTodo(db, { title: "Loose" });
    addStatus(db, {
      project: "demo",
      summary: "Pin",
      nextTodoUids: [loose.uid],
    });
    addStatus(db, { project: "demo", summary: "Unpin" });
    assert.throws(
      () =>
        addStatus(db, {
          project: "demo",
          summary: "Close historical",
          closeTodos: [{ uid: loose.uid, status: "completed" }],
        }),
      /does not belong/,
    );
    assert.equal(listTodos(db)[0].status, "open");
  } finally {
    db.close();
  }
});

test("carry fixed-UID closing retries never reapply closures", () => {
  const db = openLedger(":memory:");
  try {
    const entry = addStatus(db, {
      project: "demo",
      summary: "First",
      nextSteps: ["A"],
    }).entry;
    const input = {
      uid: randomUUID(),
      project: "demo",
      summary: "Close",
      nextMode: "carry",
      nextSteps: ["B"],
      closeTodos: [{ uid: entry.nextTodoUids![0], status: "completed" }],
      occurredAt: "2026-11-03T00:00:00Z",
    };
    assert.equal(addStatus(db, input).inserted, true);
    updateTodo(db, entry.nextTodoUids![0], { status: "open" });
    const before = exportLedger(db);
    assert.equal(addStatus(db, input).inserted, false);
    assert.deepEqual(exportLedger(db), before);
  } finally {
    db.close();
  }
});

test("carry and reuse keep new Todo provenance at the final ref index for portable round trips", () => {
  const db = openLedger(":memory:");
  const copy = openLedger(":memory:");
  try {
    addStatus(db, { project: "demo", summary: "A", nextSteps: ["A"] });
    const entry = addStatus(db, {
      project: "demo",
      summary: "B",
      nextMode: "carry",
      nextSteps: ["A", "B", "A"],
    }).entry;
    for (const todo of listTodos(db)) {
      if (todo.entryUid === entry.uid)
        assert.equal(entry.nextTodoUids![todo.stepIndex!], todo.uid);
    }
    const bundle = exportLedger(db);
    importLedger(copy, [bundle]);
    assert.deepEqual(exportLedger(copy), bundle);
    assert.equal(
      addStatus(copy, {
        project: "demo",
        summary: "C",
        nextMode: "carry",
        nextSteps: ["C"],
      }).entry.nextTodoUids?.length,
      4,
    );
  } finally {
    copy.close();
    db.close();
  }
});

test("R4.5 strict suffix documents the R4.1 conflict for re-pinning an earlier carried UID", () => {
  const db = openLedger(":memory:");
  try {
    const first = addStatus(db, {
      project: "demo",
      summary: "Pins",
      nextSteps: ["A", "B"],
    }).entry;
    for (const work of [
      { nextSteps: ["A"] },
      { nextTodoUids: [first.nextTodoUids![0]] },
    ]) {
      const input = {
        uid: randomUUID(),
        project: "demo",
        summary: "Re-pin A",
        nextMode: "carry",
        occurredAt: "2026-11-03T00:00:00Z",
        ...work,
      };
      assert.deepEqual(
        addStatus(db, input).entry.nextTodoUids,
        first.nextTodoUids,
      );
      // R4.1 keeps A first; it is not the suffix required by R4.5. See Round 1 L2.
      assert.throws(() => addStatus(db, input), /conflicting entry uid/);
    }
  } finally {
    db.close();
  }
});

test("F2: exact-title reuse includes unassigned Todos pinned by the project", () => {
  const db = openLedger(":memory:");
  try {
    const shared = createTodo(db, { title: "Shared" });
    addStatus(db, {
      project: "demo",
      summary: "Pin unassigned",
      nextTodoUids: [shared.uid],
    });
    const entry = addStatus(db, {
      project: "demo",
      summary: "Repeat title",
      nextMode: "carry",
      nextSteps: ["Shared"],
    }).entry;
    assert.deepEqual(entry.nextTodoUids, [shared.uid]);
    assert.equal(listTodos(db).length, 1);
    assert.equal(listTodos(db)[0].project, null);
    // An unpinned unassigned Todo is not a reuse candidate.
    const loose = createTodo(db, { title: "Loose" });
    const next = addStatus(db, {
      project: "demo",
      summary: "New loose title",
      nextMode: "carry",
      nextSteps: ["Loose"],
    }).entry;
    assert.equal(next.nextTodoUids?.length, 2);
    assert.notEqual(next.nextTodoUids?.[1], loose.uid);
  } finally {
    db.close();
  }
});

cliTest(
  "F4: CLI current groups one open-work scan with per-project semantics",
  (cli, db) => {
    const shared = createTodo(db, { title: "Shared" });
    for (const [project, occurredAt] of [
      ["older", "2026-01-01T00:00:00Z"],
      ["newer", "2026-02-01T00:00:00Z"],
    ])
      addStatus(db, {
        project,
        summary: project,
        occurredAt,
        nextTodoUids: [shared.uid],
      });
    createTodo(db, { title: "Backlog", project: "newer" });
    const entries = JSON.parse(cli(["current", "--json"])) as (StatusEntry & {
      openWork: OpenWorkItem[];
    })[];
    assert.deepEqual(
      entries.map((entry) => entry.project),
      ["newer", "older"],
    );
    // Each project keeps its own view, including a Todo pinned by both.
    for (const entry of entries)
      assert.deepEqual(entry.openWork, openWork(db, entry.project));
    assert.deepEqual(
      entries.map((entry) => entry.openWork.map((item) => item.title)),
      [["Shared", "Backlog"], ["Shared"]],
    );
  },
);

cliTest("todo-convert text output lists converted Todos", (cli, db) => {
  importLedger(db, [legacyInput()]);
  const lines = cli(["todo-convert", "--project", "demo"]).trim().split("\n");
  assert.deepEqual(
    lines.map((line) => line.split("\t").slice(1)),
    [
      ["open", "demo", "A"],
      ["open", "demo", "B"],
    ],
  );
});

cliTest(
  "text next and current cover pinned, legacy, and unassigned rows",
  (cli, db) => {
    importLedger(db, [legacyInput("legacy")]);
    const legacy = current(db, "legacy")[0];
    createTodo(db, { title: "Loose" });
    addStatus(db, { project: "demo", summary: "Pinned", nextSteps: ["P"] });
    createTodo(db, { title: "Backlog", project: "demo" });
    const rows = cli(["next"])
      .trim()
      .split("\n")
      .map((line) => line.split("\t"));
    assert.deepEqual(
      rows.map(([project, , pinned, title]) => [project, pinned, title]),
      [
        ["demo", "pinned", "P"],
        ["demo", "-", "Backlog"],
        ["legacy", "pinned", "A"],
        ["legacy", "pinned", "B"],
        ["-", "-", "Loose"],
      ],
    );
    assert.equal(rows[2][1], `${legacy.uid}#0`);
    assert.equal(
      cli(["current", "--project", "demo"]).split("\n").slice(1, 3).join("\n"),
      "  - P [pinned]\n  - Backlog",
    );
    assert.throws(() => addStatus(db, null), /entry must be an object/);
  },
);
