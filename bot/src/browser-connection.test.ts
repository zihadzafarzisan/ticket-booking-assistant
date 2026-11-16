import { afterEach, expect, it, vi } from "vitest";
import { chromium, type Browser, type BrowserContext } from "playwright";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import {
  BrowserConnection,
  validateBrowserEndpoint,
} from "./browser-connection";

const roots: string[] = [];
async function directory() {
  await mkdir(".bot-test-data", { recursive: true });
  const path = await mkdtemp(resolve(".bot-test-data", "approval-"));
  roots.push(path);
  return path;
}
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const path of roots.splice(0)) {
    if (!path.startsWith(resolve(".bot-test-data") + sep))
      throw new Error("Unexpected cleanup path");
    await rm(path, { recursive: true, force: true });
  }
});
it("uses the active-port WebSocket when Chrome's approval server returns HTTP 404", async () => {
  const root = await directory();
  await mkdir(resolve(root, "regular-browser"));
  await writeFile(
    resolve(root, "regular-browser", "DevToolsActivePort"),
    "9333\n/devtools/browser/approval-fixture\n",
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 404 })),
  );
  const context = {} as BrowserContext;
  const attach = vi.spyOn(chromium, "connectOverCDP").mockResolvedValue({
    contexts: () => [context],
    isConnected: () => true,
  } as unknown as Browser);
  const connection = new BrowserConnection(root, {
    executablePath: "must-not-launch.exe",
  });
  await connection.configure({ endpoint: "http://127.0.0.1:9333" });
  expect(await connection.openRegular()).toBe(context);
  expect(attach).toHaveBeenCalledExactlyOnceWith(
    "ws://127.0.0.1:9333/devtools/browser/approval-fixture",
    expect.objectContaining({ timeout: 120_000 }),
  );
});
it("does not launch another browser or repeatedly prompt when Chrome approval is declined", async () => {
  const root = await directory();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 404 })),
  );
  const attach = vi
    .spyOn(chromium, "connectOverCDP")
    .mockRejectedValue(new Error("WebSocket approval timed out"));
  const connection = new BrowserConnection(root, {
    executablePath: "must-not-launch.exe",
  });
  await connection.configure({ endpoint: "http://127.0.0.1:9333" });
  await expect(connection.openRegular()).rejects.toThrow("Allow");
  expect(attach).toHaveBeenCalledOnce();
});
it("reports an occupied non-browser port instead of launching into it", async () => {
  const root = await directory();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("another service", { status: 200 })),
  );
  const connection = new BrowserConnection(root, {
    executablePath: "must-not-launch.exe",
  });
  await expect(connection.openRegular()).rejects.toThrow("another service");
});
it("accepts explicit local browser WebSockets and rejects remote or unrelated paths", () => {
  expect(
    validateBrowserEndpoint("ws://127.0.0.1:9222/devtools/browser/fixture"),
  ).toBe("ws://127.0.0.1:9222/devtools/browser/fixture");
  for (const value of [
    "ws://external.example:9222/devtools/browser/fixture",
    "ws://127.0.0.1:9222/unrelated",
    "ws://user:pass@127.0.0.1:9222/devtools/browser/fixture",
    "ws://127.0.0.1:9222/devtools/browser/fixture?token=x",
  ])
    expect(() => validateBrowserEndpoint(value)).toThrow();
});
