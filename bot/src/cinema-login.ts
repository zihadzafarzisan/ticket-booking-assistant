import type { Page } from "playwright";
import type { CinemaCredentials } from "./credentials";

export function isCinemaUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      [
        "kichole.com",
        "starcineplex.com",
        "cineplexbd.com",
        "cineplex.com.bd",
      ].some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
      )
    );
  } catch {
    return false;
  }
}
export interface LoginAttempt {
  submitted: boolean;
}
export async function handleCinemaLogin(
  page: Page,
  credentials: CinemaCredentials | undefined,
  attempt: LoginAttempt,
  signal: AbortSignal,
): Promise<string | undefined> {
  signal.throwIfAborted();
  if (!isCinemaUrl(page.url()))
    return "The browser left the supported cinema website. Review it before continuing.";
  const challenge = page
    .locator(
      'input[autocomplete="one-time-code"], input[name*="otp" i], iframe[src*="recaptcha"], iframe[src*="hcaptcha"], [data-sitekey]',
    )
    .filter({ visible: true });
  if (await challenge.count())
    return "Complete the cinema OTP or CAPTCHA in your browser, then retry.";
  const password = page
    .locator('input[type="password"]')
    .filter({ visible: true })
    .first();
  if (!(await password.count())) return undefined;
  if (!credentials)
    return "The cinema requires login. Add your Cineplex email and password in Settings, or sign in in this browser, then retry.";
  if (attempt.submitted)
    return "The cinema login was not completed. Check your credentials or finish the on-screen step, then retry.";
  const form = password.locator("xpath=ancestor::form[1]");
  const scope = (await form.count()) ? form : page.locator("body");
  const email = scope
    .locator(
      'input[type="email"], input[autocomplete="username"], input[name="email"], input[name="username"]',
    )
    .filter({ visible: true })
    .first();
  const submit = scope
    .getByRole("button", { name: /^(sign\s*in|log\s*in|login|continue)$/i })
    .filter({ visible: true })
    .first();
  if (!(await email.count()) || !(await submit.count()))
    return "The cinema login form needs your attention. Sign in in the browser, then retry.";
  if (await form.count()) {
    const action = await form.getAttribute("action");
    if (action && !isCinemaUrl(new URL(action, page.url()).href))
      return "The login form points outside the supported cinema website. Review it manually.";
  }
  try {
    signal.throwIfAborted();
    // Recheck the origin directly before filling; never send credentials to a redirect.
    if (!isCinemaUrl(page.url()))
      return "The cinema page changed. Review it before retrying login.";
    await email.fill(credentials.email, { timeout: 3000 });
    signal.throwIfAborted();
    await password.fill(credentials.password, { timeout: 3000 });
    signal.throwIfAborted();
    attempt.submitted = true;
    await submit.click({ timeout: 5000 });
    await password.waitFor({ state: "hidden", timeout: 8000 }).catch(() => {});
    signal.throwIfAborted();
    if (!isCinemaUrl(page.url()))
      return "The cinema redirected to another website. Complete login manually.";
    if (await challenge.count())
      return "Complete the cinema OTP or CAPTCHA in your browser, then retry.";
    if (await password.isVisible().catch(() => false))
      return "Cineplex did not complete login. Check your saved credentials or sign in manually, then retry.";
    return undefined;
  } catch (error) {
    signal.throwIfAborted();
    // Locator errors may contain form details. Never copy them into mission logs.
    return "Automatic cinema login could not finish. Sign in in your browser, then retry.";
  }
}
