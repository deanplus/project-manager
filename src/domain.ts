export const statuses = [
  "idea",
  "planned",
  "active",
  "blocked",
  "paused",
  "completed",
  "archived",
] as const;
export const sources = ["human", "agent", "import"] as const;

export type ProjectStatus = (typeof statuses)[number];
export type Source = (typeof sources)[number];

export type StatusEntryInput = {
  project: string;
  status: ProjectStatus;
  summary: string;
  progress?: string;
  blockers?: string[];
  nextSteps?: string[];
  decisions?: string[];
  tags?: string[];
  occurredAt?: string;
  source?: Source;
  externalRef?: string;
};

export type StatusEntry = Required<
  Omit<StatusEntryInput, "progress" | "externalRef">
> & {
  id: number;
  progress?: string;
  externalRef?: string;
  recordedAt: string;
};

export type PortableStatusEntry = Omit<StatusEntry, "id" | "recordedAt">;

const keys = new Set([
  "project",
  "status",
  "summary",
  "progress",
  "blockers",
  "nextSteps",
  "decisions",
  "tags",
  "occurredAt",
  "source",
  "externalRef",
]);
const projectName = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

function text(
  value: unknown,
  field: string,
  required = false,
): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || !value.trim())
    throw new ValidationError(`${field} must be a non-empty string`);
  const normalized = value.trim();
  if (normalized.length > 2_000)
    throw new ValidationError(`${field} must be at most 2000 characters`);
  return normalized;
}

function textList(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100)
    throw new ValidationError(
      `${field} must be an array of at most 100 strings`,
    );
  return value.map((item) => text(item, field, true) as string);
}

export function parseTime(value: unknown, field: string): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new ValidationError(`${field} must be a valid ISO 8601 timestamp`);
  }
  return new Date(value).toISOString();
}

export function validateStatusEntry(
  value: unknown,
  defaultSource: Source = "human",
): StatusEntryInput &
  Required<Pick<StatusEntryInput, "occurredAt" | "source">> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ValidationError("entry must be an object");
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(input))
    if (!keys.has(key)) throw new ValidationError(`unknown field: ${key}`);
  const project = text(input.project, "project", true) as string;
  if (!projectName.test(project))
    throw new ValidationError(
      "project must use letters, numbers, dots, underscores, or hyphens",
    );
  if (!statuses.includes(input.status as ProjectStatus))
    throw new ValidationError("status is invalid");
  const source = input.source === undefined ? defaultSource : input.source;
  if (!sources.includes(source as Source))
    throw new ValidationError("source is invalid");
  const externalRef = text(input.externalRef, "externalRef");
  if (externalRef && externalRef.length > 200)
    throw new ValidationError("externalRef must be at most 200 characters");
  return {
    project,
    status: input.status as ProjectStatus,
    summary: text(input.summary, "summary", true) as string,
    progress: text(input.progress, "progress"),
    blockers: textList(input.blockers, "blockers"),
    nextSteps: textList(input.nextSteps, "nextSteps"),
    decisions: textList(input.decisions, "decisions"),
    tags: textList(input.tags, "tags"),
    occurredAt:
      input.occurredAt === undefined
        ? new Date().toISOString()
        : parseTime(input.occurredAt, "occurredAt"),
    source: source as Source,
    externalRef,
  };
}

export function toPortableStatusEntry(entry: StatusEntry): PortableStatusEntry {
  return {
    project: entry.project,
    status: entry.status,
    summary: entry.summary,
    ...(entry.progress === undefined ? {} : { progress: entry.progress }),
    blockers: entry.blockers,
    nextSteps: entry.nextSteps,
    decisions: entry.decisions,
    tags: entry.tags,
    occurredAt: entry.occurredAt,
    source: entry.source,
    ...(entry.externalRef === undefined
      ? {}
      : { externalRef: entry.externalRef }),
  };
}
