import type { Page } from "playwright";
import {
  handleCinemaLogin,
  isCinemaUrl,
  type LoginAttempt,
} from "./cinema-login";
import type { CinemaCredentials } from "./credentials";

export function isPaymentGatewayUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      [
        "securepay.sslcommerz.com",
        "pay.sslcommerz.com",
        "sandbox.sslcommerz.com",
        "sandbox-gw.sslcommerz.com",
      ].includes(url.hostname)
    );
  } catch {
    return false;
  }
}
export async function openPaymentGateway(
  page: Page,
  credentials: CinemaCredentials | undefined,
  attempt: LoginAttempt,
  signal: AbortSignal,
): Promise<{ page: Page; ready: boolean; message: string }> {
  const visited = new Set<string>();
  for (let step = 0; step < 3; step++) {
    signal.throwIfAborted();
    if (isPaymentGatewayUrl(page.url()))
      return {
        page,
        ready: true,
        message:
          "Your verified seats are ready and the payment gateway is open. Complete payment in your browser.",
      };
    if (!isCinemaUrl(page.url()))
      return {
        page,
        ready: false,
        message:
          "The cinema redirected to an unrecognized payment website. Review the browser before continuing.",
      };
    const loginMessage = await handleCinemaLogin(
      page,
      credentials,
      attempt,
      signal,
    );
    if (loginMessage) return { page, ready: false, message: loginMessage };
    if (!/\/(checkout|payment)(\/|\?|$)/.test(new URL(page.url()).pathname))
      break;
    // Only explicit gateway-navigation controls. Never click generic Pay now,
    // confirm a charge, fill checkout details or interact with a hosted gateway.
    const name =
      /^(?:(?:proceed|continue|go|redirect)\s+to\s+(?:secure\s+)?(?:payment|payment gateway)|open\s+(?:the\s+)?payment gateway)(?:\s|$)/i;
    const controls = page
      .getByRole("button", { name })
      .or(page.getByRole("link", { name }))
      .filter({ visible: true });
    const control = controls.first();
    if (!(await control.count()) || !(await control.isEnabled())) break;
    const href = await control.getAttribute("href");
    if (href) {
      const destination = new URL(href, page.url()).href;
      if (!isCinemaUrl(destination) && !isPaymentGatewayUrl(destination)) break;
    }
    const key = `${page.url()}:${await control.innerText()}`;
    if (visited.has(key)) break;
    visited.add(key);
    const before = page.url();
    const popup = page
      .waitForEvent("popup", { timeout: 1500 })
      .catch(() => undefined);
    signal.throwIfAborted();
    try {
      await control.click({ timeout: 4000 });
    } catch (clickError) {
      signal.throwIfAborted();
      if (/intercepts pointer events/i.test((clickError as Error).message)) {
        try {
          await control.evaluate((el) => (el as HTMLElement).click());
        } catch {
          signal.throwIfAborted();
          break;
        }
      } else {
        break;
      }
    }
    const opened = await popup;
    signal.throwIfAborted();
    if (opened) {
      page = opened;
      await page
        .waitForLoadState("domcontentloaded", { timeout: 10_000 })
        .catch(() => {});
    } else
      await page
        .waitForURL((url) => url.href !== before, { timeout: 5000 })
        .catch(() => {});
    signal.throwIfAborted();
  }
  if (isPaymentGatewayUrl(page.url()))
    return {
      page,
      ready: true,
      message:
        "Your verified seats are ready and the payment gateway is open. Complete payment in your browser.",
    };
  return {
    page,
    ready: false,
    message:
      "Your seats were selected. Complete the required cinema checkout details or choose its payment-gateway option in the browser, then retry. The bot has not submitted a payment.",
  };
}
