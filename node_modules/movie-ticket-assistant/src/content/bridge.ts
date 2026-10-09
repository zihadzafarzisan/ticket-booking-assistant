/**
 * Content Script Bridge
 *
 * Injected into Star Cineplex / Ki Chole booking pages to:
 * 1. Automate seat clicking on the live seat map for the selected continuous block.
 * 2. Advance to the checkout/payment step automatically.
 * 3. Provide user-assisted handoff for secure payment (bKash, Nagad, cards).
 */

import { detectBookingState } from './utils';

console.log(`[Movie Assistant] Content script active on ${window.location.hostname}${window.location.pathname}`);

// Check for any pending reservation stored in chrome.storage on page load
// Check for any pending reservation stored in chrome.storage on page load
checkForPendingReservation();
checkSniperStateAndRenderHud();

// Listen for runtime commands from the extension
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const { type, payload } = message;

  switch (type) {
    case 'PING':
      sendResponse({ pong: true, url: window.location.href });
      return true;

    case 'DETECT_BOOKING_STATE':
      sendResponse(detectBookingState(window.location.href, document.body?.innerText ?? ''));
      return true;

    case 'SELECT_AND_RESERVE':
      handleSeatSelectionAndReservation(payload)
        .then(sendResponse)
        .catch(err => sendResponse({ success: false, error: err.message }));
      return true;

    case 'SNIPER_STATE_CHANGED':
      renderOrUpdateSniperHud(payload);
      sendResponse({ ok: true });
      return true;

    default:
      sendResponse({ error: `Unknown message type: ${type}` });
      return true;
  }
});

/**
 * Check if the user initiated an auto-booking and page just loaded
 */
async function checkForPendingReservation() {
  if (!window.location.pathname.includes('/seats')) return;

  try {
    const data = await chrome.storage.local.get('pendingReservation');
    const pending = data?.pendingReservation;
    if (pending && Array.isArray(pending.seatLabels) && pending.seatLabels.length > 0) {
      // Check if recent (within 60 seconds)
      if (Date.now() - (pending.timestamp || 0) < 60000) {
        console.log('[Movie Assistant] Found active pending reservation for seats:', pending.seatLabels);
        // Clear pending to avoid re-triggering on manual refresh
        await chrome.storage.local.remove('pendingReservation');
        // Execute automatic selection & reservation
        await handleSeatSelectionAndReservation({
          seatLabels: pending.seatLabels,
          autoProceed: true,
        });
      }
    }
  } catch (err) {
    console.warn('[Movie Assistant] Storage check error:', err);
  }
}

/**
 * Automate selecting the target seats and advancing to checkout/payment
 */
async function handleSeatSelectionAndReservation(payload: {
  seatLabels: string[];
  autoProceed?: boolean;
}): Promise<{ success: boolean; clickedSeats: string[]; proceedClicked: boolean }> {
  const { seatLabels, autoProceed = true } = payload;
  const clickedSeats: string[] = [];

  console.log('[Movie Assistant] Attempting automated seat selection for:', seatLabels);

  // Check if online sales for this show are closed
  if (
    document.body.innerText.includes('Online sales for this show closed') ||
    document.body.innerText.includes('Contact counter for tickets')
  ) {
    showCounterClosedNotice();
    return {
      success: false,
      clickedSeats: [],
      proceedClicked: false,
    };
  }

  // Wait for seat map elements or SVG to appear in DOM
  await waitForSeatElements(12000);

  for (const label of seatLabels) {
    const el = findSeatElement(label);
    if (el) {
      // Simulate real user click
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.click();
      clickedSeats.push(label);
      console.log(`[Movie Assistant] Clicked seat: ${label}`);
      // Small interval for React state update
      await new Promise(r => setTimeout(r, 250));
    } else {
      console.warn(`[Movie Assistant] Could not find seat element for label: ${label}`);
    }
  }

  let proceedClicked = false;
  if (autoProceed && clickedSeats.length > 0) {
    console.log('[Movie Assistant] Seats clicked. Polling for Continue / Checkout button...');
    proceedClicked = await clickProceedWithRetry(20, 300);
    console.log('[Movie Assistant] Proceed button clicked:', proceedClicked);
  }

  return {
    success: clickedSeats.length > 0,
    clickedSeats,
    proceedClicked,
  };
}

/**
 * Wait for seat elements or SVG to be rendered in the DOM
 */
function waitForSeatElements(timeoutMs = 12000): Promise<void> {
  return new Promise(resolve => {
    const start = Date.now();
    const interval = setInterval(() => {
      const seats = document.querySelectorAll(
        '[data-seat-id], [role="gridcell"], [data-seat-label], [data-testid*="seat"], button[aria-label*="seat"], button[aria-label*="Seat"]'
      );
      if (seats.length > 0 || Date.now() - start > timeoutMs) {
        clearInterval(interval);
        resolve();
      }
    }, 250);
  });
}

/**
 * Find seat element in DOM matching label (e.g. "L01", "L1", "K4")
 */
function findSeatElement(label: string): HTMLElement | null {
  const cleanLabel = label.trim().toUpperCase();
  const strippedNumber = cleanLabel.replace(/0+(\d+)$/, '$1'); // e.g. L01 -> L1
  const rowMatch = cleanLabel.match(/^([A-Z]+)(\d+)$/);
  const rowLetter = rowMatch ? rowMatch[1] : '';
  const numVal = rowMatch ? parseInt(rowMatch[2], 10) : null;

  // 1. Direct attribute match (Ki Chole / Star Cineplex uses data-seat-id)
  const byAttr = document.querySelector<HTMLElement>(
    `[data-seat-id="${cleanLabel}"], [data-seat-id="${strippedNumber}"], ` +
    `[data-seat-label="${cleanLabel}"], [data-seat-label="${strippedNumber}"]`
  );
  if (byAttr) return byAttr;

  // 2. Ki Chole aria-label matching: e.g. "Row L seat L01", "Row L seat 1", "Row L seat 01"
  if (rowLetter && numVal !== null) {
    const allSeats = Array.from(document.querySelectorAll<HTMLElement>('[role="gridcell"], [data-seat-id], button'));
    for (const el of allSeats) {
      const aria = (el.getAttribute('aria-label') || '').toUpperCase();
      if (
        (aria.includes(`ROW ${rowLetter}`) || aria.includes(`ROW: ${rowLetter}`)) &&
        (aria.includes(`SEAT ${cleanLabel}`) || aria.includes(`SEAT ${strippedNumber}`) || aria.includes(`SEAT ${numVal}`))
      ) {
        return el;
      }
    }
  }

  // 3. Fallback: aria-label contains cleanLabel or strippedNumber
  const byAria = document.querySelector<HTMLElement>(
    `[aria-label*="${cleanLabel}"], [aria-label*="${strippedNumber}"]`
  );
  if (byAria) return byAria;

  // 4. By inner text
  const buttons = Array.from(document.querySelectorAll<HTMLElement>('[role="gridcell"], button, div[role="button"], svg text'));
  for (const b of buttons) {
    const text = b.textContent?.trim().toUpperCase();
    if (text === cleanLabel || text === strippedNumber) {
      return b;
    }
  }

  return null;
}

/**
 * Poll for Continue / Proceed button until rendered, then click
 */
async function clickProceedWithRetry(maxAttempts = 20, intervalMs = 300): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    if (attemptClickProceedButton()) {
      return true;
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }
  return false;
}

/**
 * Find and click the Proceed/Continue/Buy button
 */
function attemptClickProceedButton(): boolean {
  // 1. Check Ki Chole specific aria-label: "Proceed to checkout with X seats..."
  const byAria = document.querySelector<HTMLElement>(
    'button[aria-label*="Proceed to checkout"], button[aria-label*="checkout"], button[aria-label*="Continue"]'
  );
  if (byAria && !byAria.hasAttribute('disabled')) {
    byAria.click();
    return true;
  }

  // 2. Find any button or link containing Proceed / Continue
  const candidateButtons = Array.from(
    document.querySelectorAll<HTMLElement>('button, a[role="button"], input[type="submit"]')
  );

  const proceedTexts = ['CONTINUE', 'PROCEED', 'BUY TICKETS', 'PROCEED TO CHECKOUT', 'BOOK NOW', 'NEXT', 'CONFIRM'];

  for (const btn of candidateButtons) {
    const text = btn.textContent?.trim().toUpperCase() || '';
    if (proceedTexts.some(p => text.includes(p)) && !btn.hasAttribute('disabled')) {
      btn.click();
      return true;
    }
  }

  return false;
}

/**
 * On checkout/payment page, show an assistant banner indicating seats are held
 */
if (
  window.location.pathname.includes('/checkout') ||
  window.location.pathname.includes('/payment')
) {
  showCheckoutAssistantBanner();
}

function showCheckoutAssistantBanner() {
  if (document.getElementById('movie-assistant-checkout-banner')) return;

  const banner = document.createElement('div');
  banner.id = 'movie-assistant-checkout-banner';
  banner.style.cssText = `
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 999999;
    background: #1c1917;
    color: #ffffff;
    border: 1px solid #dc2626;
    border-radius: 8px;
    padding: 12px 16px;
    box-shadow: 0 10px 25px rgba(0,0,0,0.4);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    max-width: 360px;
    font-size: 13px;
    line-height: 1.4;
  `;

  banner.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px; font-weight: 600; color: #ef4444; margin-bottom: 4px;">
      <span>🎬</span>
      <span>Movie Assistant: Seats Reserved</span>
    </div>
    <div style="color: #d6d3d1;">
      Your continuous seats have been selected! Please enter your phone number and complete payment (bKash / Nagad / Card) below.
    </div>
  `;

  document.body.appendChild(banner);
}

function showCounterClosedNotice() {
  if (document.getElementById('movie-assistant-closed-banner')) return;

  const banner = document.createElement('div');
  banner.id = 'movie-assistant-closed-banner';
  banner.style.cssText = `
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 999999;
    background: #450a0a;
    color: #fecaca;
    border: 1px solid #dc2626;
    border-radius: 8px;
    padding: 12px 16px;
    box-shadow: 0 10px 25px rgba(0,0,0,0.5);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    max-width: 360px;
    font-size: 13px;
    line-height: 1.4;
  `;

  banner.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px; font-weight: 600; color: #ef4444; margin-bottom: 4px;">
      <span>⚠️</span>
      <span>Online Booking Closed</span>
    </div>
    <div style="color: #fca5a5;">
      Online sales for this show closed (starts in &lt;60 minutes). Please open the extension and select the next available showtime.
    </div>
  `;

  document.body.appendChild(banner);
}

/**
 * Check if the Seat Drop Sniper is active and display the floating HUD
 */
async function checkSniperStateAndRenderHud() {
  try {
    const data = await chrome.storage.local.get('sniperState');
    if (data?.sniperState) {
      renderOrUpdateSniperHud(data.sniperState);
    }
  } catch (err) {
    console.warn('[Movie Assistant] Failed to check sniper state for HUD:', err);
  }
}

let keepAlivePort: chrome.runtime.Port | null = null;
let heartbeatInterval: any = null;

function ensureKeepAlive(isActive: boolean) {
  if (isActive) {
    if (!keepAlivePort && typeof chrome !== 'undefined' && chrome.runtime?.connect) {
      try {
        keepAlivePort = chrome.runtime.connect({ name: 'sniper-keepalive' });
        keepAlivePort.onDisconnect.addListener(() => {
          keepAlivePort = null;
          // Reconnect if still active
          setTimeout(() => {
            if (typeof chrome !== 'undefined' && chrome.storage?.local) {
              chrome.storage.local.get('sniperState').then(d => {
                if (d?.sniperState?.config?.active) ensureKeepAlive(true);
              }).catch(() => {});
            }
          }, 1000);
        });
      } catch (e) {}
    }

    if (!heartbeatInterval) {
      heartbeatInterval = setInterval(() => {
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
          chrome.storage.local.get('sniperState').then(d => {
            if (d?.sniperState?.config?.active) {
              chrome.runtime.sendMessage({ type: 'SNIPER_HEARTBEAT' }).then(res => {
                if (res?.state) renderOrUpdateSniperHud(res.state);
              }).catch(() => {});
            } else {
              ensureKeepAlive(false);
            }
          }).catch(() => {});
        }
      }, 2500);
    }
  } else {
    if (keepAlivePort) {
      try { keepAlivePort.disconnect(); } catch (e) {}
      keepAlivePort = null;
    }
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
  }
}

/**
 * Render or update in-page floating status HUD for the Sniper
 */
function renderOrUpdateSniperHud(state: any) {
  if (!state || !state.config || (!state.config.active && state.status !== 'booked')) {
    removeSniperHud();
    return;
  }

  ensureKeepAlive(state.config.active);

  const { config, status, refreshCount = 0, bookedSeats } = state;

  let hud = document.getElementById('movie-assistant-sniper-hud');
  if (!hud) {
    hud = document.createElement('div');
    hud.id = 'movie-assistant-sniper-hud';
    hud.style.cssText = `
      position: fixed;
      top: 14px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 9999999;
      background: #0c0a09;
      color: #fafaf9;
      border: 1px solid #dc2626;
      border-radius: 10px;
      padding: 10px 16px;
      box-shadow: 0 12px 30px rgba(0,0,0,0.6);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      min-width: 320px;
      max-width: 480px;
      font-size: 12px;
      line-height: 1.4;
      display: flex;
      flex-direction: column;
      gap: 6px;
      transition: all 0.2s ease;
    `;
    document.body.appendChild(hud);
  }

  const isBooked = status === 'booked';
  const isWaiting = status === 'waiting_schedule';

  hud.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #292524; padding-bottom: 6px;">
      <div style="display: flex; align-items: center; gap: 6px; font-weight: 700; color: ${isBooked ? '#22c55e' : '#ef4444'};">
        <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${isBooked ? '#22c55e' : '#ef4444'};"></span>
        <span>${isBooked ? '🎉 Seats Secured!' : isWaiting ? '⏳ Sniper Scheduled' : '🎯 Seat Drop Sniper Active'}</span>
      </div>
      <button id="movie-assistant-stop-sniper-btn" style="background: none; border: 1px solid #44403c; border-radius: 4px; color: #a8a29e; font-size: 11px; padding: 2px 6px; cursor: pointer;">
        ${isBooked ? 'Close ✖' : 'Stop Sniper ✖'}
      </button>
    </div>
    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 4px; font-size: 11px; color: #d6d3d1;">
      <div>🎬 <strong>${config.movieName}</strong></div>
      <div>📅 Target: <strong style="color: #ef4444;">${config.targetDate}</strong></div>
      <div>💺 Required: <strong>${config.requiredSeats} seats</strong></div>
      <div>🔄 Refreshes: <strong>${refreshCount}</strong></div>
    </div>
    <div style="font-size: 11px; color: ${isBooked ? '#86efac' : '#a8a29e'}; margin-top: 2px;">
      ${
        isBooked
          ? `Selected continuous seats: <strong>${(bookedSeats || []).join(', ')}</strong>. Ready for payment!`
          : isWaiting
          ? 'Waiting for scheduled drop countdown...'
          : `Auto-refreshing & scanning for newly opened seats every ${config.intervalSeconds}s...`
      }
    </div>
  `;

  const stopBtn = hud.querySelector('#movie-assistant-stop-sniper-btn');
  if (stopBtn) {
    stopBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'STOP_SNIPER', reason: 'User closed from page HUD' }, () => {
        removeSniperHud();
      });
    });
  }
}

function removeSniperHud() {
  ensureKeepAlive(false);
  const hud = document.getElementById('movie-assistant-sniper-hud');
  if (hud) {
    hud.remove();
  }
}