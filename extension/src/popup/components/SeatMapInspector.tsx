/**
 * Seat Map Inspector Component
 *
 * Visual interactive preview of the cinema hall layout, showing
 * the maximal continuous block and highlighted optimal seats.
 */

import React, { useEffect, useState } from 'react';
import type { RankedResult } from '../../background/service-worker';
import { selectOptimalSeats } from '../../algorithms/seat-block/index';
import type { Seat } from '../../types/seat';

interface SeatMapInspectorProps {
  result: RankedResult;
  requiredSeats: number;
  onClose: () => void;
  onBook: () => void;
}

interface RawSeatMap {
  rows: Array<[string, Seat[]]>;
  hallName: string;
  totalSeats: number;
  availableSeats: number;
}

export function SeatMapInspector({
  result,
  requiredSeats,
  onClose,
  onBook,
}: SeatMapInspectorProps) {
  const { showtime, seatBlock } = result;
  const [seatMap, setSeatMap] = useState<RawSeatMap | null>(null);
  const [loading, setLoading] = useState(true);

  const optimalSeats = React.useMemo(() => {
    return selectOptimalSeats(seatBlock, requiredSeats);
  }, [seatBlock, requiredSeats]);

  const optimalSeatIds = React.useMemo(() => {
    return new Set(optimalSeats.map(s => s.id));
  }, [optimalSeats]);

  const blockSeatIds = React.useMemo(() => {
    return new Set(seatBlock.seats.map(s => s.id));
  }, [seatBlock]);

  useEffect(() => {
    let mounted = true;
    chrome.runtime.sendMessage(
      {
        type: 'GET_SEAT_MAP',
        payload: { showtime },
      },
      response => {
        if (!mounted) return;
        setLoading(false);
        if (response && response.rows) {
          setSeatMap(response);
        }
      }
    );
    return () => {
      mounted = false;
    };
  }, [showtime]);

  return (
    <div className="seat-inspector-overlay">
      <div className="seat-inspector-modal">
        <header className="seat-inspector-header">
          <div>
            <h3>{showtime.movie.title}</h3>
            <p className="cinema-name">
              {showtime.cinema.name} • {showtime.hall.name}
            </p>
          </div>
          <button className="close-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="hall-screen-container">
          <div className="screen-bar">SCREEN</div>
        </div>

        <div className="seat-grid-container">
          {loading ? (
            <div className="loading-seats">Loading cinema hall layout...</div>
          ) : seatMap ? (
            <div className="hall-grid">
              {seatMap.rows.map(([rowLabel, seats]) => (
                <div key={rowLabel} className="hall-row">
                  <span className="row-label">{rowLabel}</span>
                  <div className="row-seats">
                    {seats.map(seat => {
                      const isOptimal = optimalSeatIds.has(seat.id);
                      const inBlock = blockSeatIds.has(seat.id);
                      const isOccupied = seat.status === 'occupied';

                      let seatClass = 'seat-cell';
                      if (isOptimal) seatClass += ' is-optimal';
                      else if (inBlock) seatClass += ' in-block';
                      else if (isOccupied) seatClass += ' is-occupied';
                      else seatClass += ' is-available';

                      return (
                        <div
                          key={seat.id}
                          className={seatClass}
                          title={`${seat.label} (${seat.category || 'Seat'})`}
                        >
                          <span className="seat-number">{seat.number}</span>
                        </div>
                      );
                    })}
                  </div>
                  <span className="row-label">{rowLabel}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="loading-seats">Could not render seat layout.</div>
          )}
        </div>

        <div className="seat-legend">
          <div className="legend-item">
            <span className="legend-swatch swatch-optimal" />
            <span>Assigned ({optimalSeats.map(s => s.label).join(', ')})</span>
          </div>
          <div className="legend-item">
            <span className="legend-swatch swatch-block" />
            <span>Continuous Block</span>
          </div>
          <div className="legend-item">
            <span className="legend-swatch swatch-available" />
            <span>Available</span>
          </div>
          <div className="legend-item">
            <span className="legend-swatch swatch-occupied" />
            <span>Occupied</span>
          </div>
        </div>

        <footer className="seat-inspector-footer">
          <button className="secondary" onClick={onClose}>
            Back
          </button>
          <button className="primary" onClick={onBook}>
            Reserve This Block →
          </button>
        </footer>
      </div>
    </div>
  );
}
