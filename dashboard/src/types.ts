import type {
  BotTask,
  Candidate,
  Handoff,
  Snapshot,
  TaskInput,
} from "../../bot/src/contracts";

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

export type ExtendedTaskInput = TaskInput & {
  targetSeats?: string[];
  exactSeatsOnly?: boolean;
  refreshBrowserPage?: boolean;
  preferredHall?: string;
  preferredShowtime?: string;
};

export type ExtendedHandoff = Handoff & {
  retryable?: boolean;
  reason?: HandoffReason;
};

export type ExtendedCandidate = Omit<Candidate, "handoff"> & {
  handoff?: ExtendedHandoff;
};

export type ExtendedBotTask = Omit<BotTask, "input" | "results"> & {
  input: ExtendedTaskInput;
  results: ExtendedCandidate[];
  lastCheckLatencyMs?: number;
  pageRefreshCount?: number;
  lastPageRefreshAt?: string;
  pageRefreshState?: PageRefreshState;
  dropDetectedAt?: string;
  consecutiveErrors?: number;
  lastPageUrl?: string;
};

export type ExtendedSnapshot = Omit<Snapshot, "tasks"> & {
  tasks: ExtendedBotTask[];
};

export const SEAT_ROWS = [
  "A",
  "B",
  "C",
  "D",
  "E",
  "F",
  "G",
  "H",
  "I",
  "J",
  "K",
  "L",
  "M",
  "N",
  "O",
  "P",
] as const;

export const SEAT_COLUMNS = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
] as const;

export const SEAT_CATEGORY_OPTIONS: ReadonlyArray<{
  value: TaskInput["preferredCategory"];
  label: string;
}> = [
  { value: "any", label: "Any tier" },
  { value: "regular", label: "Regular" },
  { value: "standard", label: "Standard" },
  { value: "premium", label: "Premium" },
  { value: "vip", label: "VIP" },
  { value: "lounger", label: "Lounger" },
  { value: "couple", label: "Couple" },
  { value: "wheelchair", label: "Wheelchair" },
  { value: "semi-recliner", label: "Semi-Recliner" },
];

export function normalizeSeatLabel(raw: string): string | null {
  const cleaned = raw.trim().toUpperCase().replace(/[\s_-]+/g, "");
  const match = /^([A-Z]{1,3})0*([1-9]\d{0,2})$/.exec(cleaned);
  if (!match) return null;
  return `${match[1]}${match[2]}`;
}

export function parseTargetSeatsInput(raw: string): string[] {
  const tokens = raw
    .split(/[\s,;]+/)
    .map((part) => normalizeSeatLabel(part))
    .filter((label): label is string => label !== null);
  return [...new Set(tokens)].slice(0, 50);
}

export function toLocalDateTimeInput(isoOrDate: string | Date): string {
  const date = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  if (!Number.isFinite(date.getTime())) return "";
  const copy = new Date(date.getTime());
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
  return copy.toISOString().slice(0, 16);
}

export function parseLocalDateTimeInput(value: string): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = new Date(trimmed);
  if (!Number.isFinite(parsed.getTime())) return undefined;
  return parsed.toISOString();
}
