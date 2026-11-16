import { test, expect, chromium } from "@playwright/test";
import { createServer, connect, type Socket } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { BrowserConnection } from "../../bot/src/browser-connection";
import { BrowserDriver } from "../../bot/src/browser";

test("connects once through Chrome-style 404 discovery and a delayed approval handshake", async () => {
  await mkdir(".bot-test-data", { recursive: true });
  const root = await mkdtemp(resolve(".bot-test-data", "approval-cdp-"));
  const portProbe = createServer();
  await new Promise<void>((done) => portProbe.listen(0, "127.0.0.1", done));
  const portAddress = portProbe.address();
  if (!portAddress || typeof portAddress === "string")
    throw new Error("Missing port");
  const upstreamPort = portAddress.port;
  await new Promise<void>((done) => portProbe.close(() => done()));
  const owner = await chromium.launchPersistentContext(
    resolve(root, "test-owner"),
    { headless: true, args: [`--remote-debugging-port=${upstreamPort}`] },
  );
  const sockets = new Set<Socket>();
  let connections = 0;
  const gateway = createHttpServer((_request, response) => {
    response.writeHead(404);
    response.end();
  });
  gateway.on("upgrade", (request, client, head) => {
    connections++;
    sockets.add(client);
    client.on("error", () => {});
    // Simulate Chrome waiting for the user to approve a single connection.
    setTimeout(() => {
      if (client.destroyed) return;
      const upstream = connect(upstreamPort, "127.0.0.1", () => {
        const headers = request.rawHeaders.reduce<string[]>(
          (values, value, index) =>
            index % 2
              ? values
              : [...values, `${value}: ${request.rawHeaders[index + 1]}`],
          [],
        );
        upstream.write(
          `GET ${request.url} HTTP/1.1\r\n${headers.join("\r\n")}\r\n\r\n`,
        );
        if (head.length) upstream.write(head);
        client.pipe(upstream);
        upstream.pipe(client);
      });
      sockets.add(upstream);
      upstream.on("error", () => client.destroy());
      client.on("close", () => upstream.destroy());
    }, 350);
  });
  await new Promise<void>((done) => gateway.listen(0, "127.0.0.1", done));
  const address = gateway.address();
  if (!address || typeof address === "string")
    throw new Error("Missing proxy port");
  const connection = new BrowserConnection(root, {
    executablePath: "must-not-launch.exe",
  });
  try {
    const version = await (
      await fetch(`http://127.0.0.1:${upstreamPort}/json/version`)
    ).json();
    await mkdir(resolve(root, "regular-browser"));
    await writeFile(
      resolve(root, "regular-browser", "DevToolsActivePort"),
      `${address.port}\n${new URL(version.webSocketDebuggerUrl).pathname}\n`,
    );
    await connection.configure({
      endpoint: `http://127.0.0.1:${address.port}`,
    });
    const [first, second] = await Promise.all([
      connection.openRegular(),
      connection.openRegular(),
    ]);
    expect(first).toBe(second);
    expect(connections).toBe(1);
    const page = await first.newPage();
    await page.setContent("<title>Approval connection works</title>");
    expect(await page.title()).toBe("Approval connection works");
    await connection.disconnect();
    expect(owner.pages().some((item) => item.url() === "about:blank")).toBe(
      true,
    );
  } finally {
    await connection.disconnect();
    for (const socket of sockets) socket.destroy();
    gateway.closeAllConnections();
    await new Promise<void>((done) => gateway.close(() => done()));
    await owner.close();
    if (!root.startsWith(resolve(".bot-test-data") + sep))
      throw new Error("Unexpected cleanup path");
    await rm(root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    });
  }
});

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
