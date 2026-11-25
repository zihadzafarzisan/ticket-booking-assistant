import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { readFile, stat } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import type { BotRunner } from "./runner";
import type { LiveInventoryService } from "./live-inventory";
import type { CredentialStore } from "./credentials";
import {
  validateBrowserEndpoint,
  type BrowserConnection,
} from "./browser-connection";
import {
  STAR_CINEPLEX_LOCATIONS,
  TIME_SLOT_CONFIG,
} from "../../packages/core/src";

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
async function body(req: IncomingMessage) {
  if (!req.headers["content-type"]?.includes("application/json"))
    throw new HttpError(415, "Send JSON requests.");
  let value = "";
  for await (const chunk of req) {
    value += chunk;
    if (Buffer.byteLength(value) > 32_768)
      throw new HttpError(413, "Request is too large.");
  }
  try {
    return JSON.parse(value || "{}");
  } catch {
    throw new HttpError(400, "Invalid JSON.");
  }
}
function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(value));
}
export interface ServerOptions {
  credentials?: CredentialStore;
  browserConnection?: BrowserConnection;
  inventory?: LiveInventoryService;
  staticDirectory?: string;
  devHandler?: (req: IncomingMessage, res: ServerResponse) => void;
}
export function createBotServer(
  runner: BotRunner,
  options: ServerOptions = {},
) {
  const connections = new Set<ServerResponse>();
  const server = createServer(async (req, res) => {
    try {
      const host = req.headers.host || "";
      if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host))
        throw new HttpError(403, "This bot accepts local requests only.");
      if (req.headers.origin && req.headers.origin !== `http://${host}`)
        throw new HttpError(403, "Cross-origin requests are not allowed.");
      const url = new URL(req.url || "/", `http://${host}`);
      const route = url.pathname;
      if (route.startsWith("/api/")) {
        if (req.method === "GET" && route === "/api/health") {
          json(res, 200, { ok: true, service: "movie-ticket-bot" });
          return;
        }
        if (req.method === "GET" && route === "/api/config") {
          json(res, 200, {
            locations: STAR_CINEPLEX_LOCATIONS,
            timeSlots: TIME_SLOT_CONFIG,
          });
          return;
        }
        if (req.method === "GET" && route === "/api/settings") {
          if (!options.credentials || !options.browserConnection)
            throw new HttpError(503, "Browser settings are unavailable.");
          json(res, 200, {
            browser: options.browserConnection.settings(),
            credentials: options.credentials.status(),
          });
          return;
        }
        if (req.method === "GET" && route === "/api/state") {
          json(res, 200, runner.snapshot());
          return;
        }
        if (req.method === "GET" && route === "/api/live") {
          if (!options.inventory)
            throw new HttpError(
              503,
              "The live inventory service is unavailable.",
            );
          json(res, 200, options.inventory.snapshot());
          return;
        }
        if (req.method === "GET" && route === "/api/events") {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
            "X-Content-Type-Options": "nosniff",
          });
          connections.add(res);
          const send = () => {
            if (!res.destroyed)
              res.write(
                `event: snapshot\ndata: ${JSON.stringify(runner.snapshot())}\n\n`,
              );
          };
          const unsubscribe = runner.subscribe(send);
          const sendInventory = () => {
            if (options.inventory && !res.destroyed)
              res.write(
                `event: inventory\ndata: ${JSON.stringify(options.inventory.snapshot())}\n\n`,
              );
          };
          const unsubscribeInventory =
            options.inventory?.subscribe(sendInventory);
          send();
          sendInventory();
          const keepalive = setInterval(() => {
            if (!res.destroyed) res.write(": keepalive\n\n");
          }, 15_000);
          res.on("close", () => {
            clearInterval(keepalive);
            unsubscribe();
            unsubscribeInventory?.();
            connections.delete(res);
          });
          return;
        }
        if (req.method === "POST") {
          if (req.headers["x-ticket-bot"] !== "dashboard")
            throw new HttpError(403, "A dashboard request header is required.");
          const input = await body(req);
          if (
            route === "/api/settings/credentials" ||
            route === "/api/settings/credentials/clear"
          ) {
            if (!options.credentials)
              throw new HttpError(503, "Credential storage is unavailable.");
            json(
              res,
              200,
              route.endsWith("/clear")
                ? await options.credentials.clear()
                : await options.credentials.save(input),
            );
            return;
          }
          if (route === "/api/settings/browser") {
            if (!options.browserConnection)
              throw new HttpError(503, "Browser settings are unavailable.");
            if (
              runner
                .snapshot()
                .tasks.some((task) =>
                  ["scanning", "selecting"].includes(task.status),
                )
            )
              throw new HttpError(
                409,
                "Stop active seat searches before changing the browser connection.",
              );
            // Validate before disconnecting a working session.
            validateBrowserEndpoint(input.endpoint);
            await runner.browser.close();
            runner.notifyBrowserChange?.();
            json(res, 200, await options.browserConnection.configure(input));
            return;
          }
          if (route === "/api/live/refresh") {
            if (!options.inventory)
              throw new HttpError(
                503,
                "The live inventory service is unavailable.",
              );
            void options.inventory.refresh().catch(() => {});
            json(res, 202, { ok: true });
            return;
          }
          if (route === "/api/tasks") {
            json(res, 201, await runner.create(input));
            return;
          }
          if (
            route === "/api/browser/open" ||
            route === "/api/browser/connect"
          ) {
            if (route === "/api/browser/open" && options.browserConnection)
              await options.browserConnection.openRegular();
            await runner.browser.openSession(route === "/api/browser/connect");
            runner.notifyBrowserChange?.();
            json(res, 200, runner.browser.status());
            return;
          }
          const match = route.match(
            /^\/api\/tasks\/([a-f0-9-]+)\/(stop|resume|check|reserve|complete|remove|focus|update)$/,
          );
          if (match) {
            const [, id, action] = match;
            runner.get(id);
            if (action === "update") {
              json(res, 200, await runner.update(id, input));
              return;
            }
            if (action === "check") {
              void runner.check(id);
              json(res, 202, { ok: true });
              return;
            }
            if (action === "stop") {
              await runner.stop(id);
            }
            if (action === "resume") {
              await runner.resume(id);
            }
            if (action === "complete") {
              await runner.complete(id);
            }
            if (action === "remove") {
              await runner.remove(id);
            }
            if (action === "focus") {
              await runner.focus(id, input.key);
            }
            if (action === "reserve") {
              const task = runner.get(id);
              if (
                task.input.source === "demo" ||
                task.status === "stopped" ||
                task.status === "completed" ||
                task.status === "selecting" ||
                task.status === "scanning"
              )
                throw new HttpError(
                  409,
                  "This task cannot start a reservation right now.",
                );
              if (input.key && !task.results.some((r) => r.key === input.key))
                throw new HttpError(404, "Seat option not found.");
              void runner
                .reserve(id, input.key)
                .catch((error) => console.error("Reservation:", error));
              json(res, 202, { ok: true });
              return;
            }
            json(res, 200, { ok: true });
            return;
          }
        }
        throw new HttpError(404, "API route not found.");
      }
      if (options.devHandler) {
        options.devHandler(req, res);
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD")
        throw new HttpError(405, "Method not allowed.");
      const root = resolve(options.staticDirectory || "dashboard/dist");
      const pathname = decodeURIComponent(route);
      let file = resolve(root, `.${pathname}`);
      if (file !== root && !file.startsWith(root + sep))
        throw new HttpError(403, "Invalid path.");
      try {
        if (!(await stat(file)).isFile()) file = resolve(root, "index.html");
      } catch {
        file = resolve(root, "index.html");
      }
      const content = await readFile(file);
      const mime: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".svg": "image/svg+xml",
        ".png": "image/png",
        ".ico": "image/x-icon",
      };
      res.writeHead(200, {
        "Content-Type": mime[extname(file)] || "application/octet-stream",
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "same-origin",
      });
      res.end(req.method === "HEAD" ? undefined : content);
    } catch (error) {
      const status =
        error instanceof HttpError
          ? error.status
          : (error as Error).message === "Task not found."
            ? 404
            : 400;
      if (!res.headersSent)
        json(res, status, { error: (error as Error).message });
      else res.end();
    }
  });
  server.on("close", () => {
    for (const res of connections) res.end();
  });
  return {
    server,
    closeEvents: () => {
      for (const res of connections) res.end();
      connections.clear();
    },
  };
}
