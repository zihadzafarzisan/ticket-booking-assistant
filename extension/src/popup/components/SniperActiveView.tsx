/**
 * Seat Drop Sniper Active View
 *
 * Real-time dashboard showing the active sniper state, live refresh counter,
 * countdown to drop time, activity log, and manual controls.
 */

import React, { useState, useEffect } from 'react';
import { SniperState } from '../../types/sniper';
import { formatDateDisplay, formatCountdown } from '../../utils/date';

interface SniperActiveViewProps {
  state: SniperState;
  onStop: () => void;
  onCheckNow: () => void;
  onBackToConfig: () => void;
}

export function SniperActiveView({
  state,
  onStop,
  onCheckNow,
  onBackToConfig,
}: SniperActiveViewProps) {
  const { config, status, refreshCount, logs } = state;
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  if (!config) {
    return (
      <div className="sniper-active-view">
        <p>No active sniper configuration.</p>
        <button className="primary" onClick={onBackToConfig}>Configure Sniper</button>
      </div>
    );
  }

  const isScheduled = status === 'waiting_schedule';
  const dropTimeMs = config.dropTime ? new Date(config.dropTime).getTime() : 0;
  const countdownMs = isScheduled && dropTimeMs > now ? dropTimeMs - now : 0;

  const targetDateDisplay = formatDateDisplay(config.targetDate);

  return (
    <div className="sniper-active-view">
      {/* Status Header */}
      <div className={`sniper-status-card ${isScheduled ? 'is-scheduled' : 'is-running'}`}>
        <div className="status-indicator-row">
          <div className="radar-indicator">
            <span className="radar-dot"></span>
            <span className="radar-wave"></span>
          </div>
          <div>
            <h2 className="status-heading">
              {isScheduled ? 'Scheduled Drop Countdown' : 'Sniper Active & Refreshing'}
            </h2>
            <p className="status-subheading">
              {isScheduled
                ? `Starts automatically at ${new Date(config.dropTime!).toLocaleTimeString()}`
                : `Scanning inventory every ${config.intervalSeconds}s`}
            </p>
          </div>
        </div>

        {isScheduled && countdownMs > 0 && (
          <div className="countdown-display">
            <span className="countdown-label">COUNTDOWN TO SEAT RELEASE:</span>
            <span className="countdown-digits">{formatCountdown(countdownMs)}</span>
          </div>
        )}
      </div>

      {/* Target Details Grid */}
      <div className="sniper-details-grid">
        <div className="grid-cell">
          <span className="cell-label">🎬 Movie</span>
          <span className="cell-val bold">{config.movieName}</span>
        </div>

        <div className="grid-cell highlight-date">
          <span className="cell-label">📅 Target Show Date</span>
          <span className="cell-val date-val">{targetDateDisplay}</span>
        </div>

        <div className="grid-cell">
          <span className="cell-label">💺 Required Seats</span>
          <span className="cell-val">{config.requiredSeats} continuous seats</span>
        </div>

        <div className="grid-cell highlight-refreshes">
          <span className="cell-label">⚡ Refreshes</span>
          <span className="cell-val refresh-counter">{refreshCount} checks</span>
        </div>
      </div>

      {/* Preferences summary */}
      <div className="sniper-specs-row">
        <span>Preferences:</span>
        <span className="spec-tag">Row: {config.preferredRow || 'Center'}</span>
        <span className="spec-tag">Tier: {config.preferredCategory || 'Any'}</span>
        <span className="spec-tag">Time: {config.preferredTime || 'Any'}</span>
      </div>

      {/* Live Log Console */}
      <div className="sniper-console-container">
        <div className="console-header">
          <span className="console-title">Live Activity Log</span>
          <span className="console-pulse">● LIVE</span>
        </div>
        <div className="console-body">
          {logs && logs.length > 0 ? (
            logs.slice(0, 15).map(entry => {
              const timeStr = new Date(entry.timestamp).toLocaleTimeString();
              return (
                <div key={entry.id} className={`log-entry log-${entry.type}`}>
                  <span className="log-time">[{timeStr}]</span>
                  <span className="log-msg">{entry.message}</span>
                </div>
              );
            })
          ) : (
            <div className="log-entry log-info">
              <span className="log-time">[{new Date().toLocaleTimeString()}]</span>
              <span className="log-msg">Sniper armed. Initializing first refresh...</span>
            </div>
          )}
        </div>
      </div>

      {/* Action Controls */}
      <div className="sniper-controls">
        <button
          type="button"
          className="secondary manual-check-btn"
          onClick={onCheckNow}
        >
          🔄 Refresh & Check Now
        </button>

        <button
          type="button"
          className="primary disarm-sniper-btn"
          onClick={onStop}
        >
          🛑 Stop / Disarm Sniper
        </button>
      </div>

      <p className="sniper-footer-hint">
        💡 You can leave this running. When seats open, they will be selected automatically and routed to payment with an audio alert.
      </p>
    </div>
  );
}
