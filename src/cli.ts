#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";
import {
  addStatus,
  createTodo,
  convertNextStep,
  getEntry,
  openWork,
  openWorkByProject,
  listTodos,
  updateTodo,
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
const booleanFlags = new Set([
  "json",
  "clear-description",
  "clear-notes",
  "clear-content",
  "clear-start-at",
  "clear-due-at",
  "open",
  "no-open",
  "help",
  "version",
  "replace-next",
  "all",
]);
const repeats = new Set([
  "next",
  "next-todo",
  "blocker",
  "decision",
  "tag",
  "completes",
  "done-todo",
  "cancel-todo",
]);

function parse(argv: string[]): { command: string[]; flags: Flags } {
  const command: string[] = [];
  const flags: Flags = Object.create(null) as Flags;
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    const token =
      raw === "-h"
        ? "--help"
        : raw === "-v" || raw === "-V"
          ? "--version"
          : raw;
    if (!token.startsWith("--")) {
      command.push(token);
      continue;
    }
    const key = token.slice(2);
    if (booleanFlags.has(key)) {
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
      "next-todo",
      "replace-next",
      "done-todo",
      "cancel-todo",
      "decision",
      "tag",
      "at",
      "source",
      "external-ref",
      "completes",
      "json",
    ]),
  ],
  [
    "todo-add",
    new Set([
      "title",
      "project",
      "entry",
      "content",
      "start-at",
      "due-at",
      "json",
    ]),
  ],
  ["todos", new Set(["project", "status", "json"])],
  ["next", new Set(["project", "json"])],
  ["todo-convert", new Set(["entry", "index", "project", "all", "json"])],
  [
    "todo-update",
    new Set([
      "uid",
      "status",
      "project",
      "title",
      "content",
      "start-at",
      "due-at",
      "clear-content",
      "clear-start-at",
      "clear-due-at",
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

const commandHelp: Record<string, [string, string]> = {
  next: ["List all open work, pinned first", "[--project <name>] [--json]"],
  "todo-convert": [
    "Convert legacy next steps without appending a snapshot",
    "--entry <id-or-uid> --index <n> | --project <name> | --all [--json]",
  ],
  "todo-add": [
    "Create an independent or linked Todo",
    "--title <text> [--project <name>] [--entry <uid>] [--content <text>] [--start-at <iso-time>] [--due-at <iso-time>] [--json]",
  ],
  todos: [
    "List Todos",
    "[--project <name>] [--status open|completed|cancelled] [--json]",
  ],
  "todo-update": [
    "Edit Todo wording, schedule, status, or project",
    "--uid <uuid> [--title <text>] [--content <text> | --clear-content] [--start-at <iso-time> | --clear-start-at] [--due-at <iso-time> | --clear-due-at] [--status open|completed|cancelled] [--project <name>] [--json]",
  ],
  add: [
    "Append a status snapshot",
    "--project <name> --summary <text> [--next <text> | --next-todo <uid>] [--replace-next] [--done-todo <uid>] [--cancel-todo <uid>] [options]",
  ],
  complete: [
    "Link a completed activity to its follow-up",
    "--entry <id-or-uid> --by <id-or-uid> [options]",
  ],
  "revoke-completion": [
    "Revoke an activity completion link",
    "--entry <id-or-uid> --by <id-or-uid> [options]",
  ],
  import: [
    "Import a JSON or JSONL ledger",
    "<file> [--json] | --file <path> [--json]",
  ],
  current: [
    "Show the latest status of each project",
    "[--project <name>] [--json]",
  ],
  projects: ["List or search projects", "[--query <text>] [--json]"],
  list: ["Alias for projects", "[--query <text>] [--json]"],
  "set-project": ["Update project metadata", "--project <name> [options]"],
  history: [
    "Show status history, newest first",
    "[--project <name>] [options]",
  ],
  at: [
    "Show a project's status at a time",
    "--project <name> --at <ISO-timestamp> [--json]",
  ],
  export: [
    "Export a portable ledger",
    "[--project <name>] [--format json|jsonl]",
  ],
  serve: [
    "Start the local web dashboard",
    "[--port <number>] [--host <address>] [--no-open] [--json]",
  ],
};

function help(action?: string): string {
  if (action) {
    const [description, usage] = commandHelp[action];
    const options = [...allowedFlags.get(action)!].map(
      (key) =>
        `  --${key}${booleanFlags.has(key) ? "" : " <value>"}${repeats.has(key) ? " (repeatable)" : ""}`,
    );
    const todoHelp = [
      "todo-add",
      "todo-update",
      "todos",
      "next",
      "current",
    ].includes(action)
      ? "\nFull Todo metadata is available in --json; next/current/todos text appends [due <UTC>] when dated. startAt is an optional planned start, dueAt an optional deadline; both default to null (no inferred dates). Use explicit-zone ISO timestamps with seconds, no fractions; output is UTC. When both exist, start must not exceed due. Content is multiline plain text, at most 8000 code units; blank becomes null. Empty --content is an error; use --clear-content on update. Omitted update fields are unchanged; --clear-* clears a field and conflicts with its value flag. Edits preserve UID and pins. Values beginning with -- are not supported.\n"
      : "";
    return `Usage: pmgr ${action} ${usage}\n\n${description}\n\nOptions:\n${options.join("\n")}\n  -h, --help  Show this help\n${todoHelp}`;
  }
  return `Usage: pmgr <command> [options]
       pmgr status <command> [options]

Local-first, append-only project status ledger.

Commands:
${Object.entries(commandHelp)
  .map(([name, [description]]) => `  ${name.padEnd(20)}${description}`)
  .join("\n")}
  help [command]      Show general or command help
  version             Show the installed package version

Options:
  -h, --help          Show help (also supported after a command)
  -v, -V, --version   Show the installed package version

Environment:
  PMGR_DB_PATH        SQLite path (default: ~/.local/share/project-mgr/project-mgr.sqlite)

Examples:
  pmgr current --json
  pmgr add --project demo --status active --summary "Work started"
  pmgr help history
`;
}

function validateInvocation(command: string[], flags: Flags): string {
  const statusCommand = command[0] === "status";
  const action = command[statusCommand ? 1 : 0];
  const allowed =
    typeof action === "string" ? allowedFlags.get(action) : undefined;
  if (typeof action !== "string" || !allowed)
    throw new ValidationError(
      "usage: pmgr <add|next|todo-add|todos|todo-update|todo-convert|complete|revoke-completion|import|current|projects|list|set-project|history|at|export|serve> (or: pmgr status <action>)",
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

function nullableTodoFlag(
  flags: Flags,
  name: string,
): string | null | undefined {
  if (flags[`clear-${name}`] === true) {
    if (flags[name] !== undefined)
      throw new ValidationError(
        `cannot specify both --${name} and --clear-${name}`,
      );
    return null;
  }
  return stringFlag(flags, name);
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
          `${entry.project}\t${entry.effectiveStatus ?? entry.status}\t${entry.occurredAt}\t${entry.summary}${entry.completedBy ? ` (completed by #${entry.completedBy.id}; original: ${entry.status})` : ""}${entry.openWork ? entry.openWork.map((item: { title: string; pinned: boolean; dueAt?: string | null }) => `\n  - ${item.title}${item.pinned ? " [pinned]" : ""}${item.dueAt ? ` [due ${item.dueAt}]` : ""}`).join("") : ""}`,
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
  if (command[0] === "help") {
    command.shift();
    flags.help = true;
  }
  if (argv.length === 0 || flags.help === true) {
    delete flags.help;
    const action =
      command.length || Object.keys(flags).length
        ? validateInvocation(command, flags)
        : undefined;
    write(help(action));
    return;
  }
  if (flags.version === true || command[0] === "version") {
    if (
      Object.keys(flags).some((key) => key !== "version") ||
      (command.length > 0 && (command.length !== 1 || command[0] !== "version"))
    )
      throw new ValidationError("usage: pmgr --version (or: pmgr version)");
    const metadata = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version: string };
    write(`${metadata.version}\n`);
    return;
  }
  const action = validateInvocation(command, flags);
  const db = openLedger();
  const json = flags.json === true;
  try {
    switch (action) {
      case "next": {
        const items = openWork(db, stringFlag(flags, "project"));
        if (json) output(items, true, write);
        else
          write(
            items.length
              ? items
                  .map(
                    (item) =>
                      `${item.project ?? "-"}\t${item.kind === "todo" ? item.uid : `${item.entryUid}#${item.stepIndex}`}\t${item.pinned ? "pinned" : "-"}\t${item.title}${item.kind === "todo" && item.dueAt ? ` [due ${item.dueAt}]` : ""}`,
                  )
                  .join("\n") + "\n"
              : "No open work.\n",
          );
        break;
      }
      case "todo-convert": {
        const ref = stringFlag(flags, "entry");
        const project = stringFlag(flags, "project");
        if (
          Number(ref !== undefined) +
            Number(project !== undefined) +
            Number(flags.all === true) !==
          1
        )
          throw new ValidationError(
            "use exactly one of --entry, --project, or --all",
          );
        if ((ref === undefined) !== (flags.index === undefined))
          throw new ValidationError(
            "--entry requires --index; --index requires --entry",
          );
        const todos = db
          .transaction(() => {
            if (ref !== undefined)
              return [convertNextStep(db, ref, numberFlag(flags, "index", 0))];
            return current(db, project).flatMap((entry) => {
              if (entry.nextTodoUids !== undefined) return [];
              const source = entry.nextStepsSourceUid
                ? getEntry(db, entry.nextStepsSourceUid)!
                : entry;
              return source.nextSteps.map((_, index) =>
                convertNextStep(db, source.uid, index),
              );
            });
          })
          .immediate();
        if (json) output(todos, true, write);
        else
          write(
            todos
              .map(
                (todo) =>
                  `${todo.uid}\t${todo.status}\t${todo.project}\t${todo.title}`,
              )
              .join("\n") + "\n",
          );
        break;
      }
      case "todo-add":
        output(
          createTodo(db, {
            title: stringFlag(flags, "title", true),
            project: stringFlag(flags, "project"),
            entryUid: stringFlag(flags, "entry"),
            content: stringFlag(flags, "content"),
            startAt: stringFlag(flags, "start-at"),
            dueAt: stringFlag(flags, "due-at"),
          }),
          json,
          write,
        );
        break;
      case "todos": {
        const status = stringFlag(flags, "status");
        if (
          status !== undefined &&
          status !== "open" &&
          status !== "completed" &&
          status !== "cancelled"
        )
          throw new ValidationError(
            "--status must be open, completed, or cancelled",
          );
        const todos = listTodos(
          db,
          stringFlag(flags, "project"),
          status === undefined
            ? {}
            : { status: status as "open" | "completed" | "cancelled" },
        );
        if (json) output(todos, true, write);
        else
          write(
            todos
              .map(
                (t) =>
                  `${t.uid}\t${t.status}\t${t.project ?? "-"}\t${t.title}${t.dueAt ? ` [due ${t.dueAt}]` : ""}`,
              )
              .join("\n") + "\n",
          );
        break;
      }
      case "todo-update":
        output(
          updateTodo(db, stringFlag(flags, "uid", true)!, {
            title: stringFlag(flags, "title"),
            content: nullableTodoFlag(flags, "content"),
            startAt: nullableTodoFlag(flags, "start-at"),
            dueAt: nullableTodoFlag(flags, "due-at"),
            status: stringFlag(flags, "status"),
            project: stringFlag(flags, "project"),
          }),
          json,
          write,
        );
        break;
      case "add": {
        const project = stringFlag(flags, "project", true) as string;
        const description = stringFlag(flags, "description");
        const notes = stringFlag(flags, "notes");
        const next = listFlag(flags, "next");
        const nextTodo = listFlag(flags, "next-todo");
        if (next.length > 0 && nextTodo.length > 0)
          throw new ValidationError("cannot combine --next and --next-todo");
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
                nextSteps: next,
                nextMode: flags["replace-next"] === true ? "replace" : "carry",
                closeTodos: [
                  ...listFlag(flags, "done-todo").map((uid) => ({
                    uid,
                    status: "completed",
                  })),
                  ...listFlag(flags, "cancel-todo").map((uid) => ({
                    uid,
                    status: "cancelled",
                  })),
                ],
                ...(nextTodo.length > 0 ? { nextTodoUids: nextTodo } : {}),
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
      case "current": {
        const project = stringFlag(flags, "project");
        // One open-work scan for all projects, grouped per project.
        const { groups } = openWorkByProject(db, project);
        output(
          current(db, project).map((entry) => ({
            ...entry,
            openWork: groups.get(entry.project)!,
          })),
          json,
          write,
        );
        break;
      }
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
