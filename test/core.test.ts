import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { run } from "../src/cli.js";
import {
  addStatus,
  at,
  current,
  databasePath,
  history,
  importStatuses,
  openLedger,
  parseTime,
  toPortableStatusEntry,
  validateStatusEntry,
  ValidationError,
} from "../src/index.js";

const timestamp = "2026-08-03T00:00:00Z";
const entry = (overrides: Record<string, unknown> = {}) => ({
  project: "project-mgr",
  status: "active",
  summary: "working",
  occurredAt: timestamp,
  ...overrides,
});

test("domain normalizes valid values and rejects invalid input", () => {
  assert.deepEqual(
    validateStatusEntry(
      entry({
        blockers: [" wait "],
        nextSteps: [" next "],
        decisions: [" decide "],
        tags: [" mvp "],
        progress: " done ",
        externalRef: " ref ",
      }),
    ),
    {
      project: "project-mgr",
      status: "active",
      summary: "working",
      progress: "done",
      blockers: ["wait"],
      nextSteps: ["next"],
      decisions: ["decide"],
      tags: ["mvp"],
      occurredAt: "2026-08-03T00:00:00.000Z",
      source: "human",
      externalRef: "ref",
    },
  );
  for (const invalid of [
    null,
    [],
    entry({ unknown: true }),
    entry({ project: "bad space" }),
    entry({ status: "nope" }),
    entry({ summary: "" }),
    entry({ summary: "x".repeat(2_001) }),
    entry({ blockers: "no" }),
    entry({ source: "bot" }),
    entry({ occurredAt: "2026-08-03" }),
    entry({ occurredAt: "2026-08-03T00:00:00" }),
    entry({ externalRef: "x".repeat(201) }),
  ]) {
    assert.throws(() => validateStatusEntry(invalid), ValidationError);
  }
  assert.throws(() => parseTime(1, "time"), /time must be a valid ISO/);
  const portable = toPortableStatusEntry({
    id: 1,
    recordedAt: "2026-08-03T01:00:00.000Z",
    ...validateStatusEntry(entry()),
  });
  assert.equal("id" in portable, false);
  assert.equal("recordedAt" in portable, false);
});

test("SQLite ledger migrates, appends, is idempotent, and queries by timeline", () => {
  const db = openLedger(":memory:");
  const first = addStatus(db, entry({ externalRef: "one", progress: "done" }));
  assert.equal(first.inserted, true);
  assert.equal(
    addStatus(db, entry({ summary: "ignored", externalRef: "one" })).inserted,
    false,
  );
  assert.throws(
    () =>
      addStatus(db, entry({ project: "wrong-project", externalRef: "one" })),
    /externalRef is already used by project project-mgr/,
  );
  addStatus(
    db,
    entry({
      project: "other",
      status: "planned",
      summary: "other",
      occurredAt: "2026-08-04T00:00:00Z",
    }),
  );
  addStatus(db, entry({ summary: "same-time winner", occurredAt: timestamp }));
  addStatus(
    db,
    entry({ summary: "later", occurredAt: "2026-08-05T00:00:00Z" }),
  );
  assert.deepEqual(
    current(db).map(({ project, summary }) => [project, summary]),
    [
      ["project-mgr", "later"],
      ["other", "other"],
    ],
  );
  assert.equal(current(db, "project-mgr")[0]?.progress, undefined);
  assert.deepEqual(
    history(db, "project-mgr", {
      since: "2026-08-04T00:00:00.000Z",
      until: "2026-08-06T00:00:00.000Z",
      limit: 1,
      offset: 0,
    }).map((item) => item.summary),
    ["later"],
  );
  assert.equal(history(db, undefined, { offset: 1 }).length, 3);
  assert.equal(
    at(db, "project-mgr", "2026-08-04T00:00:00.000Z")?.summary,
    "same-time winner",
  );
  assert.equal(at(db, "missing", "2026-08-04T00:00:00.000Z"), undefined);
  assert.equal(
    (
      db.prepare("SELECT count(*) AS count FROM schema_migrations").get() as {
        count: number;
      }
    ).count,
    1,
  );
  db.close();
});

test("import validates before transaction and default source is import", () => {
  const db = openLedger(":memory:");
  assert.throws(
    () =>
      importStatuses(db, [
        entry({ summary: "would write" }),
        entry({ status: "wrong" }),
      ]),
    ValidationError,
  );
  assert.equal(history(db).length, 0);
  const results = importStatuses(db, [
    entry({ externalRef: "batch" }),
    entry({ project: "second", summary: "second" }),
  ]);
  assert.equal(results[0]?.entry.source, "import");
  assert.equal(results.length, 2);

  db.exec(`CREATE TRIGGER reject_explosion BEFORE INSERT ON status_entries
    WHEN NEW.summary = 'explode'
    BEGIN SELECT RAISE(ABORT, 'exploded'); END`);
  assert.throws(() =>
    importStatuses(db, [
      entry({ project: "transaction-first", summary: "valid" }),
      entry({ project: "transaction-second", summary: "explode" }),
    ]),
  );
  assert.equal(current(db, "transaction-first").length, 0);
  db.close();
});

test("database path has a stable default and environment override creates its parent directory", () => {
  const directory = mkdtempSync(join(tmpdir(), "pmgr-"));
  const previous = process.env.PMGR_DB_PATH;
  process.env.PMGR_DB_PATH = join(directory, "nested", "ledger.sqlite");
  assert.equal(databasePath(), process.env.PMGR_DB_PATH);
  const db = openLedger();
  db.close();
  if (previous === undefined) delete process.env.PMGR_DB_PATH;
  else process.env.PMGR_DB_PATH = previous;
  assert.equal(
    databasePath(),
    join(homedir(), ".local", "share", "project-mgr", "project-mgr.sqlite"),
  );
  rmSync(directory, { recursive: true, force: true });
});

test("CLI runs through a package-style symlink", () => {
  const directory = mkdtempSync(join(tmpdir(), "pmgr-bin-"));
  const executable = join(directory, "pmgr");
  symlinkSync(
    fileURLToPath(new URL("../src/cli.ts", import.meta.url)),
    executable,
  );
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", executable, "current", "--json"],
    {
      encoding: "utf8",
      env: { ...process.env, PMGR_DB_PATH: ":memory:" },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "[]\n");
  rmSync(directory, { recursive: true, force: true });
});

test("CLI supports add, import, reads, errors, and export formats", () => {
  const directory = mkdtempSync(join(tmpdir(), "pmgr-cli-"));
  const file = join(directory, "ledger.sqlite");
  const importFile = join(directory, "entries.jsonl");
  const jsonFile = join(directory, "entry.json");
  const arrayFile = join(directory, "entries.json");
  const badFile = join(directory, "bad.jsonl");
  const badJsonFile = join(directory, "bad.json");
  const emptyFile = join(directory, "empty.json");
  const portableFile = join(directory, "portable.jsonl");
  const restoredFile = join(directory, "restored.sqlite");
  writeFileSync(
    importFile,
    `${JSON.stringify(entry({ project: "imported", summary: "from file" }))}\n`,
  );
  writeFileSync(
    jsonFile,
    JSON.stringify(entry({ project: "json", summary: "one JSON object" })),
  );
  writeFileSync(
    arrayFile,
    JSON.stringify([entry({ project: "array", summary: "JSON array" })]),
  );
  writeFileSync(badFile, "not-json\n");
  writeFileSync(badJsonFile, "not-json");
  writeFileSync(emptyFile, "\n");
  const previous = process.env.PMGR_DB_PATH;
  process.env.PMGR_DB_PATH = file;
  const execute = (args: string[]) => {
    let result = "";
    run(args, (text) => {
      result += text;
    });
    return result;
  };
  const added = JSON.parse(
    execute([
      "add",
      "--project",
      "cli",
      "--status",
      "active",
      "--summary",
      "added",
      "--progress",
      "covered",
      "--next",
      "test",
      "--next",
      "repeat",
      "--tag",
      "cli",
      "--external-ref",
      "cli-add",
      "--json",
    ]),
  );
  assert.equal(added.project, "cli");
  assert.match(
    execute([
      "status",
      "add",
      "--project",
      "human",
      "--status",
      "active",
      "--summary",
      "human output",
    ]),
    /human output/,
  );
  assert.match(execute(["import", importFile, "--json"]), /from file/);
  assert.match(
    execute(["status", "import", "--file", jsonFile, "--json"]),
    /one JSON object/,
  );
  assert.match(
    execute(["status", "import", arrayFile, "--json"]),
    /JSON array/,
  );
  assert.match(execute(["current"]), /cli\tactive/);
  assert.match(execute(["status", "current"]), /cli\tactive/);
  assert.equal(
    JSON.parse(
      execute([
        "history",
        "--project",
        "cli",
        "--since",
        "2026-08-01T00:00:00Z",
        "--until",
        "2026-08-05T00:00:00Z",
        "--limit",
        "1",
        "--offset",
        "0",
        "--json",
      ]),
    )[0].summary,
    "added",
  );
  assert.match(
    execute(["status", "history", "--project", "cli", "--json"]),
    /added/,
  );
  assert.equal(
    JSON.parse(
      execute([
        "at",
        "--project",
        "cli",
        "--at",
        "2026-08-04T00:00:00Z",
        "--json",
      ]),
    ).project,
    "cli",
  );
  assert.equal(
    JSON.parse(
      execute([
        "status",
        "at",
        "--project",
        "cli",
        "--at",
        "2026-08-01T00:00:00Z",
        "--json",
      ]),
    ),
    null,
  );
  assert.match(
    execute(["export", "--project", "cli", "--format", "jsonl"]),
    /"project":"cli"/,
  );
  const exported = execute(["status", "export", "--format", "json"]);
  assert.match(exported, /imported/);
  assert.doesNotMatch(exported, /"recordedAt"|"id"/);
  assert.match(execute(["status", "export"]), /imported/);
  assert.equal(
    execute(["export", "--project", "missing", "--format", "jsonl"]),
    "",
  );
  assert.equal(
    execute(["history", "--project", "missing"]),
    "No entries found.\n",
  );
  assert.equal(execute(["history", "--project", "missing", "--json"]), "[]\n");
  assert.throws(
    () => execute(["status", "history", "--project", "cli", "--limit", "-1"]),
    ValidationError,
  );
  assert.throws(
    () => execute(["status", "history", "--project", "cli", "--limit", "1.5"]),
    ValidationError,
  );
  assert.throws(() => execute(["status", "history"]), ValidationError);
  assert.throws(() => execute(["status", "add", "--project"]), ValidationError);
  assert.throws(
    () =>
      execute(["status", "current", "--project", "cli", "--project", "again"]),
    ValidationError,
  );
  assert.throws(() => execute(["status", "import", badFile]), ValidationError);
  assert.throws(
    () => execute(["status", "import", badJsonFile]),
    ValidationError,
  );
  assert.throws(
    () => execute(["status", "import", emptyFile]),
    ValidationError,
  );
  assert.throws(() => execute(["status", "import"]), ValidationError);
  assert.throws(() => execute(["wat"]), ValidationError);
  assert.throws(() => execute([]), ValidationError);
  assert.throws(() => execute(["status"]), ValidationError);
  assert.throws(() => execute(["status", "wat"]), ValidationError);
  assert.throws(() => execute(["status", "toString"]), ValidationError);
  assert.throws(
    () => execute(["status", "current", "unexpected"]),
    /does not accept positional arguments/,
  );
  assert.throws(
    () => execute(["status", "current", "--prject", "cli"]),
    /unknown flag/,
  );
  assert.throws(
    () => execute(["status", "current", "--__proto__", "value"]),
    /unknown flag/,
  );
  assert.throws(
    () => execute(["status", "import", importFile, "extra.json"]),
    /at most one file argument/,
  );
  assert.throws(
    () => execute(["status", "import", importFile, "--file", jsonFile]),
    /not both/,
  );
  assert.throws(() => execute(["status", "export", "--json"]), /unknown flag/);
  assert.throws(
    () => execute(["status", "current", "--json", "--json"]),
    /only be supplied once/,
  );
  assert.throws(
    () => execute(["status", "export", "--format", "csv"]),
    ValidationError,
  );

  execute([
    "status",
    "add",
    "--project",
    "tie",
    "--status",
    "active",
    "--summary",
    "tie first",
    "--at",
    timestamp,
  ]);
  execute([
    "status",
    "add",
    "--project",
    "tie",
    "--status",
    "active",
    "--summary",
    "tie second",
    "--at",
    timestamp,
  ]);
  writeFileSync(
    portableFile,
    execute(["status", "export", "--format", "jsonl"]),
  );
  process.env.PMGR_DB_PATH = restoredFile;
  assert.doesNotThrow(() => execute(["status", "import", portableFile]));
  assert.equal(
    JSON.parse(execute(["status", "current", "--project", "cli", "--json"]))[0]
      .summary,
    "added",
  );
  assert.equal(
    JSON.parse(execute(["status", "current", "--project", "tie", "--json"]))[0]
      .summary,
    "tie second",
  );
  if (previous === undefined) delete process.env.PMGR_DB_PATH;
  else process.env.PMGR_DB_PATH = previous;
  rmSync(directory, { recursive: true, force: true });
});
