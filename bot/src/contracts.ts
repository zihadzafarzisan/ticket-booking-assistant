import {
  normalizeSeatLabel,
  type RankedResult,
  type SeatCategory,
  type TimeSlot,
} from "../../packages/core/src";

export { normalizeSeatLabel };

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
export type PageRefreshState =
  | "idle"
  | "warming"
  | "refreshing"
  | "drop_detected"
  | "selecting"
  | "handoff"
  | "error";
export type HandoffReason =
  | "exact_seats_unavailable"
  | "seat_stolen_mid_click"
  | "login_required"
  | "captcha_required"
  | "checkout_blocked"
  | "seat_map_not_ready";
export interface PageRefreshResult {
  refreshedAt: string;
  latencyMs: number;
  url: string;
  pageReady: boolean;
  dropDetected: boolean;
  availableSeatCount: number;
  availableTargetSeats: string[];
  warning?: string;
  requiresUserAttention?: boolean;
}
export interface TaskInput {
  targetMovieId?: string;
  openPaymentGateway?: boolean;
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
  targetSeats?: string[];
  exactSeatsOnly?: boolean;
  refreshBrowserPage?: boolean;
  preferredHall?: string;
  preferredShowtime?: string;
}
export interface Handoff {
  status: "awaiting_user" | "awaiting_payment";
  message: string;
  url: string;
  selectedSeats: string[];
  retryable?: boolean;
  reason?: HandoffReason;
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
  lastCheckLatencyMs?: number;
  nextCheckAt?: string;
  pageRefreshCount?: number;
  lastPageRefreshAt?: string;
  pageRefreshState?: PageRefreshState;
  dropDetectedAt?: string;
  consecutiveErrors?: number;
  lastPageUrl?: string;
  error?: string;
  waitReason?: { title: string; message: string };
  results: Candidate[];
  logs: Activity[];
}
export type TaskRecord = BotTask;
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
  seq?: number;
}

export function validateTask(value: unknown): TaskInput {
  const v = value as Record<string, unknown>;
  if (!v || typeof v !== "object")
    throw new Error("A task configuration is required.");
  const text = (key: string) =>
    typeof v[key] === "string" ? (v[key] as string).trim() : "";
  const movieName = text("movieName");
  const targetMovieId = text("targetMovieId") || undefined;
  if (targetMovieId && !/^[a-zA-Z0-9-]{1,100}$/.test(targetMovieId))
    throw new Error("Invalid selected movie.");
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
  const targetSeats: string[] = [];
  if (v.targetSeats !== undefined) {
    if (!Array.isArray(v.targetSeats) || v.targetSeats.length > 50)
      throw new Error("Invalid targetSeats.");
    const seen = new Set<string>();
    for (const raw of v.targetSeats) {
      if (typeof raw !== "string")
        throw new Error("Invalid targetSeats.");
      const normalized = normalizeSeatLabel(raw);
      if (!normalized)
        throw new Error(`Invalid seat label "${raw.trim() || raw}". Use labels like E5 or E6.`);
      if (!seen.has(normalized)) {
        seen.add(normalized);
        targetSeats.push(normalized);
      }
    }
  }
  const requiredSeats =
    v.requiredSeats === undefined && targetSeats.length > 0
      ? targetSeats.length
      : Number(v.requiredSeats);
  if (
    !Number.isInteger(requiredSeats) ||
    requiredSeats < 1 ||
    requiredSeats > 50
  )
    throw new Error("Choose between 1 and 50 seats.");
  const intervalSeconds =
    v.intervalSeconds === undefined ? 1 : Number(v.intervalSeconds);
  if (
    !Number.isFinite(intervalSeconds) ||
    intervalSeconds < 1 ||
    intervalSeconds > 300
  )
    throw new Error("Polling interval must be between 1 and 300 seconds.");
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
  for (const key of [
    "keepTogether",
    "autoReserve",
    "openPaymentGateway",
    "exactSeatsOnly",
    "refreshBrowserPage",
  ])
    if (v[key] !== undefined && typeof v[key] !== "boolean")
      throw new Error(`Invalid ${key}.`);
  const exactSeatsOnly = v.exactSeatsOnly === true;
  if (exactSeatsOnly && targetSeats.length === 0)
    throw new Error("Exact seats only requires at least one target seat.");
  if (exactSeatsOnly && targetSeats.length < requiredSeats)
    throw new Error(
      "Select at least as many exact seats as your seat count when exact seats only is enabled.",
    );
  const preferredHall = text("preferredHall") || undefined;
  if (preferredHall && preferredHall.length > 100)
    throw new Error("Invalid preferredHall.");
  const preferredShowtime = text("preferredShowtime") || undefined;
  if (
    preferredShowtime &&
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(preferredShowtime)
  )
    throw new Error("Preferred showtime must be in HH:MM 24-hour format.");
  const mode = choices("mode", ["instant", "monitor"], "instant");
  const source = choices("source", ["live", "demo"], "live");
  const refreshBrowserPage =
    v.refreshBrowserPage === undefined
      ? mode === "monitor" && source === "live"
      : v.refreshBrowserPage === true;
  return {
    targetMovieId,
    openPaymentGateway: v.openPaymentGateway === true,
    targetShowId,
    movieName,
    targetDate,
    requiredSeats,
    intervalSeconds,
    scheduledAt,
    mode,
    source,
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
    ...(targetSeats.length ? { targetSeats } : {}),
    exactSeatsOnly,
    refreshBrowserPage,
    ...(preferredHall ? { preferredHall } : {}),
    ...(preferredShowtime ? { preferredShowtime } : {}),
  };
}
