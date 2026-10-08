/**
 * Result Card Component
 *
 * Displays a single ranked ticket option.
 */
import React from 'react';
import type { RankedResult } from '../../background/service-worker';

interface ResultCardProps {
  result: RankedResult;
  isBest: boolean;
}

const FORMAT_LABELS: Record<string, string> = {
  imax: 'IMAX',
  dolby_atmos: 'Dolby Atmos',
  '4dx': '4DX',
  premium: 'Premium',
  '3d': '3D',
  standard: 'Standard',
};

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function formatTime(timeStr: string): string {
  const [hours, minutes] = timeStr.split(':').map(Number);
  const date = new Date();
  date.setHours(hours, minutes);
  return date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatPrice(price: number): string {
  return `৳${price.toLocaleString()}`;
}

export function ResultCard({ result, isBest }: ResultCardProps) {
  const { showtime, seatBlock, overallScore } = result;

  const handleQuickBook = () => {
    // Open the booking page directly
    if (showtime.bookingUrl) {
      chrome.tabs.create({ url: showtime.bookingUrl });
    }
  };

  return (
    <article className={`result-card${isBest ? ' is-best' : ''}`}>
      {isBest && <div className="best-badge">⭐ Best match</div>}

      <header className="result-header">
        <div>
          <h3 className="movie-title">{showtime.movie.title}</h3>
          <p className="cinema-name">
            {showtime.cinema.name} — {showtime.cinema.location}
          </p>
        </div>
        <div className="price-tag">
          {formatPrice(showtime.price)}
          <span className="per-seat">/ seat</span>
        </div>
      </header>

      <dl className="result-meta">
        <div>
          <dt>Format</dt>
          <dd>{FORMAT_LABELS[showtime.screenType] || showtime.screenType}</dd>
        </div>
        <div>
          <dt>Date & time</dt>
          <dd>{formatDate(showtime.date)} • {formatTime(showtime.time)}</dd>
        </div>
        <div>
          <dt>Hall</dt>
          <dd>{showtime.hall.name}</dd>
        </div>
      </dl>

      <div className="seat-block-info">
        <strong>Row {seatBlock.row} • {seatBlock.startSeat}–{seatBlock.endSeat}</strong>
        <span>{seatBlock.capacity} consecutive seats available</span>
      </div>

      <p className="reasoning">{result.reasoning}</p>

      <footer className="result-actions">
        <button className="primary" onClick={handleQuickBook}>
          Book now
        </button>
        <span className="score">Score {Math.round(overallScore * 100)}</span>
      </footer>
    </article>
  );
}