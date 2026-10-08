/**
 * Content script utilities
 */

export interface BookingState {
  state: 'unknown' | 'booking' | 'payment' | 'confirmed';
  bookingId?: string;
}

/**
 * Detect the current booking state based on page URL/content
 */
export function detectBookingState(url: string, bodyText: string): BookingState {
  const normalized = url.toLowerCase();

  if (normalized.includes('booking') || normalized.includes('checkout')) {
    if (normalized.includes('payment') || normalized.includes('pay')) {
      return { state: 'payment' };
    }
    return { state: 'booking' };
  }

  if (normalized.includes('confirmation') || normalized.includes('ticket') || normalized.includes('success')) {
    const bookingId = bodyText.match(/booking\s*(?:id|no|ref)[:\s]*([A-Z0-9-]{4,})/i)?.[1];
    return { state: 'confirmed', bookingId };
  }

  return { state: 'unknown' };
}