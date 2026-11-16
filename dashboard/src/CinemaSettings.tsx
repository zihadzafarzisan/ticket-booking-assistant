import { useEffect, useState, type FormEvent } from "react";
import type { BrowserStatus, CredentialStatus } from "../../bot/src/contracts";
import { api } from "./api";
import { Icon } from "./icons";

interface Settings {
  browser: { endpoint: string };
  credentials: CredentialStatus;
}
export function CinemaSettings({
  browser,
  onChanged,
}: {
  browser: BrowserStatus;
  onChanged(): Promise<void>;
}) {
  const [settings, setSettings] = useState<Settings>();
  const [endpoint, setEndpoint] = useState("http://127.0.0.1:9222");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<{ text: string; error?: boolean }>();
  useEffect(() => {
    let active = true;
    void api<Settings>("/settings")
      .then((value) => {
        if (!active) return;
        setSettings(value);
        setEndpoint(value.browser.endpoint);
        setEmail(value.credentials.email);
        setRemember(value.credentials.remembered);
      })
      .catch((error) => {
        if (active) setNotice({ text: error.message, error: true });
      });
    return () => {
      active = false;
    };
  }, []);
  const run = async (
    key: string,
    work: () => Promise<void>,
    message: string,
  ) => {
    setBusy(key);
    setNotice(undefined);
    try {
      await work();
      await onChanged();
      setNotice({ text: message });
    } catch (error) {
      setNotice({ text: (error as Error).message, error: true });
    } finally {
      setBusy("");
    }
  };
  const connect = (event: FormEvent) => {
    event.preventDefault();
    void run(
      "connect",
      async () => {
        const value = await api<{ endpoint: string }>("/settings/browser", {
          endpoint,
        });
        setSettings((current) =>
          current ? { ...current, browser: value } : current,
        );
        await api("/browser/connect", {});
      },
      "Connected to your open browser. Cinema tabs will use its regular session.",
    );
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    void run(
      "save",
      async () => {
        const credentials = await api<CredentialStatus>(
          "/settings/credentials",
          { email, password, remember },
        );
        setSettings((current) =>
          current ? { ...current, credentials } : current,
        );
        setPassword("");
      },
      "Cineplex login saved. The bot will use it when the cinema asks you to sign in.",
    );
  };
  return (
    <>
      <section className="panel settings-card">
        <div className="settings-title">
          <span className="settings-symbol">
            <Icon name="browser" size={23} />
          </span>
          <div>
            <h2>Your cinema browser</h2>
            <p>Use regular tabs and keep your login session.</p>
          </div>
        </div>
        <div className="setting-line">
          <div>
            <strong>Browser connection</strong>
            <p>
              {browser.connected
                ? `Connected · ${browser.pages} open tabs`
                : "Connect to Chrome or Edge, or open a regular browser."}
            </p>
          </div>
          <span
            className={`connection-pill ${browser.connected ? "connected" : ""}`}
          >
            {browser.connected ? "Connected" : "Not connected"}
          </span>
        </div>
        <p className="settings-copy">
          The bot opens cinema tabs in the connected browser. It keeps that
          browser open when the bot stops.
        </p>
        <form className="settings-form" onSubmit={connect}>
          <label htmlFor="browser-endpoint">Local browser address</label>
          <input
            id="browser-endpoint"
            type="url"
            required
            value={endpoint}
            onChange={(event) => setEndpoint(event.target.value)}
          />
          <button className="button secondary" disabled={!!busy || !settings}>
            {busy === "connect" ? "Connecting…" : "Connect existing browser"}
          </button>
        </form>
        <button
          type="button"
          className="button primary"
          disabled={!!busy || !settings}
          onClick={() =>
            void run(
              "open",
              async () => {
                await api("/settings/browser", { endpoint });
                await api("/browser/open", {});
              },
              "Regular cinema browser ready. Future bookings reuse its tabs and login.",
            )
          }
        >
          <Icon name="browser" size={17} />
          {busy === "open" ? "Opening…" : "Open regular browser"}
        </button>
        <details className="browser-help">
          <summary>Connect a browser that is already open</summary>
          <p>
            Chrome or Edge must have local debugging enabled before the bot can
            control its tabs. Enter its local address above. An ordinary browser
            started without this access cannot be attached automatically.
          </p>
          <p>
            For simple setup, choose Open regular browser. This opens Chrome or
            Edge with a persistent cinema profile; sign in once and keep using
            that window. The bot reuses it for future bookings.
          </p>
          <a
            href="https://developer.chrome.com/blog/remote-debugging-port"
            target="_blank"
            rel="noreferrer"
          >
            Chrome browser setup requirements
          </a>
        </details>
      </section>
      <section className="panel settings-card">
        <div className="settings-title">
          <span className="settings-symbol amber">
            <Icon name="shield" size={23} />
          </span>
          <div>
            <h2>Cineplex login</h2>
            <p>Be ready when the cinema asks you to sign in.</p>
          </div>
        </div>
        <div className="setting-line">
          <div>
            <strong>
              {settings?.credentials.configured
                ? "Login saved"
                : "No login saved"}
            </strong>
            <p>
              {settings?.credentials.configured
                ? `${settings.credentials.email} · ${settings.credentials.remembered ? "Encrypted on this computer" : "This bot session only"}`
                : "Optional. You can also sign in directly in your browser."}
            </p>
          </div>
        </div>
        <form className="settings-form" onSubmit={save}>
          <label htmlFor="cinema-email">Cineplex email</label>
          <input
            id="cinema-email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <label htmlFor="cinema-password">Cineplex password</label>
          <input
            id="cinema-password"
            type="password"
            autoComplete="current-password"
            required
            maxLength={1024}
            value={password}
            placeholder={
              settings?.credentials.configured
                ? "Enter password to replace saved login"
                : "Enter your Cineplex password"
            }
            onChange={(event) => setPassword(event.target.value)}
          />
          {settings?.credentials.canRemember && (
            <label className="remember-login">
              <input
                type="checkbox"
                checked={remember}
                onChange={(event) => setRemember(event.target.checked)}
              />
              Remember on this Windows account (encrypted)
            </label>
          )}
          <p className="settings-copy">
            Used only on the cinema website when login is required. OTP, CAPTCHA
            and payment remain yours to complete. Passwords are never included
            in mission history.
          </p>
          <div className="settings-actions">
            <button className="button primary" disabled={!!busy || !settings}>
              {busy === "save" ? "Saving…" : "Save Cineplex login"}
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={!!busy || !settings?.credentials.configured}
              onClick={() =>
                void run(
                  "clear",
                  async () => {
                    const credentials = await api<CredentialStatus>(
                      "/settings/credentials/clear",
                      {},
                    );
                    setSettings((current) =>
                      current ? { ...current, credentials } : current,
                    );
                    setEmail("");
                    setPassword("");
                    setRemember(false);
                  },
                  "Saved Cineplex login removed.",
                )
              }
            >
              Remove saved login
            </button>
          </div>
        </form>
      </section>
      {notice && (
        <div
          className={`settings-notice ${notice.error ? "error" : ""}`}
          role={notice.error ? "alert" : "status"}
        >
          {notice.text}
        </div>
      )}
    </>
  );
}
