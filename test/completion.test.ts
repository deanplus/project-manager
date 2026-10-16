import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addStatus,
  at,
  changeCompletion,
  current,
  exportLedger,
  getEntry,
  history,
  importLedger,
  openLedger,
  run,
  validateUid,
} from "../src/index.js";

const input = (day: number, extra = {}) => ({
  project: "demo",
  status: "active",
  summary: `Day ${day}`,
  occurredAt: `2026-10-${String(day).padStart(2, "0")}T00:00:00Z`,
  ...extra,
});

test("completion propagates explicitly, survives filtering, revokes, and preserves snapshots", () => {
  const db = openLedger(":memory:");
  try {
    const a = addStatus(
      db,
      input(1, { nextSteps: ["deploy"], blockers: ["review"] }),
    ).entry;
    const b = addStatus(db, input(2)).entry;
    const untouched = addStatus(db, input(3)).entry;
    const originalDone = addStatus(db, input(4, { status: "completed" })).entry;
    const archived = addStatus(db, input(5, { status: "archived" })).entry;
    const by = addStatus(db, input(6), "human", [
      String(a.id),
      b.uid,
      b.uid,
    ]).entry;
    assert.equal(getEntry(db, a.uid)?.status, "active");
    assert.equal(getEntry(db, a.uid)?.effectiveStatus, "completed");
    assert.deepEqual(getEntry(db, a.uid)?.nextSteps, ["deploy"]);
    assert.equal(getEntry(db, b.uid)?.completedBy?.id, by.id);
    assert.equal(getEntry(db, untouched.uid)?.effectiveStatus, "active");
    assert.equal(getEntry(db, originalDone.uid)?.effectiveStatus, "completed");
    assert.equal(getEntry(db, archived.uid)?.effectiveStatus, "archived");
    assert.equal(current(db, "demo")[0].id, by.id);
    assert.equal(current(db, "demo")[0].status, "active");
    const filtered = history(db, "demo", {
      until: "2026-10-01T23:00:00Z",
      limit: 1,
    })[0];
    assert.equal(filtered.isCurrent, false);
    assert.equal(filtered.completedBy?.uid, by.uid);
    assert.ok(filtered.completedBy?.recordedAt);
    assert.equal(
      at(db, "demo", "2026-10-01T23:00:00Z")?.completedBy,
      undefined,
    );
    const retryFirst = addStatus(
      db,
      input(7, { externalRef: "retry" }),
      "agent",
      [untouched.uid],
    );
    const beforeRetry = exportLedger(db).completions.length;
    const retry = addStatus(db, input(7, { externalRef: "retry" }), "agent", [
      untouched.uid,
    ]);
    assert.equal(retry.entry.uid, retryFirst.entry.uid);
    assert.equal(retry.inserted, false);
    assert.equal(exportLedger(db).completions.length, beforeRetry);
    changeCompletion(
      db,
      untouched.uid,
      retry.entry.uid,
      "revoke",
      "keep outstanding for rollback test",
    );
    assert.equal(
      changeCompletion(db, a.uid, by.uid).uid,
      exportLedger(db).completions[0].uid,
    );
    const another = addStatus(db, input(7)).entry;
    assert.throws(
      () => changeCompletion(db, a.uid, another.uid),
      /revoke first/,
    );
    assert.throws(
      () => changeCompletion(db, a.uid, another.uid, "revoke", "wrong source"),
      /no matching/,
    );
    assert.throws(
      () => changeCompletion(db, a.uid, by.uid, "revoke"),
      /requires a reason/,
    );
    changeCompletion(
      db,
      a.uid,
      by.uid,
      "revoke",
      "Acceptance remains outstanding",
      "agent",
    );
    assert.equal(getEntry(db, a.uid)?.effectiveStatus, "active");
    assert.equal(getEntry(db, a.uid)?.completedBy, undefined);
    changeCompletion(db, a.uid, another.uid, "complete", "Accepted", "agent");
    changeCompletion(db, archived.uid, by.uid);
    changeCompletion(db, originalDone.uid, by.uid);
    assert.equal(getEntry(db, archived.uid)?.effectiveStatus, "completed");
    assert.equal(getEntry(db, "missing"), undefined);
    const count = history(db).length;
    assert.throws(
      () => addStatus(db, input(8), "human", [untouched.uid, "missing"]),
      /not found/,
    );
    assert.equal(history(db).length, count);
    assert.equal(getEntry(db, untouched.uid)?.effectiveStatus, "active");
    const other = addStatus(db, input(9, { project: "other" })).entry;
    assert.throws(() => changeCompletion(db, a.uid, other.uid), /same project/);
    assert.throws(
      () => changeCompletion(db, by.uid, by.uid),
      /strictly earlier/,
    );
    assert.throws(
      () => changeCompletion(db, by.uid, b.uid),
      /strictly earlier/,
    );
    const equal = addStatus(db, input(6)).entry;
    assert.throws(
      () => changeCompletion(db, equal.uid, by.uid),
      /strictly earlier/,
    );
    assert.throws(
      () => changeCompletion(db, a.uid, by.uid, "oops" as never),
      /invalid completion action/,
    );
    assert.throws(
      () =>
        changeCompletion(
          db,
          a.uid,
          by.uid,
          "complete",
          undefined,
          "oops" as never,
        ),
      /source is invalid/,
    );
    for (const reason of ["", " ", "x".repeat(2001), 5])
      assert.throws(
        () => changeCompletion(db, a.uid, by.uid, "complete", reason as string),
        /reason must/,
      );
  } finally {
    db.close();
  }
});

test("portable bundles preserve event chains, reject identity conflicts and import atomically", () => {
  const db = openLedger(":memory:");
  const restored = openLedger(":memory:");
  try {
    const a = addStatus(
      db,
      input(1, { externalRef: "first", progress: "context" }),
    ).entry;
    const b = addStatus(db, input(2)).entry;
    const c = addStatus(db, input(3)).entry;
    changeCompletion(db, a.uid, b.uid);
    changeCompletion(db, a.uid, b.uid, "revoke", "wrong");
    changeCompletion(db, a.uid, c.uid);
    const equalFirst = addStatus(
      db,
      input(4, { summary: "same time first" }),
    ).entry;
    const equalLast = addStatus(
      db,
      input(4, { summary: "same time last" }),
    ).entry;
    const bundle = exportLedger(db, "demo");
    addStatus(restored, input(1, { project: "unrelated" }));
    importLedger(restored, [bundle]);
    importLedger(restored, [bundle]);
    assert.deepEqual(exportLedger(restored, "demo"), bundle);
    assert.equal(current(restored, "demo")[0].uid, equalLast.uid);
    assert.throws(
      () => changeCompletion(restored, equalFirst.uid, equalLast.uid),
      /strictly earlier/,
    );
    assert.equal(getEntry(restored, a.uid)?.completedBy?.uid, c.uid);
    assert.notEqual(getEntry(restored, a.uid)?.id, a.id);
    const corrupt = structuredClone(bundle);
    corrupt.entries[0].summary = "conflict";
    assert.throws(
      () =>
        importLedger(restored, [input(9, { project: "rollback" }), corrupt]),
      /conflicting entry uid/,
    );
    assert.equal(current(restored, "rollback").length, 0);
    const corruptEvent = structuredClone(bundle);
    corruptEvent.completions[0].reason = "different";
    assert.throws(
      () => importLedger(restored, [corruptEvent]),
      /conflicting completion uid/,
    );
    const wrongOrder = structuredClone(bundle);
    wrongOrder.completions = [...wrongOrder.completions].reverse();
    const empty = openLedger(":memory:");
    assert.throws(() => importLedger(empty, [wrongOrder]), /event order/);
    assert.equal(history(empty).length, 0);
    empty.close();
    const conflictingRef = structuredClone(bundle);
    conflictingRef.entries[0].uid = randomUUID();
    assert.throws(
      () => importLedger(restored, [conflictingRef]),
      /externalRef conflicts/,
    );
    const divergent = structuredClone(bundle);
    divergent.completions = [{ ...bundle.completions[0], uid: randomUUID() }];
    assert.throws(() => importLedger(restored, [divergent]), /event order/);
    assert.equal(
      importLedger(restored, [input(8, { project: "legacy" })])[0].entry.source,
      "import",
    );
    assert.throws(() => validateUid("bad"), /UUID/);
    for (const bad of [
      { version: 3, entries: [], completions: [] },
      { version: 2, entries: null, completions: [] },
      { version: 2, entries: [], completions: null },
      { ...bundle, unknown: true },
      ...[null, [], 5].map((item) => ({
        version: 2,
        entries: [item],
        completions: [],
      })),
      {
        version: 2,
        entries: [{ ...bundle.entries[0], uid: undefined }],
        completions: [],
      },
    ])
      assert.throws(() => importLedger(restored, [bad]));
    const event = bundle.completions[0];
    for (const bad of [
      null,
      [],
      { ...event, unknown: 1 },
      { ...event, action: "bad" },
      { ...event, source: "bad" },
      { ...event, reason: "" },
      { ...event, reason: "x".repeat(2001) },
      { ...event, reason: 3 },
      { ...event, action: "revoke", reason: undefined },
      { ...event, previousUid: "bad" },
      { ...event, recordedAt: "bad" },
    ]) {
      assert.throws(() =>
        importLedger(restored, [
          { version: 2, entries: [], completions: [bad] },
        ]),
      );
    }
    const noChange = exportLedger(restored);
    assert.deepEqual(exportLedger(restored), noChange);
  } finally {
    db.close();
    restored.close();
  }
});

test("CLI completion and revocation, metadata rollback, and JSONL bundle import", () => {
  const dir = mkdtempSync(join(tmpdir(), "pmgr-completion-"));
  const previous = process.env.PMGR_DB_PATH;
  process.env.PMGR_DB_PATH = join(dir, "test.sqlite");
  const execute = (args: string[]) => {
    let output = "";
    run(args, (text) => {
      output += text;
    });
    return output;
  };
  const add = (day: number, flags: string[] = []) =>
    JSON.parse(
      execute([
        "add",
        "--project",
        "demo",
        "--status",
        "active",
        "--summary",
        `Day ${day}`,
        "--at",
        input(day).occurredAt,
        "--json",
        ...flags,
      ]),
    );
  try {
    const a = add(1);
    const b = add(2, [
      "--completes",
      String(a.id),
      "--completes",
      a.uid,
      "--source",
      "agent",
    ]);
    assert.match(execute(["history"]), /completed by #2; original: active/);
    assert.equal(
      JSON.parse(
        execute(["complete", "--entry", a.uid, "--by", b.uid, "--json"]),
      ).action,
      "complete",
    );
    execute([
      "revoke-completion",
      "--entry",
      a.uid,
      "--by",
      b.uid,
      "--reason",
      "mistake",
      "--source",
      "agent",
    ]);
    assert.throws(
      () =>
        add(3, ["--description", "should roll back", "--completes", "missing"]),
      /not found/,
    );
    assert.equal(
      JSON.parse(execute(["projects", "--json"]))[0].description,
      undefined,
    );
    const bundle = execute(["export", "--format", "jsonl"]);
    const file = join(dir, "bundle.jsonl");
    writeFileSync(file, bundle);
    execute(["import", file]);
    assert.equal(execute(["export", "--format", "json"]), bundle);
  } finally {
    if (previous === undefined) delete process.env.PMGR_DB_PATH;
    else process.env.PMGR_DB_PATH = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("migration adds identities to legacy snapshots without changing content", () => {
  const dir = mkdtempSync(join(tmpdir(), "pmgr-migrate-"));
  const path = join(dir, "legacy.sqlite");
  const db = openLedger(path);
  const a = addStatus(db, input(1)).entry;
  addStatus(db, input(2));
  addStatus(db, input(3));
  db.exec(
    "DROP TRIGGER require_entry_uid; DROP TABLE completion_events; DROP INDEX idx_entry_uid; ALTER TABLE status_entries DROP COLUMN uid; DELETE FROM schema_migrations WHERE version = 3",
  );
  db.close();
  const upgraded = openLedger(path);
  const migrated = getEntry(upgraded, String(a.id))!;
  assert.equal(migrated.summary, a.summary);
  assert.equal(migrated.recordedAt, a.recordedAt);
  assert.equal(migrated.status, "active");
  assert.ok(validateUid(migrated.uid));
  assert.equal(history(upgraded).length, 3);
  assert.equal(new Set(history(upgraded).map((e) => e.uid)).size, 3);
  assert.ok(validateUid(addStatus(upgraded, input(4)).entry.uid));
  assert.throws(
    () =>
      upgraded.exec(
        `INSERT INTO status_entries(project_id, status, summary, occurred_at, recorded_at, source) VALUES (1, 'active', 'old writer', '2026-10-05T00:00:00Z', '2026-10-05T00:00:00Z', 'human')`,
      ),
    /upgrade the writer/,
  );
  upgraded.close();
  const raw = new Database(path);
  assert.equal(
    (
      raw.prepare("SELECT COUNT(*) AS n FROM schema_migrations").get() as {
        n: number;
      }
    ).n,
    3,
  );
  raw.close();
  rmSync(dir, { recursive: true, force: true });
});
