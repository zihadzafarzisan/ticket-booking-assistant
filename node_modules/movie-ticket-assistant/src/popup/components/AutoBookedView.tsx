/**
 * Auto-Booked Confirmation View
 *
 * Displays the automatically selected continuous seats, hall, and location(s).
 * When multiple locations are selected, displays tabs/cards for all opened locations
 * with 1-click access to switch to each location's checkout/payment tab.
 */
import React from 'react';
import type { RankedResult } from '../../background/service-worker';

export interface MultiBookingItem {
  result: RankedResult;
  optimalSeatLabels: string[];
  bookingUrl: string;
  tabId?: number;
}

interface AutoBookedViewProps {
  result: RankedResult;
  requiredSeats: number;
  optimalSeatLabels: string[];
  bookingUrl: string;
  tabId?: number;
  multiBookings?: MultiBookingItem[];
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
  multiBookings,
  totalOptionsCount,
  onViewAllOptions,
  onNewSearch,
}: AutoBookedViewProps) {
  const isMulti = multiBookings && multiBookings.length > 1;

  const handleOpenTab = (targetTabId?: number, targetUrl?: string) => {
    if (targetTabId && typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.update(targetTabId, { active: true }).catch(() => {
        if (targetUrl) window.open(targetUrl, '_blank');
      });
    } else if (targetUrl) {
      window.open(targetUrl, '_blank');
    }
  };

  // If multiple locations were booked
  if (isMulti) {
    return (
      <div className="auto-booked-view multi-booking-view">
        <div className="success-banner">
          <span className="success-icon">⚡</span>
          <div>
            <h2>Opened {multiBookings.length} Location Tabs!</h2>
            <p className="success-subtitle">
              Reserved {requiredSeats} seats in rows B-F across each selected branch
            </p>
          </div>
        </div>

        <div className="multi-locations-list">
          {multiBookings.map((b, idx) => {
            const show = b.result.showtime;
            const price = show.price * requiredSeats;
            return (
              <div key={b.result.showtime.id + '-' + idx} className="multi-location-card">
                <div className="card-top-row">
                  <span className="location-branch-pill">📍 {show.cinema.name}</span>
                  <span className="location-price-tag">৳{price.toLocaleString()} BDT</span>
                </div>

                <div className="card-meta-row">
                  <span>🎬 {show.movie.title}</span>
                  <span>🏛️ {show.hall.name} ({show.screenType.toUpperCase()})</span>
                  <span>🕒 {show.date} at {show.time}</span>
                </div>

                <div className="card-seats-row">
                  <span className="seats-tag">
                    💺 {b.result.seatBlock.row.includes(',') ? `Rows ${b.result.seatBlock.row}` : `Row ${b.result.seatBlock.row}`} • {b.optimalSeatLabels.join(', ')} ({b.optimalSeatLabels.length} seats)
                  </span>
                </div>

                <button
                  type="button"
                  className="primary switch-tab-btn"
                  onClick={() => handleOpenTab(b.tabId, b.bookingUrl)}
                >
                  Switch to {show.cinema.location || show.cinema.name.replace(/Star Cineplex \((.*?)\)/, '$1')} Tab →
                </button>
              </div>
            );
          })}
        </div>

        <div className="status-timeline">
          <div className="timeline-item done">
            <span className="step-circle">✓</span>
            <span>{multiBookings.length} cinema locations evaluated</span>
          </div>
          <div className="timeline-item done">
            <span className="step-circle">✓</span>
            <span>{requiredSeats} seats selected in rows B-F for each branch</span>
          </div>
          <div className="timeline-item done">
            <span className="step-circle">✓</span>
            <span>{multiBookings.length} browser tabs opened ready for payment</span>
          </div>
        </div>

        <div className="actions-cluster">
          {totalOptionsCount > multiBookings.length && (
            <button className="secondary browse-options-btn" onClick={onViewAllOptions}>
              Browse all {totalOptionsCount} showtime options
            </button>
          )}

          <button className="text-btn" onClick={onNewSearch}>
            ← Search another movie
          </button>
        </div>
      </div>
    );
  }

  // Single booking view
  const { showtime, seatBlock } = result;
  const totalPrice = showtime.price * requiredSeats;

  return (
    <div className="auto-booked-view">
      <div className="success-banner">
        <span className="success-icon">⚡</span>
        <div>
          <h2>Auto-Selected & Ready for Payment!</h2>
          <p className="success-subtitle">
            Optimal continuous block in rows B-F selected automatically
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
            {seatBlock.row.includes(',') ? `Rows ${seatBlock.row}` : `Row ${seatBlock.row}`} • {optimalSeatLabels.join(', ')} ({optimalSeatLabels.length} seats)
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
          <span>Optimal block selected ({optimalSeatLabels.join(', ')})</span>
        </div>
        <div className="timeline-item done">
          <span className="step-circle">✓</span>
          <span>Seats clicked & navigated to checkout/payment tab</span>
        </div>
      </div>

      <div className="actions-cluster">
        <button
          className="primary proceed-payment-btn"
          onClick={() => handleOpenTab(tabId, bookingUrl)}
        >
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
