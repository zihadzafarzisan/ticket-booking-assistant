/**
 * Seat Drop Sniper Configuration Form
 *
 * Configures automated target-date monitoring, high-frequency auto-refresh,
 * and instant seat reservation for upcoming ticket drops.
 */

import React, { useState } from 'react';
import { SniperConfig } from '../../types/sniper';
import {
  getUpcomingDateOptions,
  normalizeToIsoDate,
  TimeSlot,
  TIME_SLOT_CONFIG,
  DEFAULT_ALLOWED_ROWS,
} from '../../utils/date';
import { STAR_CINEPLEX_LOCATIONS, DHAKA_LOCATION_IDS } from '../../types/cinema';

interface SniperFormProps {
  onArmSniper: (config: SniperConfig) => void;
  initialMovie?: string;
  initialSeats?: number;
}

const ALL_TIME_SLOTS: TimeSlot[] = ['morning', 'afternoon', 'evening', 'night'];
const ALL_TARGET_ROWS = ['B', 'C', 'D', 'E', 'F'];

export function SniperForm({
  onArmSniper,
  initialMovie = '',
  initialSeats = 2,
}: SniperFormProps) {
  const [movie, setMovie] = useState(initialMovie);
  const [seats, setSeats] = useState(initialSeats);

  // Default target date: 4 days from now (e.g. 13th October if today is 9th October)
  const upcomingDates = getUpcomingDateOptions(7);
  const defaultTargetDate = upcomingDates.length > 4 ? upcomingDates[4].isoDate : upcomingDates[1].isoDate;
  const [targetDate, setTargetDate] = useState(defaultTargetDate);

  const [intervalSeconds, setIntervalSeconds] = useState(2.5);
  const [useScheduledDrop, setUseScheduledDrop] = useState(false);
  const [dropTime, setDropTime] = useState('');

  // Preferences
  const [showPreferences, setShowPreferences] = useState(false);
  const [preferredCategory, setPreferredCategory] = useState<'any' | 'regular' | 'premium' | 'vip'>('any');
  const [preferredRow, setPreferredRow] = useState<'any' | 'center' | 'back' | 'front'>('center');
  const [preferredTimes, setPreferredTimes] = useState<TimeSlot[]>(['afternoon', 'evening']);
  const [allowedRows, setAllowedRows] = useState<string[]>(['B', 'C', 'D', 'E', 'F']);
  const [preferredLocationIds, setPreferredLocationIds] = useState<string[]>(['bashundhara', 'sony-square', 'sks-tower', 'shimanto-shambhar']);
  const [autoRefreshPage, setAutoRefreshPage] = useState(true);

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
    if (!movie.trim() || !targetDate) return;

    const config: SniperConfig = {
      id: `sniper-${Date.now()}`,
      active: true,
      movieName: movie.trim(),
      targetDate: normalizeToIsoDate(targetDate),
      requiredSeats: seats,
      intervalSeconds,
      preferredCategory,
      preferredRow,
      preferredTime: preferredTimes.length === 1 ? preferredTimes[0] : 'any',
      preferredTimes: preferredTimes.length > 0 ? preferredTimes : undefined,
      allowedRows: allowedRows.length > 0 ? allowedRows : DEFAULT_ALLOWED_ROWS,
      preferredLocationIds: preferredLocationIds.length > 0 ? preferredLocationIds : undefined,
      dropTime: useScheduledDrop && dropTime ? dropTime : undefined,
      autoOpenTab: true,
      autoRefreshPage,
      createdAt: Date.now(),
    };

    onArmSniper(config);
  };

  return (
    <form className="sniper-form" onSubmit={handleSubmit}>
      <div className="sniper-intro-banner">
        <span className="sniper-badge-icon">🎯</span>
        <div>
          <h3>Seat Drop Sniper</h3>
          <p>Auto-refresh page & inventory until new seats open, then instantly grab them.</p>
        </div>
      </div>

      {/* Movie Selection */}
      <div className="form-group">
        <label htmlFor="sniper-movie">Target Movie</label>
        <input
          id="sniper-movie"
          type="text"
          value={movie}
          onChange={e => setMovie(e.target.value)}
          placeholder="Movie title (e.g. Avengers, Resident Evil)..."
          required
        />
        <div className="quick-suggestions">
          <span className="suggestion-label">Now Showing catalog:</span>
          <div className="suggestion-tags">
            {['Avengers', 'Resident Evil', 'The Furious', 'Spider-Man'].map(title => (
              <button
                key={title}
                type="button"
                className="suggestion-tag"
                onClick={() => setMovie(title)}
              >
                {title}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Target Show Date */}
      <div className="form-group">
        <label htmlFor="sniper-date">Target Show Date (Date you want to watch)</label>
        <input
          id="sniper-date"
          type="date"
          value={targetDate}
          onChange={e => setTargetDate(e.target.value)}
          required
        />
        <div className="quick-date-chips">
          {upcomingDates.slice(0, 5).map(opt => (
            <button
              key={opt.isoDate}
              type="button"
              className={`date-chip ${targetDate === opt.isoDate ? 'is-selected' : ''}`}
              onClick={() => setTargetDate(opt.isoDate)}
            >
              <span className="chip-day">{opt.label}</span>
              <span className="chip-rel">{opt.relativeLabel}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Required Seats */}
      <div className="form-group">
        <label htmlFor="sniper-seats">Seats Required (Continuous Block)</label>
        <div className="stepper-input">
          <button
            type="button"
            className="stepper-btn"
            onClick={() => setSeats(s => Math.max(1, s - 1))}
          >
            −
          </button>
          <span className="stepper-value">{seats} seat{seats > 1 ? 's' : ''} together</span>
          <button
            type="button"
            className="stepper-btn"
            onClick={() => setSeats(s => Math.min(10, s + 1))}
          >
            +
          </button>
        </div>
      </div>

      {/* Refresh Interval Selector */}
      <div className="form-group">
        <label>Auto-Refresh Speed</label>
        <div className="speed-pills">
          {[
            { sec: 2.0, label: 'Fast (2s)', hint: 'Drop imminent' },
            { sec: 2.5, label: 'Normal (2.5s)', hint: 'Recommended' },
            { sec: 5.0, label: 'Safe (5s)', hint: 'Relaxed' },
          ].map(opt => (
            <button
              key={opt.sec}
              type="button"
              className={`speed-pill ${intervalSeconds === opt.sec ? 'is-selected' : ''}`}
              onClick={() => setIntervalSeconds(opt.sec)}
            >
              <strong>{opt.label}</strong>
              <small>{opt.hint}</small>
            </button>
          ))}
        </div>
      </div>

      {/* Scheduled Start vs Start Now */}
      <div className="schedule-box">
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={useScheduledDrop}
            onChange={e => setUseScheduledDrop(e.target.checked)}
          />
          <span>Set scheduled drop time countdown</span>
        </label>
        {useScheduledDrop && (
          <div className="scheduled-time-input">
            <label htmlFor="drop-time">Drop Time (when seats release, e.g. 12:00 AM)</label>
            <input
              id="drop-time"
              type="datetime-local"
              value={dropTime}
              onChange={e => setDropTime(e.target.value)}
            />
          </div>
        )}
      </div>

      {/* Advanced Preferences Toggle */}
      <button
        type="button"
        className="advanced-toggle"
        onClick={() => setShowPreferences(s => !s)}
      >
        {showPreferences ? '▲ Hide' : '▼ Show'} seat & time preferences
      </button>

      {showPreferences && (
        <div className="advanced-filters">
          {/* Target Locations Selection */}
          <div className="form-group">
            <div className="section-label-row">
              <label>Target Branches ({preferredLocationIds.length} selected)</label>
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
                  >
                    Row {row}
                  </button>
                );
              })}
            </div>
            <p className="field-hint">
              Excludes front row A and back rows (e.g. L, N). Sniper searches strictly for B, C, D, E, F rows.
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
          </div>

          <div className="form-group">
            <label htmlFor="pref-cat">Seat Tier</label>
            <select
              id="pref-cat"
              value={preferredCategory}
              onChange={e => setPreferredCategory(e.target.value as any)}
            >
              <option value="any">Any Available Tier</option>
              <option value="regular">Regular</option>
              <option value="premium">Premium</option>
              <option value="vip">VIP</option>
            </select>
          </div>

          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={autoRefreshPage}
              onChange={e => setAutoRefreshPage(e.target.checked)}
            />
            <span>Auto-refresh cinema tab page in background</span>
          </label>
        </div>
      )}

      {/* Submit Button */}
      <button
        type="submit"
        className="primary sniper-arm-btn"
        disabled={movie.trim().length === 0 || !targetDate}
      >
        🚀 Arm Seat Drop Sniper
      </button>

      <div className="sniper-info-card">
        <strong>💡 Real-time Drop Protocol:</strong>
        <p>
          Turn this on before the drop (e.g. 11:55 PM). The extension will reload & query
          the cinema inventory every {intervalSeconds}s until {targetDate} shows drop.
          Optimal continuous seats will be reserved immediately.
        </p>
      </div>
    </form>
  );
}
