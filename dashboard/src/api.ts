import type { Snapshot } from "../../bot/src/contracts";
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
  const value = await response.json();
  if (!response.ok)
    throw new Error(value.error || "The bot could not complete this action.");
  return value;
}
export function subscribe(
  onSnapshot: (snapshot: Snapshot) => void,
  onConnection: (connected: boolean) => void,
) {
  const stream = new EventSource("/api/events");
  stream.addEventListener("snapshot", (event) => {
    onSnapshot(JSON.parse((event as MessageEvent).data));
    onConnection(true);
  });
  stream.onerror = () => onConnection(false);
  return () => stream.close();
}
