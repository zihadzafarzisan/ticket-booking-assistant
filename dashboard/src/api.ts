import type { LiveInventory } from "../../bot/src/live-types";
import type { ExtendedSnapshot } from "./types";

export async function api<T = unknown>(
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(
    `/api${path}`,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Ticket-Bot": "dashboard",
          },
          body: JSON.stringify(body),
        },
  );
  const contentType = response.headers.get("content-type") || "";
  const isJson = contentType.includes("application/json");
  let parsed: unknown;
  if (isJson) {
    try {
      parsed = await response.json();
    } catch {
      parsed = undefined;
    }
  } else {
    const text = await response.text().catch(() => "");
    if (!response.ok) {
      throw new Error(
        text.trim().slice(0, 240) ||
          `Request failed (${response.status} ${response.statusText || "Error"}).`,
      );
    }
    return text as unknown as T;
  }
  if (!response.ok) {
    const message =
      parsed &&
      typeof parsed === "object" &&
      "error" in parsed &&
      typeof (parsed as { error?: unknown }).error === "string"
        ? (parsed as { error: string }).error
        : `Request failed (${response.status} ${response.statusText || "Error"}).`;
    throw new Error(message || "The bot could not complete this action.");
  }
  return parsed as T;
}

export function subscribe(
  onSnapshot: (snapshot: ExtendedSnapshot) => void,
  onConnection: (connected: boolean) => void,
  onInventory?: (inventory: LiveInventory) => void,
) {
  const stream = new EventSource("/api/events");
  stream.addEventListener("snapshot", (event) => {
    onSnapshot(JSON.parse((event as MessageEvent).data) as ExtendedSnapshot);
    onConnection(true);
  });
  stream.onerror = () => onConnection(false);
  stream.addEventListener("inventory", (event) => {
    onInventory?.(JSON.parse((event as MessageEvent).data) as LiveInventory);
  });
  return () => stream.close();
}
