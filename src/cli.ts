#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import {
  addStatus,
  at,
  current,
  history,
  importLedger,
  exportLedger,
  changeCompletion,
  type Source,
  listProjects,
  openLedger,
  parseTime,
  type ProjectOverview,
  type ProjectStatus,
  setProjectMetadata,
  startServer,
  ValidationError,
} from "./index.js";

type Flags = Record<string, string | string[] | boolean>;
const repeats = new Set(["next", "blocker", "decision", "tag", "completes"]);

function parse(argv: string[]): { command: string[]; flags: Flags } {
  const command: string[] = [];
  const flags: Flags = Object.create(null) as Flags;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      command.push(token);
      continue;
    }
    const key = token.slice(2);
    if (
      key === "json" ||
      key === "clear-description" ||
      key === "clear-notes" ||
      key === "open" ||
      key === "no-open"
    ) {
      if (flags[key] !== undefined)
        throw new ValidationError(`--${key} may only be supplied once`);
      flags[key] = true;
      continue;
    }
    const value = argv[++index];
    if (!value || value.startsWith("--"))
      throw new ValidationError(`--${key} requires a value`);
    if (repeats.has(key))
      flags[key] = [...((flags[key] as string[] | undefined) ?? []), value];
    else if (flags[key] !== undefined)
      throw new ValidationError(`--${key} may only be supplied once`);
    else flags[key] = value;
  }
  return { command, flags };
}

const allowedFlags = new Map<string, ReadonlySet<string>>([
  [
    "add",
    new Set([
      "project",
      "status",
      "summary",
      "description",
      "notes",
      "progress",
      "blocker",
      "next",
      "decision",
      "tag",
      "at",
      "source",
      "external-ref",
      "completes",
      "json",
    ]),
  ],
  ["complete", new Set(["entry", "by", "reason", "source", "json"])],
  ["revoke-completion", new Set(["entry", "by", "reason", "source", "json"])],
  ["import", new Set(["file", "json"])],
  ["current", new Set(["project", "json"])],
  ["projects", new Set(["query", "json"])],
  ["list", new Set(["query", "json"])],
  [
    "set-project",
    new Set([
      "project",
      "display-name",
      "description",
      "notes",
      "clear-description",
      "clear-notes",
      "json",
    ]),
  ],
  [
    "history",
    new Set(["project", "since", "until", "limit", "offset", "json"]),
  ],
  ["at", new Set(["project", "at", "json"])],
  ["export", new Set(["project", "format"])],
  ["serve", new Set(["port", "host", "open", "no-open", "json"])],
]);

function validateInvocation(command: string[], flags: Flags): string {
  const statusCommand = command[0] === "status";
  const action = command[statusCommand ? 1 : 0];
  const allowed =
    typeof action === "string" ? allowedFlags.get(action) : undefined;
  if (typeof action !== "string" || !allowed)
    throw new ValidationError(
      "usage: pmgr <add|complete|revoke-completion|import|current|projects|list|set-project|history|at|export|serve> (or: pmgr status <action>)",
    );
  const positional = command.slice(statusCommand ? 2 : 1);
  if (action === "import") {
    if (positional.length > 1)
      throw new ValidationError("import accepts at most one file argument");
    if (positional.length === 1 && flags.file !== undefined)
      throw new ValidationError(
        "import file must be positional or --file, not both",
      );
  } else if (positional.length) {
    throw new ValidationError(`${action} does not accept positional arguments`);
  }
  for (const key of Object.keys(flags))
    if (!allowed.has(key))
      throw new ValidationError(`unknown flag for ${action}: --${key}`);
  return action;
}

function stringFlag(
  flags: Flags,
  name: string,
  required = false,
): string | undefined {
  const value = flags[name];
  if (required && typeof value !== "string")
    throw new ValidationError(`--${name} is required`);
  return typeof value === "string" ? value : undefined;
}

function listFlag(flags: Flags, name: string): string[] {
  return (flags[name] as string[] | undefined) ?? [];
}
function numberFlag(flags: Flags, name: string, fallback: number): number {
  const value = stringFlag(flags, name);
  if (!value) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0)
    throw new ValidationError(`--${name} must be a non-negative integer`);
  return number;
}

function output(
  value: unknown,
  json: boolean,
  write: (text: string) => void,
): void {
  if (json) write(`${JSON.stringify(value)}\n`);
  else if (Array.isArray(value)) {
    const rows = value
      .map(
        (entry) =>
          `${entry.project}\t${entry.effectiveStatus ?? entry.status}\t${entry.occurredAt}\t${entry.summary}${entry.completedBy ? ` (completed by #${entry.completedBy.id}; original: ${entry.status})` : ""}`,
      )
      .join("\n");
    write(`${rows || "No entries found."}\n`);
  } else write(`${JSON.stringify(value, null, 2)}\n`);
}

function formatProjectOverview(item: ProjectOverview): string {
  const lines = [`${item.project}\t${item.displayName}`];
  if (item.description) lines.push(`  Description: ${item.description}`);
  if (item.notes) lines.push(`  Notes: ${item.notes}`);
  if (item.latestStatus) {
    lines.push(
      `  Latest Status: ${item.latestStatus.status}\t${item.latestStatus.occurredAt}\t${item.latestStatus.summary}`,
    );
  } else {
    lines.push(`  Latest Status: (none)`);
  }
  return lines.join("\n");
}

function outputProjects(
  items: ProjectOverview[],
  json: boolean,
  write: (text: string) => void,
): void {
  if (json) write(`${JSON.stringify(items)}\n`);
  else if (items.length === 0) write("No projects found.\n");
  else write(`${items.map(formatProjectOverview).join("\n")}\n`);
}

function imported(file: string): unknown[] {
  if (!file) throw new ValidationError("import file is required");
  const content = readFileSync(file, "utf8").trim();
  if (!content) throw new ValidationError(`${basename(file)} is empty`);
  if (file.endsWith(".jsonl"))
    return content.split(/\r?\n/).map((line, index) => {
      try {
        return JSON.parse(line) as unknown;
      } catch {
        throw new ValidationError(
          `${basename(file)} line ${index + 1} is not JSON`,
        );
      }
    });
  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw new ValidationError(`${basename(file)} is not JSON`);
  }
  return Array.isArray(parsed) ? parsed : [parsed];
}

export function run(
  argv: string[],
  write = process.stdout.write.bind(process.stdout),
): unknown {
  const { command, flags } = parse(argv);
  const action = validateInvocation(command, flags);
  const db = openLedger();
  const json = flags.json === true;
  try {
    switch (action) {
      case "add": {
        const project = stringFlag(flags, "project", true) as string;
        const description = stringFlag(flags, "description");
        const notes = stringFlag(flags, "notes");
        const result = db
          .transaction(() => {
            if (description !== undefined || notes !== undefined) {
              setProjectMetadata(db, { project, description, notes });
            }
            return addStatus(
              db,
              {
                project,
                status: stringFlag(flags, "status") as unknown as ProjectStatus,
                summary: stringFlag(flags, "summary", true),
                progress: stringFlag(flags, "progress"),
                blockers: listFlag(flags, "blocker"),
                nextSteps: listFlag(flags, "next"),
                decisions: listFlag(flags, "decision"),
                tags: listFlag(flags, "tag"),
                occurredAt: stringFlag(flags, "at"),
                source: stringFlag(flags, "source"),
                externalRef: stringFlag(flags, "external-ref"),
              },
              "human",
              listFlag(flags, "completes"),
            ).entry;
          })
          .immediate();
        output(result, json, write);
        break;
      }

      case "complete":
      case "revoke-completion":
        output(
          changeCompletion(
            db,
            stringFlag(flags, "entry", true) as string,
            stringFlag(flags, "by", true) as string,
            action === "complete" ? "complete" : "revoke",
            stringFlag(flags, "reason"),
            (stringFlag(flags, "source") ?? "human") as Source,
          ),
          json,
          write,
        );
        break;
      case "import":
        output(
          importLedger(
            db,
            imported(
              stringFlag(flags, "file") ??
                command[command[0] === "status" ? 2 : 1] ??
                "",
            ),
          ).map((result) => result.entry),
          json,
          write,
        );
        break;
      case "current":
        output(current(db, stringFlag(flags, "project")), json, write);
        break;
      case "projects":
      case "list":
        outputProjects(
          listProjects(db, { query: stringFlag(flags, "query") }),
          json,
          write,
        );
        break;
      case "set-project": {
        const project = stringFlag(flags, "project", true) as string;
        const displayName = stringFlag(flags, "display-name");
        let description: string | null | undefined = undefined;
        if (flags["clear-description"] === true) {
          if (flags.description !== undefined)
            throw new ValidationError(
              "cannot specify both --description and --clear-description",
            );
          description = null;
        } else if (flags.description !== undefined) {
          description = stringFlag(flags, "description");
        }

        let notes: string | null | undefined = undefined;
        if (flags["clear-notes"] === true) {
          if (flags.notes !== undefined)
            throw new ValidationError(
              "cannot specify both --notes and --clear-notes",
            );
          notes = null;
        } else if (flags.notes !== undefined) {
          notes = stringFlag(flags, "notes");
        }

        output(
          setProjectMetadata(db, {
            project,
            displayName,
            description,
            notes,
          }),
          json,
          write,
        );
        break;
      }

      case "history":
        output(
          history(db, stringFlag(flags, "project"), {
            since:
              stringFlag(flags, "since") &&
              parseTime(stringFlag(flags, "since"), "since"),
            until:
              stringFlag(flags, "until") &&
              parseTime(stringFlag(flags, "until"), "until"),
            limit: numberFlag(flags, "limit", 100),
            offset: numberFlag(flags, "offset", 0),
          }),
          json,
          write,
        );
        break;
      case "at":
        output(
          at(
            db,
            stringFlag(flags, "project", true) as string,
            parseTime(stringFlag(flags, "at", true), "at"),
          ) ?? null,
          json,
          write,
        );
        break;
      case "export": {
        const bundle = exportLedger(db, stringFlag(flags, "project"));
        const format = stringFlag(flags, "format") ?? "json";
        if (format !== "json" && format !== "jsonl")
          throw new ValidationError("--format must be json or jsonl");
        // JSONL contains one versioned bundle per line, preserving event order.
        output(bundle, true, write);
        break;
      }

      case "serve": {
        const port =
          flags.port !== undefined
            ? numberFlag(flags, "port", 3000)
            : undefined;
        const host = stringFlag(flags, "host");
        const open = flags["no-open"] === true ? false : true;
        return startServer({ port, host, open, db }).then((instance) => {
          if (json) {
            write(
              `${JSON.stringify({ url: instance.url, port: instance.port, host: instance.host })}\n`,
            );
          } else {
            write(`Server running at ${instance.url}\n`);
          }
          return instance;
        });
      }
    }
  } finally {
    if (action !== "serve") {
      db.close();
    }
  }
}

/* c8 ignore start -- process entry glue is covered by the CLI integration tests through run(). */
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  try {
    await run(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
/* c8 ignore stop */
