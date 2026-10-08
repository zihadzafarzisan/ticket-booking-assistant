/**
 * Content Script Bridge
 *
 * Injected into cinema websites to:
 * 1. Interact with the page DOM (for cinemas without public APIs)
 * 2. Relay messages between the service worker and the page
 * 3. Detect booking confirmation pages
 */
import { adapterRegistry } from '../adapters/base-adapter';
import { detectBookingState } from './utils';

// Identify which adapter this site belongs to
const currentUrl = window.location.href;
const adapter = adapterRegistry.findForUrl(currentUrl);

console.log(`[Movie Assistant] Content script loaded on ${window.location.hostname}`);

// Listen for messages from the extension
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const { type, payload } = message;

  switch (type) {
    case 'PING':
      sendResponse({ pong: true });
      return true;

    case 'EXTRACT_PAGE':
      // Extract structured data from the current page
      sendResponse(extractPageData());
      return true;

    case 'DETECT_BOOKING_STATE':
      sendResponse(detectBookingState(currentUrl, document.body?.innerText ?? ''));
      return true;

    default:
      sendResponse({ error: `Unknown message type: ${type}` });
      return true;
  }
});

/**
 * Extract relevant data from the current cinema page
 */
function extractPageData() {
  // In production, this would use the adapter's parser
  // to extract movie info, showtimes, or seat maps from the DOM

  return {
    url: currentUrl,
    title: document.title,
    adapterId: adapter?.id ?? 'unknown',
    extracted: {},
  };
}

/**
 * Detect the current booking state based on page URL/content
 */