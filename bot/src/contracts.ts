import type {
  RankedResult,
  SeatCategory,
  TimeSlot,
} from "../../packages/core/src";

export type TaskStatus =
  | "queued"
  | "scheduled"
  | "scanning"
  | "monitoring"
  | "selecting"
  | "awaiting_user"
  | "awaiting_payment"
  | "completed"
  | "stopped"
  | "error";
export interface TaskInput {
  targetShowId?: string;
  movieName: string;
  targetDate: string;
  requiredSeats: number;
  mode: "instant" | "monitor";
  source: "live" | "demo";
  intervalSeconds: number;
  scheduledAt?: string;
  allowedRows: string[];
  preferredTimes: TimeSlot[];
  locationIds: string[];
  preferredCategory: "any" | SeatCategory;
  rowPreference: "center" | "front" | "back";
  strategy: "best" | "each_location";
  keepTogether: boolean;
  autoReserve: boolean;
}
export interface Handoff {
  status: "awaiting_user" | "awaiting_payment";
  message: string;
  url: string;
  selectedSeats: string[];
}
export interface Candidate extends RankedResult {
  key: string;
  seatLabels: string[];
  simulated: boolean;
  handoff?: Handoff;
}
export interface Activity {
  id: string;
  taskId: string;
  time: string;
  level: "info" | "success" | "warning" | "error";
  message: string;
}
export interface BotTask {
  id: string;
  input: TaskInput;
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  checks: number;
  lastCheckAt?: string;
  nextCheckAt?: string;
  error?: string;
  results: Candidate[];
  logs: Activity[];
}
export interface BrowserStatus {
  connected: boolean;
  pages: number;
  headless: boolean;
  mode?: "regular" | "persistent";
}
export interface CredentialStatus {
  configured: boolean;
  email: string;
  remembered: boolean;
  canRemember: boolean;
}
export interface Snapshot {
  tasks: BotTask[];
  browser: BrowserStatus;
  startedAt: string;
  version: string;
}

export function validateTask(value: unknown): TaskInput {
  const v = value as Record<string, unknown>;
  if (!v || typeof v !== "object")
    throw new Error("A task configuration is required.");
  const text = (key: string) =>
    typeof v[key] === "string" ? (v[key] as string).trim() : "";
  const movieName = text("movieName");
  const targetShowId = text("targetShowId") || undefined;
  if (targetShowId && !/^[a-zA-Z0-9-]{1,100}$/.test(targetShowId))
    throw new Error("Invalid selected show.");
  if (!movieName || movieName.length > 120)
    throw new Error("Enter a movie name between 1 and 120 characters.");
  const targetDate = text("targetDate");
  const parsedDate = new Date(`${targetDate}T00:00:00Z`);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(targetDate) ||
    !Number.isFinite(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== targetDate
  )
    throw new Error("Choose a valid show date.");
  const today = new Date(Date.now() + 6 * 3600_000).toISOString().slice(0, 10);
  if (targetDate < today)
    throw new Error("The show date cannot be in the past.");
  const requiredSeats = Number(v.requiredSeats);
  if (
    !Number.isInteger(requiredSeats) ||
    requiredSeats < 1 ||
    requiredSeats > 50
  )
    throw new Error("Choose between 1 and 50 seats.");
  const intervalSeconds =
    v.intervalSeconds === undefined ? 5 : Number(v.intervalSeconds);
  if (
    !Number.isFinite(intervalSeconds) ||
    intervalSeconds < 2 ||
    intervalSeconds > 300
  )
    throw new Error("Polling interval must be between 2 and 300 seconds.");
  const choices = <T extends string>(
    key: string,
    list: readonly T[],
    fallback: T,
  ): T => {
    if (v[key] === undefined) return fallback;
    if (!list.includes(v[key] as T)) throw new Error(`Invalid ${key}.`);
    return v[key] as T;
  };
  const strings = (key: string, pattern: RegExp, max: number): string[] => {
    if (v[key] === undefined) return [];
    if (
      !Array.isArray(v[key]) ||
      (v[key] as unknown[]).length > max ||
      !(v[key] as unknown[]).every(
        (x) => typeof x === "string" && pattern.test(x),
      )
    )
      throw new Error(`Invalid ${key}.`);
    return [...new Set(v[key] as string[])];
  };
  const scheduledAt = text("scheduledAt") || undefined;
  if (
    scheduledAt &&
    (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(scheduledAt) ||
      !Number.isFinite(Date.parse(scheduledAt)))
  )
    throw new Error("The schedule must include a valid timezone.");
  for (const key of ["keepTogether", "autoReserve"])
    if (v[key] !== undefined && typeof v[key] !== "boolean")
      throw new Error(`Invalid ${key}.`);
  return {
    targetShowId,
    movieName,
    targetDate,
    requiredSeats,
    intervalSeconds,
    scheduledAt,
    mode: choices("mode", ["instant", "monitor"], "instant"),
    source: choices("source", ["live", "demo"], "live"),
    allowedRows: strings("allowedRows", /^[A-Z]{1,3}$/, 30),
    preferredTimes: strings(
      "preferredTimes",
      /^(morning|afternoon|evening|night)$/,
      4,
    ) as TimeSlot[],
    locationIds: strings("locationIds", /^[a-z0-9-]{1,80}$/, 20),
    preferredCategory: choices(
      "preferredCategory",
      [
        "any",
        "regular",
        "standard",
        "premium",
        "vip",
        "lounger",
        "couple",
        "wheelchair",
        "semi-recliner",
      ],
      "any",
    ),
    rowPreference: choices(
      "rowPreference",
      ["center", "front", "back"],
      "center",
    ),
    strategy: choices("strategy", ["best", "each_location"], "best"),
    keepTogether: v.keepTogether !== false,
    autoReserve: v.autoReserve !== false,
  };
}
