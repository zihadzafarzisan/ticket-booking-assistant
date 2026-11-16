import { test, expect, chromium } from "@playwright/test";
import { createServer } from "node:net";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { BrowserConnection } from "../../bot/src/browser-connection";
import { BrowserDriver } from "../../bot/src/browser";

test("attaches to an open regular browser, reuses its session and leaves tabs open on disconnect", async () => {
  await mkdir(".bot-test-data", { recursive: true });
  const root = await mkdtemp(resolve(".bot-test-data", "cdp-"));
  const socket = createServer();
  await new Promise<void>((done) => socket.listen(0, "127.0.0.1", done));
  const address = socket.address();
  if (!address || typeof address === "string") throw new Error("Missing port");
  const port = address.port;
  await new Promise<void>((done) => socket.close(() => done()));
  const owner = await chromium.launchPersistentContext(
    resolve(root, "profile"),
    {
      headless: true,
      args: [
        `--remote-debugging-port=${port}`,
        "--remote-debugging-address=127.0.0.1",
      ],
    },
  );
  const connection = new BrowserConnection(root);
  const driver = new BrowserDriver(resolve(root, "unused"), true, {
    connection,
  });
  try {
    const original = owner.pages()[0];
    await original.setContent(
      "<title>Existing browser tab</title><p>Keep this tab</p>",
    );
    await owner.addCookies([
      {
        name: "fixture-session",
        value: "already-logged-in",
        domain: "kichole.com",
        path: "/",
        secure: true,
      },
    ]);
    await connection.configure({ endpoint: `http://127.0.0.1:${port}` });
    const attached = await connection.connect();
    await attached.route("https://kichole.com/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: "<h1>Cinema fixture</h1>",
      }),
    );
    await driver.openSession();
    const cinema = attached
      .pages()
      .find((page) => page.url().startsWith("https://kichole.com"))!;
    expect(cinema).toBeDefined();
    expect(await attached.cookies("https://kichole.com")).toContainEqual(
      expect.objectContaining({
        name: "fixture-session",
        value: "already-logged-in",
      }),
    );
    const count = attached.pages().length;
    await driver.openSession();
    expect(attached.pages()).toHaveLength(count);
    const session = await attached.browser()!.newBrowserCDPSession();
    expect(
      (await session.send("Target.getBrowserContexts")).browserContextIds,
    ).toEqual([]);
    await session.detach();
    await driver.close();
    expect(await original.title()).toBe("Existing browser tab");
    expect(
      owner
        .pages()
        .some((page) => page.url().startsWith("https://kichole.com")),
    ).toBe(true);
    const reconnected = await connection.connect();
    expect(reconnected.pages()).toHaveLength(count);
  } finally {
    await driver.close();
    await connection.disconnect();
    await owner.close();
    if (!root.startsWith(resolve(".bot-test-data") + sep))
      throw new Error("Unexpected cleanup path");
    await rm(root, { recursive: true, force: true });
  }
});

test("opens one regular persistent browser when no attachable browser is running", async () => {
  await mkdir(".bot-test-data", { recursive: true });
  const root = await mkdtemp(resolve(".bot-test-data", "regular-"));
  const socket = createServer();
  await new Promise<void>((done) => socket.listen(0, "127.0.0.1", done));
  const address = socket.address();
  if (!address || typeof address === "string") throw new Error("Missing port");
  const port = address.port;
  await new Promise<void>((done) => socket.close(() => done()));
  const connection = new BrowserConnection(root, {
    executablePath: chromium.executablePath(),
    headless: true,
  });
  let context;
  try {
    await connection.configure({ endpoint: `http://127.0.0.1:${port}` });
    await expect(connection.connect()).rejects.toThrow("Cannot connect");
    context = await connection.openRegular();
    await context.addCookies([
      {
        name: "persistent-fixture",
        value: "saved",
        domain: "kichole.com",
        path: "/",
        secure: true,
      },
    ]);
    const firstBrowser = context.browser();
    expect((await connection.openRegular()).browser()).toBe(firstBrowser);
    await connection.disconnect();
    context = await connection.connect();
    expect(await context.cookies("https://kichole.com")).toContainEqual(
      expect.objectContaining({ name: "persistent-fixture", value: "saved" }),
    );
    const session = await context.browser()!.newBrowserCDPSession();
    expect(
      (await session.send("Target.getBrowserContexts")).browserContextIds,
    ).toEqual([]);
    await session.send("Browser.close");
    await new Promise((done) => setTimeout(done, 400));
  } finally {
    if (context?.browser()?.isConnected()) {
      const session = await context.browser()!.newBrowserCDPSession();
      await session.send("Browser.close").catch(() => {});
    }
    await connection.disconnect();
    if (!root.startsWith(resolve(".bot-test-data") + sep))
      throw new Error("Unexpected cleanup path");
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  }
});
