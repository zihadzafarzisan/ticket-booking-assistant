import { spawn } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CredentialStatus } from "./contracts";

export interface CinemaCredentials {
  email: string;
  password: string;
}
export interface SecretProtector {
  protect(value: string): Promise<string>;
  unprotect(value: string): Promise<string>;
}
function dpapi(
  operation: "Protect" | "Unprotect",
  input: string,
): Promise<string> {
  // Secrets travel over stdin, never command-line arguments or application logs.
  const script = `Add-Type -AssemblyName System.Security; $bytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $result=[Security.Cryptography.ProtectedData]::${operation}($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($result))`;
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    let output = "";
    child.stdout.on("data", (value) => {
      output += value;
    });
    child.stderr.resume();
    child.once("error", () =>
      reject(
        new Error(
          "Windows credential protection is unavailable. Use session-only storage.",
        ),
      ),
    );
    child.once("exit", (code) =>
      code === 0
        ? resolve(output.trim())
        : reject(
            new Error(
              "Windows could not protect or unlock the saved Cineplex login.",
            ),
          ),
    );
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}
const windowsProtector: SecretProtector = {
  protect: (value) => dpapi("Protect", Buffer.from(value).toString("base64")),
  unprotect: async (value) =>
    Buffer.from(await dpapi("Unprotect", value), "base64").toString("utf8"),
};
export class CredentialStore {
  private value?: CinemaCredentials;
  private remembered = false;
  constructor(
    private filename: string,
    private protector: SecretProtector | undefined = process.platform ===
    "win32"
      ? windowsProtector
      : undefined,
  ) {}
  async init() {
    let saved: string;
    try {
      saved = await readFile(this.filename, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    if (!this.protector)
      throw new Error(
        "Saved Cineplex login requires Windows credential protection. Clear it on the original computer.",
      );
    try {
      const record = JSON.parse(saved);
      if (record.version !== 1 || typeof record.protected !== "string")
        throw new Error();
      this.value = validateCredentials(
        JSON.parse(await this.protector.unprotect(record.protected)),
      );
      this.remembered = true;
    } catch {
      throw new Error(
        "Could not unlock saved Cineplex login. Remove credentials.json and enter it again in Settings.",
      );
    }
  }
  status(): CredentialStatus {
    return {
      configured: !!this.value,
      email: this.value?.email || "",
      remembered: this.remembered,
      canRemember: !!this.protector,
    };
  }
  get(): CinemaCredentials | undefined {
    return this.value ? { ...this.value } : undefined;
  }
  async save(value: unknown) {
    const credentials = validateCredentials(value);
    const remember = (value as Record<string, unknown>).remember === true;
    if (remember) {
      if (!this.protector)
        throw new Error(
          "Encrypted storage is available on Windows only. Use session-only storage.",
        );
      const protectedValue = await this.protector.protect(
        JSON.stringify(credentials),
      );
      await mkdir(dirname(this.filename), { recursive: true });
      const temp = `${this.filename}.tmp`;
      await writeFile(
        temp,
        JSON.stringify({ version: 1, protected: protectedValue }),
        { mode: 0o600 },
      );
      await rename(temp, this.filename);
    } else await rm(this.filename, { force: true });
    this.value = credentials;
    this.remembered = remember;
    return this.status();
  }
  async clear() {
    await rm(this.filename, { force: true });
    this.value = undefined;
    this.remembered = false;
    return this.status();
  }
}
function validateCredentials(value: unknown): CinemaCredentials {
  const input = value as Record<string, unknown> | null;
  const email = typeof input?.email === "string" ? input.email.trim() : "";
  const password = typeof input?.password === "string" ? input.password : "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
    throw new Error("Enter a valid Cineplex email address.");
  if (!password || password.length > 1024)
    throw new Error("Enter your Cineplex password (maximum 1024 characters).");
  return { email, password };
}
