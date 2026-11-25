import type {
  BotTask,
  Candidate,
  Handoff,
  HandoffReason,
  PageRefreshResult,
  PageRefreshState,
  Snapshot,
  TaskInput,
  TaskRecord,
} from "../../bot/src/contracts";

export type {
  BotTask,
  Candidate,
  Handoff,
  HandoffReason,
  PageRefreshResult,
  PageRefreshState,
  Snapshot,
  TaskInput,
  TaskRecord,
};

export type ExtendedTaskInput = TaskInput;
export type ExtendedHandoff = Handoff;
export type ExtendedCandidate = Candidate;
export type ExtendedBotTask = BotTask;
export type ExtendedSnapshot = Snapshot;

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
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
] as const;

export const SEAT_PICKER_COLS = SEAT_COLUMNS;

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
  if (typeof raw !== "string") return null;
  const match = /^([A-Z]{1,3})[\s_-]*0*([1-9]\d{0,2})$/.exec(
    raw.trim().toUpperCase(),
  );
  if (!match) return null;
  return `${match[1]}${match[2]}`;
}

export function parseTargetSeatsInput(raw: string): string[] {
  const tokens: string[] = [];
  for (const segment of raw.split(/[,;\n]+/)) {
    const trimmed = segment.trim();
    if (!trimmed) continue;
    const whole = normalizeSeatLabel(trimmed);
    if (whole) {
      tokens.push(whole);
      continue;
    }
    for (const part of trimmed.split(/\s+/)) {
      const normalized = normalizeSeatLabel(part);
      if (normalized) tokens.push(normalized);
    }
  }
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
