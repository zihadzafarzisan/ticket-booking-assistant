import { afterEach, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { once } from "node:events";
import { CredentialStore, type SecretProtector } from "./credentials";
import {
  BrowserConnection,
  validateBrowserEndpoint,
} from "./browser-connection";
import { createBotServer } from "./server";
import type { BotRunner } from "./runner";

const roots: string[] = [];
async function directory() {
  await mkdir(".bot-test-data", { recursive: true });
  const path = await mkdtemp(resolve(".bot-test-data", "credentials-"));
  roots.push(path);
  return path;
}
afterEach(async () => {
  for (const path of roots.splice(0)) {
    if (!path.startsWith(resolve(".bot-test-data") + sep))
      throw new Error("Unexpected test cleanup path.");
    await rm(path, { recursive: true, force: true });
  }
});
const fixture = {
  email: "fixture@example.com",
  password: "fixture-password-123",
};
it("keeps session credentials out of status and disk, replaces them and clears them", async () => {
  const filename = resolve(await directory(), "credentials.json");
  const store = new CredentialStore(filename);
  await store.init();
  expect(store.get()).toBeUndefined();
  expect(await store.save(fixture)).toMatchObject({
    configured: true,
    email: fixture.email,
    remembered: false,
  });
  expect(JSON.stringify(store.status())).not.toContain(fixture.password);
  await expect(readFile(filename)).rejects.toMatchObject({ code: "ENOENT" });
  const copy = store.get()!;
  copy.password = "changed";
  expect(store.get()?.password).toBe(fixture.password);
  await store.save({ ...fixture, password: "replacement" });
  expect(store.get()?.password).toBe("replacement");
  await store.clear();
  expect(store.get()).toBeUndefined();
});
it("restores only protected credentials and rejects invalid settings", async () => {
  const filename = resolve(await directory(), "credentials.json");
  const secrets = new Map<string, string>();
  const protector: SecretProtector = {
    protect: async (value) => {
      secrets.set("opaque-fixture", value);
      return "opaque-fixture";
    },
    unprotect: async (value) => secrets.get(value)!,
  };
  const store = new CredentialStore(filename, protector);
  await store.save({ ...fixture, remember: true });
  expect(await readFile(filename, "utf8")).not.toContain(fixture.password);
  const restored = new CredentialStore(filename, protector);
  await restored.init();
  expect(restored.get()).toEqual(fixture);
  expect(restored.status().remembered).toBe(true);
  await expect(
    restored.save({ email: "invalid", password: "x" }),
  ).rejects.toThrow("valid Cineplex email");
  await expect(
    restored.save({ email: fixture.email, password: "" }),
  ).rejects.toThrow("password");
  await restored.save(fixture);
  await expect(readFile(filename)).rejects.toMatchObject({ code: "ENOENT" });
});
it.skipIf(process.platform !== "win32")(
  "round trips remembered credentials through Windows DPAPI",
  async () => {
    const filename = resolve(await directory(), "credentials.json");
    const store = new CredentialStore(filename);
    await store.save({ ...fixture, remember: true });
    const encrypted = await readFile(filename, "utf8");
    expect(encrypted).not.toContain(fixture.email);
    expect(encrypted).not.toContain(fixture.password);
    const restored = new CredentialStore(filename);
    await restored.init();
    expect(restored.get()).toEqual(fixture);
    await restored.clear();
    expect(restored.status().configured).toBe(false);
  },
);
it("restricts browser control to local HTTP endpoints", () => {
  expect(validateBrowserEndpoint("http://127.0.0.1:9222/")).toBe(
    "http://127.0.0.1:9222",
  );
  for (const endpoint of [
    "https://127.0.0.1:9222",
    "http://example.com:9222",
    "http://user:pass@localhost:9222",
    "http://127.0.0.1:9222/path",
    "http://127.0.0.1:9222?x=1",
    "file:///tmp/a",
  ])
    expect(() => validateBrowserEndpoint(endpoint)).toThrow();
});
it("accepts credentials only through protected POST and never returns passwords in API state", async () => {
  const path = await directory();
  const credentials = new CredentialStore(resolve(path, "credentials.json"));
  const connection = new BrowserConnection(path);
  const runner = {
    snapshot: () => ({
      tasks: [],
      browser: { connected: false },
      version: "fixture",
    }),
  } as unknown as BotRunner;
  const { server } = createBotServer(runner, {
    credentials,
    browserConnection: connection,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No test address");
  const url = `http://127.0.0.1:${address.port}`;
  const post = (path: string, headers: Record<string, string> = {}) =>
    fetch(url + path, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(fixture),
    });
  try {
    expect((await post("/api/settings/credentials")).status).toBe(403);
    expect(
      (
        await post("/api/settings/credentials", {
          "x-ticket-bot": "dashboard",
          origin: "https://foreign.example",
        })
      ).status,
    ).toBe(403);
    expect(credentials.status().configured).toBe(false);
    const saved = await post("/api/settings/credentials", {
      "x-ticket-bot": "dashboard",
    });
    expect(saved.status).toBe(200);
    expect(await saved.json()).toMatchObject({
      configured: true,
      email: fixture.email,
    });
    for (const route of ["/api/settings", "/api/state"])
      expect(await (await fetch(url + route)).text()).not.toContain(
        fixture.password,
      );
    const cleared = await post("/api/settings/credentials/clear", {
      "x-ticket-bot": "dashboard",
    });
    expect((await cleared.json()).configured).toBe(false);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
});

it("serves browser settings and routes connect/open to the regular-browser integration", async () => {
  const path = await directory();
  const credentials = new CredentialStore(resolve(path, "credentials.json"));
  const connection = new BrowserConnection(path);
  const launch = vi
    .spyOn(connection, "openRegular")
    .mockResolvedValue({} as never);
  const browser = {
    close: vi.fn(async () => {}),
    openSession: vi.fn(async (_connectOnly?: boolean) => {}),
    status: () => ({
      connected: true,
      pages: 1,
      headless: false,
      mode: "regular",
    }),
  };
  let mockTasks: Array<{
    status: string;
    input?: { refreshBrowserPage?: boolean };
  }> = [];
  const runner = {
    browser,
    snapshot: () => ({ tasks: mockTasks }),
  } as unknown as BotRunner;
  const { server } = createBotServer(runner, {
    credentials,
    browserConnection: connection,
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No test address");
  const url = `http://127.0.0.1:${address.port}`;
  const post = (path: string, input = {}) =>
    fetch(url + path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-ticket-bot": "dashboard",
      },
      body: JSON.stringify(input),
    });
  try {
    expect(
      (
        await post("/api/settings/browser", {
          endpoint: "http://external.example:9222",
        })
      ).status,
    ).toBe(400);
    expect(browser.close).not.toHaveBeenCalled();
    mockTasks = [{ status: "selecting" }];
    expect(
      (
        await post("/api/settings/browser", {
          endpoint: "http://127.0.0.1:9222",
        })
      ).status,
    ).toBe(409);
    // B4: active monitoring task with refreshBrowserPage enabled must also block browser disconnect
    mockTasks = [{ status: "monitoring", input: { refreshBrowserPage: true } }];
    expect(
      (
        await post("/api/settings/browser", {
          endpoint: "http://127.0.0.1:9222",
        })
      ).status,
    ).toBe(409);
    expect(browser.close).not.toHaveBeenCalled();
    // Monitoring without browser refresh does not hold an active browser page
    mockTasks = [
      { status: "monitoring", input: { refreshBrowserPage: false } },
    ];
    const saved = await post("/api/settings/browser", {
      endpoint: "http://127.0.0.1:9333",
    });
    expect(saved.status).toBe(200);
    expect((await saved.json()).endpoint).toBe("http://127.0.0.1:9333");
    expect(browser.close).toHaveBeenCalledOnce();
    expect((await post("/api/browser/connect")).status).toBe(200);
    expect(browser.openSession).toHaveBeenLastCalledWith(true);
    expect(launch).not.toHaveBeenCalled();
    const opened = await post("/api/browser/open");
    expect(opened.status).toBe(200);
    expect((await opened.json()).mode).toBe("regular");
    expect(browser.openSession).toHaveBeenLastCalledWith(false);
    expect(launch).toHaveBeenCalledOnce();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
  }
});
