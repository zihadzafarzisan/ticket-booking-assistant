/**
 * Search Form Component
 *
 * Collects movie name, seat requirements, target rows (B, C, D, E, F),
 * and multiple preferred time slots (morning, afternoon, evening, night).
 */
import React, { useState } from 'react';
import { TimeSlot, TIME_SLOT_CONFIG, DEFAULT_ALLOWED_ROWS } from '../../utils/date';
import { STAR_CINEPLEX_LOCATIONS, DHAKA_LOCATION_IDS } from '../../types/cinema';

interface SearchFormProps {
  onSubmit: (params: {
    movie: string;
    seats: number;
    preferredTimes?: TimeSlot[];
    allowedRows?: string[];
    preferredLocationIds?: string[];
  }) => void;
  initialMovie?: string;
  initialSeats?: number;
  initialLocationIds?: string[];
}

const ALL_TIME_SLOTS: TimeSlot[] = ['morning', 'afternoon', 'evening', 'night'];
const ALL_TARGET_ROWS = ['B', 'C', 'D', 'E', 'F'];

export function SearchForm({
  onSubmit,
  initialMovie = '',
  initialSeats = 2,
  initialLocationIds,
}: SearchFormProps) {
  const [movie, setMovie] = useState(initialMovie);
  const [seats, setSeats] = useState(initialSeats);
  const [preferredTimes, setPreferredTimes] = useState<TimeSlot[]>(['afternoon', 'evening']);
  const [allowedRows, setAllowedRows] = useState<string[]>(['B', 'C', 'D', 'E', 'F']);
  const [preferredLocationIds, setPreferredLocationIds] = useState<string[]>(
    initialLocationIds || ['bashundhara', 'sony-square', 'sks-tower', 'shimanto-shambhar']
  );
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [date, setDate] = useState('');

  const toggleLocation = (locId: string) => {
    setPreferredLocationIds(prev => {
      if (prev.includes(locId)) {
        return prev.filter(id => id !== locId);
      } else {
        return [...prev, locId];
      }
    });
  };

  const toggleTimeSlot = (slot: TimeSlot) => {
    setPreferredTimes(prev => {
      if (prev.includes(slot)) {
        return prev.filter(s => s !== slot);
      } else {
        return [...prev, slot];
      }
    });
  };

  const toggleRow = (row: string) => {
    setAllowedRows(prev => {
      if (prev.includes(row)) {
        return prev.filter(r => r !== row);
      } else {
        return [...prev, row].sort();
      }
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (movie.trim().length === 0) return;
    onSubmit({
      movie: movie.trim(),
      seats,
      preferredTimes: preferredTimes.length > 0 ? preferredTimes : undefined,
      allowedRows: allowedRows.length > 0 ? allowedRows : DEFAULT_ALLOWED_ROWS,
      preferredLocationIds: preferredLocationIds.length > 0 ? preferredLocationIds : undefined,
    });
  };

  return (
    <form className="search-form" onSubmit={handleSubmit}>
      {/* Movie Selection */}
      <div className="form-group">
        <label htmlFor="movie">Movie</label>
        <input
          id="movie"
          type="text"
          value={movie}
          onChange={e => setMovie(e.target.value)}
          placeholder="Search movie (e.g. Avengers, Resident Evil)..."
          autoFocus
        />
        <div className="quick-suggestions">
          <span className="suggestion-label">Now Showing at Star Cineplex:</span>
          <div className="suggestion-tags">
            {['Avengers', 'Resident Evil', 'The Furious', 'Spider-Man'].map(title => (
              <button
                key={title}
                type="button"
                className="suggestion-tag"
                onClick={() => {
                  setMovie(title);
                  onSubmit({
                    movie: title,
                    seats,
                    preferredTimes: preferredTimes.length > 0 ? preferredTimes : undefined,
                    allowedRows: allowedRows.length > 0 ? allowedRows : DEFAULT_ALLOWED_ROWS,
                    preferredLocationIds: preferredLocationIds.length > 0 ? preferredLocationIds : undefined,
                  });
                }}
              >
                {title}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Seats Required */}
      <div className="form-group">
        <label htmlFor="seats">Seats required</label>
        <input
          id="seats"
          type="number"
          min={1}
          max={10}
          value={seats}
          onChange={e => setSeats(Math.max(1, parseInt(e.target.value) || 1))}
        />
      </div>

      {/* Multiple Locations Selection */}
      <div className="form-group">
        <div className="section-label-row">
          <label>Locations ({preferredLocationIds.length} selected)</label>
          <div className="quick-slot-actions">
            <button
              type="button"
              className="slot-quick-link"
              onClick={() => setPreferredLocationIds([...DHAKA_LOCATION_IDS])}
            >
              All Dhaka
            </button>
            <button
              type="button"
              className="slot-quick-link"
              onClick={() => setPreferredLocationIds(STAR_CINEPLEX_LOCATIONS.map(l => l.id))}
            >
              All Branches
            </button>
            <button
              type="button"
              className="slot-quick-link"
              onClick={() => setPreferredLocationIds([])}
            >
              Clear
            </button>
          </div>
        </div>
        <div className="location-chips-container">
          {STAR_CINEPLEX_LOCATIONS.map(loc => {
            const isSelected = preferredLocationIds.includes(loc.id);
            return (
              <button
                key={loc.id}
                type="button"
                className={`location-chip ${isSelected ? 'is-active' : ''}`}
                onClick={() => toggleLocation(loc.id)}
                title={loc.name}
              >
                <span className="loc-bullet">{isSelected ? '✓' : '+'}</span>
                <span className="loc-name">{loc.shortName}</span>
              </button>
            );
          })}
        </div>
        <p className="field-hint">
          {preferredLocationIds.length > 1
            ? `Multiple tabs will open simultaneously (one per branch) with ${seats} seats selected in each tab.`
            : preferredLocationIds.length === 1
            ? `Single branch selected. Bot will open a booking tab with ${seats} seats.`
            : 'All branches will be searched.'}
        </p>
      </div>

      {/* Target Rows Selection (B, C, D, E, F) */}
      <div className="form-group">
        <div className="section-label-row">
          <label>Target Rows</label>
          <span className="row-badge-pill">B, C, D, E, F only</span>
        </div>
        <div className="row-chips-container">
          {ALL_TARGET_ROWS.map(row => {
            const isSelected = allowedRows.includes(row);
            return (
              <button
                key={row}
                type="button"
                className={`row-chip ${isSelected ? 'is-active' : ''}`}
                onClick={() => toggleRow(row)}
                title={`Row ${row}`}
              >
                Row {row}
              </button>
            );
          })}
        </div>
        <p className="field-hint">
          Excludes front row A and back rows (e.g. L, N). Bot searches exclusively for B, C, D, E, F rows.
        </p>
      </div>

      {/* Multiple Time Slots Selection */}
      <div className="form-group">
        <div className="section-label-row">
          <label>Preferred Time Slots</label>
          <div className="quick-slot-actions">
            <button
              type="button"
              className="slot-quick-link"
              onClick={() => setPreferredTimes(['afternoon', 'evening'])}
            >
              Afternoon + Evening
            </button>
            <button
              type="button"
              className="slot-quick-link"
              onClick={() => setPreferredTimes(ALL_TIME_SLOTS)}
            >
              All Times
            </button>
          </div>
        </div>
        <div className="time-slots-container">
          {ALL_TIME_SLOTS.map(slot => {
            const cfg = TIME_SLOT_CONFIG[slot];
            const isSelected = preferredTimes.includes(slot);
            return (
              <button
                key={slot}
                type="button"
                className={`time-slot-chip ${isSelected ? 'is-active' : ''}`}
                onClick={() => toggleTimeSlot(slot)}
              >
                <span className="slot-icon">{cfg.icon}</span>
                <div className="slot-info">
                  <strong>{cfg.label}</strong>
                  <small>{cfg.desc}</small>
                </div>
              </button>
            );
          })}
        </div>
        <p className="field-hint">
          {preferredTimes.length === 0
            ? 'All showtimes will be searched.'
            : `Active slots: ${preferredTimes.map(s => TIME_SLOT_CONFIG[s].label).join(', ')}`}
        </p>
      </div>

      {/* Advanced Filters */}
      <button
        type="button"
        className="advanced-toggle"
        onClick={() => setShowAdvanced(s => !s)}
      >
        {showAdvanced ? '▲ Hide' : '▼ Show'} additional filters
      </button>

      {showAdvanced && (
        <div className="advanced-filters">
          <div className="form-group">
            <label htmlFor="search-date">Specific Date (Optional)</label>
            <input
              id="search-date"
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
            />
          </div>
        </div>
      )}

      {/* Auto-Book Submit Button */}
      <button
        type="submit"
        className="primary auto-book-submit-btn"
        disabled={movie.trim().length === 0}
      >
        ⚡ Auto-Book Available Seats
      </button>
      <p className="auto-book-helper">
        {preferredLocationIds.length > 1
          ? `Continuous seats in rows B, C, D, E, F will be booked. Multiple tabs will open for each selected branch with ${seats} seats each.`
          : `Continuous seats in rows B, C, D, E, F matching your time slots will be selected and routed to payment.`}
      </p>
    </form>
  );
}