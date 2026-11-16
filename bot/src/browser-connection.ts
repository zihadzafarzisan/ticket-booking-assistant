import { chromium, type Browser, type BrowserContext } from "playwright";
import { spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

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
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !url.port
  )
    throw new Error(
      "Browser address must use loopback HTTP with a port and no path or credentials.",
    );
  return url.origin;
}
export class BrowserConnection {
  private endpoint = "http://127.0.0.1:9222";
  private browser?: Browser;
  constructor(
    private directory: string,
    private launchOptions: { executablePath?: string; headless?: boolean } = {},
  ) {}
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
    if (this.browser?.isConnected()) return this.browser.contexts()[0];
    const version = await fetch(`${this.endpoint}/json/version`, {
      signal: AbortSignal.timeout(2000),
      redirect: "error",
    });
    if (!version.ok) throw new Error("Browser debugging is unavailable.");
    const data = (await version.json()) as { webSocketDebuggerUrl?: string };
    const socket = new URL(data.webSocketDebuggerUrl || "");
    if (
      socket.protocol !== "ws:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(socket.hostname) ||
      socket.username ||
      socket.password
    )
      throw new Error("The browser must expose a local debugging connection.");
    const browser = await chromium.connectOverCDP(socket.href, {
      timeout: 5000,
    });
    const context = browser.contexts()[0];
    if (!context) {
      await browser.close();
      throw new Error("The browser has no regular session to connect to.");
    }
    this.browser = browser;
    return context;
  }
  async connect(): Promise<BrowserContext> {
    try {
      return await this.attach();
    } catch {
      throw new Error(
        "Cannot connect to your browser. In Settings, enable browser access or choose Open regular browser, then retry. Browsers need local debugging enabled before the bot can use their tabs.",
      );
    }
  }
  async openRegular(): Promise<BrowserContext> {
    try {
      return await this.attach();
    } catch {}
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
    const child = spawn(executable, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    let launchError = false;
    child.once("error", () => {
      launchError = true;
    });
    child.unref();
    for (let attempt = 0; attempt < 40 && !launchError; attempt++) {
      try {
        return await this.attach();
      } catch {}
      await new Promise((done) => setTimeout(done, 250));
    }
    throw new Error(
      "Could not open the regular browser. Check that the local debugging port is available, then retry in Settings.",
    );
  }
  async disconnect() {
    // A CDP-attached Browser.close disconnects Playwright; it does not close Chrome.
    await this.browser?.close();
    this.browser = undefined;
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
