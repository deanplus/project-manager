import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { run } from "../src/cli.js";

const execute = (args: string[]) => {
  let output = "";
  run(args, (text) => {
    output += text;
  });
  return output;
};

test("help and version do not open the ledger; aliases and command help work", () => {
  const previous = process.env.PMGR_DB_PATH;
  const dir = mkdtempSync(join(tmpdir(), "pmgr-help-"));
  const db = join(dir, "not-created", "ledger.sqlite");
  process.env.PMGR_DB_PATH = db;
  try {
    for (const args of [[], ["-h"], ["--help"], ["help"]]) {
      assert.match(execute(args), /Usage: pmgr <command>/);
      assert.match(execute(args), /PMGR_DB_PATH/);
    }
    for (const action of [
      "add",
      "complete",
      "revoke-completion",
      "import",
      "current",
      "projects",
      "list",
      "set-project",
      "history",
      "at",
      "export",
      "serve",
    ]) {
      const output = execute([action, "--help"]);
      assert.match(output, new RegExp(`Usage: pmgr ${action} `));
      assert.equal(execute(["help", action]), output);
      assert.equal(execute(["status", action, "-h"]), output);
      assert.equal(execute(["-h", action]), output);
    }
    assert.match(execute(["add", "-h"]), /--completes <value> \(repeatable\)/);
    const { version } = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    );
    for (const option of ["-v", "-V", "--version", "version"]) {
      assert.equal(execute([option]), `${version}\n`);
    }
    for (const args of [
      ["help", "wat"],
      ["help", "toString"],
      ["help", "add", "extra"],
      ["--help", "--json"],
      ["add", "--help", "--typo", "x"],
      ["current", "--version"],
      ["version", "extra"],
      ["version", "--json"],
      ["-h", "--help"],
      ["-v", "--version"],
    ]) {
      assert.throws(() => execute(args));
    }
    assert.equal(existsSync(db), false);
    // A path that cannot be opened also proves these calls do not initialize SQLite.
    process.env.PMGR_DB_PATH = dir;
    assert.match(execute(["-h"]), /Usage:/);
    assert.equal(execute(["-v"]), `${version}\n`);
    for (const args of [["-h"], ["-v"], ["serve", "-h"]]) {
      const child = spawnSync(
        process.execPath,
        ["--import", "tsx", "src/cli.ts", ...args],
        { encoding: "utf8", env: process.env },
      );
      assert.equal(child.status, 0, child.stderr);
      assert.equal(child.stderr, "");
      assert.ok(child.stdout.length > 0);
    }
  } finally {
    if (previous === undefined) delete process.env.PMGR_DB_PATH;
    else process.env.PMGR_DB_PATH = previous;
    rmSync(dir, { recursive: true, force: true });
  }
});
