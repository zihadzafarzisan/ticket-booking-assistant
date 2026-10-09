/**
 * Browser Desktop Notifications Helper
 */

export function showDesktopNotification(title: string, message: string): void {
  try {
    if (typeof chrome !== 'undefined' && chrome.notifications && chrome.notifications.create) {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: chrome.runtime.getURL ? chrome.runtime.getURL('icons/icon-128.png') : 'icons/icon-128.png',
        title,
        message,
        priority: 2,
        requireInteraction: true,
      });
    }
  } catch (err) {
    console.warn('[Movie Assistant] Notification error:', err);
  }
}
