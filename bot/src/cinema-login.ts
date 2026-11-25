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
  const isLoginPath = /\/(login|signin|sign-in|auth)(\/|\?|$)/i.test(
    new URL(page.url()).pathname,
  );
  const challenge = page
    .locator(
      'input[autocomplete="one-time-code"], input[name*="otp" i], iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="challenges.cloudflare.com"], [data-sitekey], [aria-label*="Quick check that you are a person" i]',
    )
    .filter({ visible: true });
  const turnstileInput = page.locator('input[name="cf-turnstile-response"]');
  const hasUnresolvedTurnstile = async () => {
    if (!(await turnstileInput.count())) return false;
    const token = await turnstileInput
      .first()
      .inputValue()
      .catch(() => "");
    return !token.trim();
  };
  const password = page
    .locator('input[type="password"]')
    .filter({ visible: true })
    .first();
  // On SPA redirects to /login, wait briefly for login inputs or challenges to hydrate.
  if (isLoginPath && !(await password.count()) && !(await challenge.count())) {
    await page
      .locator(
        'input[type="password"], input[type="email"], input[type="tel"], input[autocomplete="one-time-code"], input[name*="otp" i], iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="challenges.cloudflare.com"], [data-sitekey]',
      )
      .first()
      .waitFor({ state: "visible", timeout: 3500 })
      .catch(() => {});
    signal.throwIfAborted();
  }
  if ((await challenge.count()) || (await hasUnresolvedTurnstile()))
    return "Complete the cinema OTP or CAPTCHA in your browser and sign in once (your regular browser keeps you signed in for future bookings), then retry.";
  if (!(await password.count())) {
    if (isLoginPath)
      return "The cinema requires login on this page. Sign in in your browser, then retry.";
    return undefined;
  }
  if (!credentials)
    return "The cinema requires login. Add your Cineplex email and password in Settings, or sign in in this browser, then retry.";
  if (attempt.submitted)
    return "The cinema login was not completed. Check your credentials or finish the on-screen step, then retry.";
  const form = password.locator("xpath=ancestor::form[1]");
  const hasForm = (await form.count()) > 0;
  const scope = hasForm ? form : page.locator("body");
  const email = scope
    .locator(
      'input[type="email"], input[autocomplete="username"], input[name="email"], input[name="username"], input[name="identifier"], input[type="text"][name*="email" i], input[type="text"][placeholder*="email" i]',
    )
    .filter({ visible: true })
    .first();
  const namedSubmit = scope
    .getByRole("button", {
      name: /^(sign\s*in|log\s*in|login|continue)(\s+to\s+.*)?$/i,
    })
    .filter({ visible: true })
    .first();
  const submit =
    (await namedSubmit.count()) > 0
      ? namedSubmit
      : hasForm
        ? form
            .locator('button[type="submit"], input[type="submit"]')
            .filter({ visible: true })
            .first()
        : namedSubmit;
  if (!(await email.count()) || !(await submit.count()))
    return "The cinema login form needs your attention. Sign in in the browser, then retry.";
  if (hasForm) {
    const action = await form.getAttribute("action");
    if (action) {
      let resolved: string;
      try {
        resolved = new URL(action, page.url()).href;
      } catch {
        return "The login form points outside the supported cinema website. Review it manually.";
      }
      if (!isCinemaUrl(resolved))
        return "The login form points outside the supported cinema website. Review it manually.";
    }
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
    if ((await challenge.count()) || (await hasUnresolvedTurnstile()))
      return "Complete the cinema OTP or CAPTCHA in your browser, then retry.";
    if (await password.isVisible().catch(() => false))
      return "Cineplex did not complete login. Check your saved credentials or sign in manually, then retry.";
    return undefined;
  } catch {
    signal.throwIfAborted();
    // Locator errors may contain form details. Never copy them into mission logs.
    return "Automatic cinema login could not finish. Sign in in your browser, then retry.";
  }
}
