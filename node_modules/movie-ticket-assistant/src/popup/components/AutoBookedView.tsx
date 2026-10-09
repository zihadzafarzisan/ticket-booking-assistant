/**
 * Auto-Booked Confirmation View
 *
 * Displays the automatically selected first-found continuous seats, hall,
 * and location, and allows 1-click access to the checkout/payment page.
 */
import React from 'react';
import type { RankedResult } from '../../background/service-worker';

interface AutoBookedViewProps {
  result: RankedResult;
  requiredSeats: number;
  optimalSeatLabels: string[];
  bookingUrl: string;
  tabId?: number;
  totalOptionsCount: number;
  onViewAllOptions: () => void;
  onNewSearch: () => void;
}

export function AutoBookedView({
  result,
  requiredSeats,
  optimalSeatLabels,
  bookingUrl,
  tabId,
  totalOptionsCount,
  onViewAllOptions,
  onNewSearch,
}: AutoBookedViewProps) {
  const { showtime, seatBlock } = result;
  const totalPrice = showtime.price * requiredSeats;

  const handleOpenPayment = () => {
    if (tabId) {
      chrome.tabs.update(tabId, { active: true }).catch(() => {
        if (bookingUrl) window.open(bookingUrl, '_blank');
      });
    } else if (bookingUrl) {
      window.open(bookingUrl, '_blank');
    }
  };

  return (
    <div className="auto-booked-view">
      <div className="success-banner">
        <span className="success-icon">⚡</span>
        <div>
          <h2>Auto-Selected & Ready for Payment!</h2>
          <p className="success-subtitle">
            First available continuous block selected automatically
          </p>
        </div>
      </div>

      <div className="collected-details-card">
        <div className="detail-row">
          <span className="detail-label">🎬 Movie</span>
          <span className="detail-value highlight">{showtime.movie.title}</span>
        </div>

        <div className="detail-row">
          <span className="detail-label">📍 Location</span>
          <span className="detail-value">{showtime.cinema.name}</span>
        </div>

        <div className="detail-row">
          <span className="detail-label">🏛️ Hall & Format</span>
          <span className="detail-value">
            {showtime.hall.name} • {showtime.screenType.toUpperCase()}
          </span>
        </div>

        <div className="detail-row">
          <span className="detail-label">🕒 Showtime</span>
          <span className="detail-value">
            {showtime.date} at {showtime.time}
          </span>
        </div>

        <div className="detail-row seat-highlight-row">
          <span className="detail-label">💺 Selected Seats</span>
          <span className="detail-value seats-tag">
            Row {seatBlock.row} • {optimalSeatLabels.join(', ')} ({requiredSeats} together)
          </span>
        </div>

        <div className="detail-row total-price-row">
          <span className="detail-label">💳 Total Amount</span>
          <span className="detail-value price-total">৳{totalPrice.toLocaleString()} BDT</span>
        </div>
      </div>

      <div className="status-timeline">
        <div className="timeline-item done">
          <span className="step-circle">✓</span>
          <span>Halls & available continuous blocks collected</span>
        </div>
        <div className="timeline-item done">
          <span className="step-circle">✓</span>
          <span>First available block selected ({optimalSeatLabels.join(', ')})</span>
        </div>
        <div className="timeline-item done">
          <span className="step-circle">✓</span>
          <span>Seats clicked & navigated to checkout/payment tab</span>
        </div>
      </div>

      <div className="actions-cluster">
        <button className="primary proceed-payment-btn" onClick={handleOpenPayment}>
          Open Payment Tab (bKash / Nagad / Card) →
        </button>

        {totalOptionsCount > 1 && (
          <button className="secondary browse-options-btn" onClick={onViewAllOptions}>
            Want another hall or time? Browse all {totalOptionsCount} options
          </button>
        )}

        <button className="text-btn" onClick={onNewSearch}>
          ← Search another movie
        </button>
      </div>
    </div>
  );
}
