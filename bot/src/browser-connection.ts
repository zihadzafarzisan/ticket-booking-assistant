import { chromium, type Browser, type BrowserContext } from "playwright";
import { spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";

const browserPath = /^\/devtools\/browser(?:\/[a-zA-Z0-9-]+)?$/;
class BrowserUnavailableError extends Error {}

export function validateBrowserEndpoint(raw: unknown): string {
  let url: URL;
  try {
    url = new URL(String(raw));
  } catch {
    throw new Error(
      "Enter a local browser address such as http://127.0.0.1:9222.",
    );
  }
  if (
    !["http:", "ws:"].includes(url.protocol) ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    (url.protocol === "http:"
      ? url.pathname !== "/"
      : !browserPath.test(url.pathname)) ||
    url.search ||
    url.hash ||
    !url.port
  )
    throw new Error(
      "Use a loopback HTTP address or browser WebSocket with a port and no credentials. WebSocket paths must start with /devtools/browser.",
    );
  return url.protocol === "http:" ? url.origin : url.href;
}
export class BrowserConnection {
  private endpoint = "http://127.0.0.1:9222";
  private browser?: Browser;
  private pending?: Promise<BrowserContext>;
  private opening?: Promise<BrowserContext>;
  private disconnectListeners = new Set<() => void>();
  constructor(
    private directory: string,
    private launchOptions: { executablePath?: string; headless?: boolean } = {},
  ) {}
  onDisconnect(listener: () => void): () => void {
    this.disconnectListeners.add(listener);
    return () => {
      this.disconnectListeners.delete(listener);
    };
  }
  isConnected(): boolean {
    return !!this.browser?.isConnected();
  }
  private emitDisconnect() {
    for (const listener of this.disconnectListeners) {
      try {
        listener();
      } catch {
        /* ignore subscriber errors */
      }
    }
  }
  async init() {
    try {
      this.endpoint = validateBrowserEndpoint(
        JSON.parse(
          await readFile(resolve(this.directory, "browser.json"), "utf8"),
        ).endpoint,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  settings() {
    return { endpoint: this.endpoint };
  }
  async configure(value: unknown) {
    const endpoint = validateBrowserEndpoint(
      (value as { endpoint?: unknown })?.endpoint,
    );
    await mkdir(this.directory, { recursive: true });
    await writeFile(
      resolve(this.directory, "browser.json"),
      JSON.stringify({ endpoint }),
      { mode: 0o600 },
    );
    await this.disconnect();
    this.endpoint = endpoint;
    return this.settings();
  }
  private async attach(): Promise<BrowserContext> {
    if (this.browser?.isConnected()) {
      const existing = this.browser.contexts()[0];
      if (existing) return existing;
    }
    if (this.pending) return this.pending;
    const pending = this.attachOnce();
    this.pending = pending;
    try {
      return await pending;
    } finally {
      if (this.pending === pending) this.pending = undefined;
    }
  }
  private async attachOnce(): Promise<BrowserContext> {
    const endpoint = new URL(this.endpoint);
    let approval = endpoint.protocol === "ws:";
    let socket: URL;
    if (endpoint.protocol === "ws:") socket = endpoint;
    else {
      let version: Response;
      try {
        version = await fetch(`${this.endpoint}/json/version`, {
          signal: AbortSignal.timeout(2000),
          redirect: "error",
        });
      } catch (error) {
        const cause = (
          error as { cause?: { code?: string; errors?: { code?: string }[] } }
        ).cause;
        if (
          cause?.code === "ECONNREFUSED" ||
          (cause?.errors?.length &&
            cause.errors.every((item) => item.code === "ECONNREFUSED"))
        )
          throw new BrowserUnavailableError(
            "No browser is listening at this address.",
          );
        throw new Error(
          "The browser address did not respond. Check the address in Settings before retrying.",
        );
      }
      if (version.status === 404) {
        // Chrome 144+ approval-based debugging deliberately has no HTTP discovery.
        // Its existing profile publishes the browser path in DevToolsActivePort.
        approval = true;
        socket = new URL(
          (await this.activeSocket(endpoint)) ||
            `ws://${endpoint.host}/devtools/browser`,
        );
      } else {
        if (!version.ok)
          throw new Error(
            "The browser address is occupied by another service or debugging is unavailable. Check its port in Settings.",
          );
        try {
          const data = (await version.json()) as {
            webSocketDebuggerUrl?: string;
          };
          socket = new URL(data.webSocketDebuggerUrl || "");
        } catch {
          throw new Error(
            "The browser address is occupied by another service. Use the debugging address shown by Chrome or Edge.",
          );
        }
      }
    }
    if (
      socket.protocol !== "ws:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(socket.hostname) ||
      socket.username ||
      socket.password ||
      socket.port !== endpoint.port ||
      !browserPath.test(socket.pathname) ||
      socket.search ||
      socket.hash
    )
      throw new Error("The browser must expose a local debugging connection.");
    let browser: Browser;
    try {
      browser = await chromium.connectOverCDP(socket.href, {
        timeout: approval ? 120_000 : 5000,
      });
    } catch (error) {
      const reason = (error as Error).message
        .split("\n")[0]
        .replace(/wss?:\/\/\S+/g, "[local browser]");
      console.warn(`Browser connection failed: ${reason}`);
      throw new Error(
        approval
          ? "Chrome needs your approval. In your open Chrome window, choose Allow for remote debugging, then retry Connect existing browser. If no prompt appears, enable access at chrome://inspect/#remote-debugging and use the address shown there."
          : "The browser is running but its debugging connection failed. Check the address in Settings; no additional browser was opened.",
      );
    }
    const context = browser.contexts()[0];
    if (!context) {
      await browser.close();
      throw new Error("The browser has no regular session to connect to.");
    }
    this.browser = browser;
    browser.once?.("disconnected", () => {
      if (this.browser === browser) {
        this.browser = undefined;
        this.emitDisconnect();
      }
    });
    return context;
  }
  private async activeSocket(endpoint: URL): Promise<string | undefined> {
    const profiles = [resolve(this.directory, "regular-browser")];
    if (process.platform === "win32" && process.env.LOCALAPPDATA)
      profiles.push(
        resolve(process.env.LOCALAPPDATA, "Google/Chrome/User Data"),
        resolve(process.env.LOCALAPPDATA, "Microsoft/Edge/User Data"),
      );
    else if (process.platform === "darwin")
      profiles.push(
        resolve(homedir(), "Library/Application Support/Google/Chrome"),
        resolve(homedir(), "Library/Application Support/Microsoft Edge"),
      );
    else if (process.platform !== "win32") {
      const config =
        process.env.XDG_CONFIG_HOME || resolve(homedir(), ".config");
      profiles.push(
        resolve(config, "google-chrome"),
        resolve(config, "chromium"),
        resolve(config, "microsoft-edge"),
      );
    }
    for (const profile of profiles) {
      try {
        const [port, path] = (
          await readFile(resolve(profile, "DevToolsActivePort"), "utf8")
        )
          .split(/\r?\n/)
          .map((value) => value.trim());
        if (port === endpoint.port && browserPath.test(path || ""))
          return `ws://${endpoint.host}${path}`;
      } catch {
        /* A missing/inaccessible profile is not permission to read other profile data. */
      }
    }
  }
  async connect(): Promise<BrowserContext> {
    try {
      return await this.attach();
    } catch (error) {
      if (!(error instanceof BrowserUnavailableError)) throw error;
      throw new Error(
        "Cannot connect to your browser. In Settings, enable browser access or choose Open regular browser, then retry. Browsers need local debugging enabled before the bot can use their tabs.",
      );
    }
  }
  async openRegular(): Promise<BrowserContext> {
    if (this.opening) return this.opening;
    const opening = this.openRegularOnce();
    this.opening = opening;
    try {
      return await opening;
    } finally {
      if (this.opening === opening) this.opening = undefined;
    }
  }
  private async openRegularOnce(): Promise<BrowserContext> {
    try {
      return await this.attach();
    } catch (error) {
      if (!(error instanceof BrowserUnavailableError)) throw error;
    }
    if (new URL(this.endpoint).protocol !== "http:")
      throw new Error(
        "A browser WebSocket is for connecting to an existing browser. Use a local HTTP address to open a regular browser.",
      );
    const executable =
      this.launchOptions.executablePath || (await findBrowser());
    const profile = resolve(this.directory, "regular-browser");
    await mkdir(profile, { recursive: true });
    const args = [
      `--user-data-dir=${profile}`,
      `--remote-debugging-port=${new URL(this.endpoint).port}`,
      "--remote-debugging-address=127.0.0.1",
      "--no-first-run",
      "--no-default-browser-check",
      ...(this.launchOptions.headless
        ? ["--headless=new", "--no-sandbox"]
        : []),
      "about:blank",
    ];
    let child;
    if (process.platform === "win32" && !this.launchOptions.headless) {
      // Use `cmd.exe /c start` so Windows opens a real visible desktop window in <1s
      // even when Cinebot itself was launched from a hidden background process.
      const argLine = args
        .map((arg) => {
          if (!/\s/.test(arg)) return arg;
          const eq = arg.indexOf("=");
          if (eq > 0 && arg.startsWith("--"))
            return `${arg.slice(0, eq + 1)}"${arg.slice(eq + 1)}"`;
          return `"${arg}"`;
        })
        .join(" ");
      const cmdLine = `start "" "${executable}" ${argLine}`;
      child = spawn("cmd.exe", ["/d", "/s", "/c", `"${cmdLine}"`], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
        windowsVerbatimArguments: true,
      });
    } else {
      child = spawn(executable, args, {
        detached: true,
        stdio: "ignore",
        windowsHide: false,
      });
    }
    let launchError = false;
    let exitCode: number | null | undefined;
    child.once("error", () => {
      launchError = true;
    });
    if (process.platform !== "win32" || this.launchOptions.headless) {
      child.once("exit", (code) => {
        exitCode = code;
      });
    }
    child.unref();
    for (let attempt = 0; attempt < 40 && !launchError; attempt++) {
      try {
        return await this.attach();
      } catch (error) {
        if (!(error instanceof BrowserUnavailableError)) throw error;
      }
      if (exitCode !== undefined) break;
      await new Promise((done) => setTimeout(done, 250));
    }
    throw new Error(
      "The regular browser exited before debugging became available. Close only the cinema profile window and retry, or connect to your existing browser in Settings.",
    );
  }
  async disconnect() {
    // A CDP-attached Browser.close disconnects Playwright; it does not close Chrome.
    const browser = this.browser;
    this.browser = undefined;
    await browser?.close().catch(() => {});
    if (browser) this.emitDisconnect();
  }
}
async function findBrowser(): Promise<string> {
  const candidates =
    process.platform === "win32"
      ? [
          resolve(
            process.env.PROGRAMFILES || "C:/Program Files",
            "Google/Chrome/Application/chrome.exe",
          ),
          resolve(
            process.env["PROGRAMFILES(X86)"] || "C:/Program Files (x86)",
            "Microsoft/Edge/Application/msedge.exe",
          ),
          resolve(
            process.env.LOCALAPPDATA || "",
            "Google/Chrome/Application/chrome.exe",
          ),
        ]
      : process.platform === "darwin"
        ? [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
          ]
        : [
            "/usr/bin/google-chrome",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
            "/usr/bin/microsoft-edge",
          ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {}
  }
  throw new Error(
    "Install Chrome or Edge, or start your browser with local debugging and connect to it in Settings.",
  );
}
