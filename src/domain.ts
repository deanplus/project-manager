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

export type ProjectMetadata = {
  project: string;
  displayName: string;
  description?: string;
  notes?: string;
  createdAt: string;
};

export type ProjectOverview = ProjectMetadata & {
  latestStatus?: StatusEntry;
};

export type ProjectMetadataInput = {
  project: string;
  displayName?: string;
  description?: string | null;
  notes?: string | null;
};

export type NextTodoRef = {
  uid: string;
  title: string;
  status: "open" | "completed" | "cancelled";
  project: string | null;
};

export type StatusEntryInput = {
  uid?: string;
  project: string;
  status: ProjectStatus;
  summary: string;
  progress?: string;
  blockers?: string[];
  nextSteps?: string[];
  nextTodoUids?: string[];
  nextStepsSourceUid?: string;
  decisions?: string[];
  tags?: string[];
  occurredAt?: string;
  source?: Source;
  externalRef?: string;
};

export type StatusEntry = Required<
  Omit<
    StatusEntryInput,
    "progress" | "externalRef" | "nextStepsSourceUid" | "nextTodoUids"
  >
> & {
  nextStepsSourceUid?: string;
  nextTodoUids?: string[];
  /** Live Todo rows for display. Not a historical as-of view. */
  nextTodos?: NextTodoRef[];
  id: number;
  progress?: string;
  externalRef?: string;
  recordedAt: string;
  effectiveStatus?: ProjectStatus;
  isCurrent?: boolean;
  completedBy?: {
    uid: string;
    id: number;
    summary: string;
    occurredAt: string;
    recordedAt: string;
  };
};

export type PortableStatusEntry = Omit<
  StatusEntry,
  | "id"
  | "recordedAt"
  | "effectiveStatus"
  | "isCurrent"
  | "completedBy"
  | "nextTodos"
>;

const keys = new Set([
  "uid",
  "project",
  "status",
  "summary",
  "progress",
  "blockers",
  "nextSteps",
  "nextTodoUids",
  "nextStepsSourceUid",
  "decisions",
  "tags",
  "occurredAt",
  "source",
  "externalRef",
]);
const projectMetadataKeys = new Set([
  "project",
  "displayName",
  "description",
  "notes",
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

function nullableText(
  value: unknown,
  field: string,
): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string")
    throw new ValidationError(`${field} must be a string or null`);
  const normalized = value.trim();
  if (normalized === "") return null;
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

function uidList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > 100)
    throw new ValidationError(`${field} must be an array of at most 100 uuids`);
  const uids = value.map((item) => validateUid(item));
  if (new Set(uids).size !== uids.length)
    throw new ValidationError(`${field} contains a duplicate uid`);
  return uids;
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

export function validateProjectMetadataInput(
  value: unknown,
): ProjectMetadataInput {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ValidationError("project metadata must be an object");
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(input))
    if (!projectMetadataKeys.has(key))
      throw new ValidationError(`unknown field: ${key}`);
  const project = text(input.project, "project", true) as string;
  if (!projectName.test(project))
    throw new ValidationError(
      "project must use letters, numbers, dots, underscores, or hyphens",
    );
  const displayName = text(input.displayName, "displayName");
  const description = nullableText(input.description, "description");
  const notes = nullableText(input.notes, "notes");
  return {
    project,
    ...(displayName !== undefined ? { displayName } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(notes !== undefined ? { notes } : {}),
  };
}

export function validateStatusEntry(
  value: unknown,
  defaultSource: Source = "human",
): StatusEntryInput &
  Required<
    Pick<
      StatusEntryInput,
      "occurredAt" | "source" | "nextSteps" | "blockers" | "decisions" | "tags"
    >
  > {
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
  let statusInput = input.status;
  if (statusInput === undefined || statusInput === null) {
    statusInput = "completed";
  } else if (
    typeof statusInput === "string" &&
    statusInput.trim().toLowerCase() === "done"
  ) {
    statusInput = "completed";
  }
  if (!statuses.includes(statusInput as ProjectStatus))
    throw new ValidationError("status is invalid");
  const source = input.source === undefined ? defaultSource : input.source;
  if (!sources.includes(source as Source))
    throw new ValidationError("source is invalid");
  const externalRef = text(input.externalRef, "externalRef");
  if (externalRef && externalRef.length > 200)
    throw new ValidationError("externalRef must be at most 200 characters");
  const nextSteps = textList(input.nextSteps, "nextSteps");
  const nextStepsSourceUid =
    input.nextStepsSourceUid === undefined
      ? undefined
      : validateUid(input.nextStepsSourceUid);
  // null and omission both mean legacy rows: the refs field is absent, not [].
  const nextTodoUids =
    input.nextTodoUids === undefined || input.nextTodoUids === null
      ? undefined
      : uidList(input.nextTodoUids, "nextTodoUids");
  if (nextTodoUids !== undefined && nextSteps.length > 0)
    throw new ValidationError(
      "cannot combine nextSteps text with nextTodoUids",
    );
  if (nextTodoUids !== undefined && nextStepsSourceUid !== undefined)
    throw new ValidationError("invalid next step provenance");
  return {
    ...(input.uid === undefined ? {} : { uid: validateUid(input.uid) }),
    project,
    status: statusInput as ProjectStatus,
    summary: text(input.summary, "summary", true) as string,
    progress: text(input.progress, "progress"),
    blockers: textList(input.blockers, "blockers"),
    nextSteps,
    ...(nextTodoUids !== undefined ? { nextTodoUids } : {}),
    ...(nextStepsSourceUid !== undefined ? { nextStepsSourceUid } : {}),
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
  const result: PortableStatusEntry = {
    uid: entry.uid,
    project: entry.project,
    status: entry.status,
    summary: entry.summary,
    blockers: entry.blockers,
    nextSteps: entry.nextSteps,
    decisions: entry.decisions,
    tags: entry.tags,
    occurredAt: entry.occurredAt,
    source: entry.source,
  };
  if (entry.nextStepsSourceUid !== undefined)
    result.nextStepsSourceUid = entry.nextStepsSourceUid;
  if (entry.nextTodoUids !== undefined)
    result.nextTodoUids = entry.nextTodoUids;
  if (entry.progress !== undefined) result.progress = entry.progress;
  if (entry.externalRef !== undefined) result.externalRef = entry.externalRef;
  return result;
}

export function validateUid(value: unknown): string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
      value,
    )
  )
    throw new ValidationError("uid must be a lowercase UUID");
  return value;
}
