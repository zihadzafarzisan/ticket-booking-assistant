import { useEffect, useState } from "react";
import { Icon } from "./icons";
import {
  SEAT_PICKER_COLS,
  SEAT_ROWS,
  parseTargetSeatsInput,
} from "./types";

export default function ExactSeatPicker({
  targetSeats,
  exactSeatsOnly,
  refreshBrowserPage,
  showRefreshToggle = true,
  requiredSeats,
  onTargetSeatsChange,
  onExactSeatsOnlyChange,
  onRefreshBrowserPageChange,
}: {
  targetSeats: string[];
  exactSeatsOnly: boolean;
  refreshBrowserPage: boolean;
  showRefreshToggle?: boolean;
  requiredSeats: number;
  onTargetSeatsChange(seats: string[]): void;
  onExactSeatsOnlyChange(exactOnly: boolean): void;
  onRefreshBrowserPageChange(enabled: boolean): void;
}) {
  const [text, setText] = useState(() => targetSeats.join(", "));
  const targetSeatsKey = targetSeats.join(",");
  const hasTargetSeats = targetSeats.length > 0;

  useEffect(() => {
    setText((current) =>
      parseTargetSeatsInput(current).join(",") === targetSeatsKey
        ? current
        : targetSeatsKey
          ? targetSeatsKey.split(",").join(", ")
          : "",
    );
  }, [targetSeatsKey]);

  useEffect(() => {
    if (!hasTargetSeats && exactSeatsOnly) {
      onExactSeatsOnlyChange(false);
    }
  }, [hasTargetSeats, exactSeatsOnly, onExactSeatsOnlyChange]);

  const toggleSeat = (label: string) => {
    const next = targetSeats.includes(label)
      ? targetSeats.filter((seat) => seat !== label)
      : [...targetSeats, label];
    onTargetSeatsChange(next);
    if (next.length === 0 && exactSeatsOnly) {
      onExactSeatsOnlyChange(false);
    }
  };

  const handleTextChange = (raw: string) => {
    setText(raw);
    const parsed = parseTargetSeatsInput(raw);
    if (parsed.join(",") !== targetSeatsKey) {
      onTargetSeatsChange(parsed);
      if (parsed.length === 0 && exactSeatsOnly) {
        onExactSeatsOnlyChange(false);
      }
    }
  };

  const handleTextBlur = () => {
    setText(targetSeats.join(", "));
  };

  return (
    <section className="exact-seat-section" aria-label="Exact seat selection">
      <div className="field">
        <div className="label-row">
          <label htmlFor="target-seats-text">
            Exact target seats <span className="muted">(optional · e.g. E5, E6)</span>
          </label>
          {hasTargetSeats && (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setText("");
                onTargetSeatsChange([]);
                if (exactSeatsOnly) {
                  onExactSeatsOnlyChange(false);
                }
              }}
            >
              Clear seats
            </button>
          )}
        </div>
        <input
          id="target-seats-text"
          data-testid="target-seats-input"
          type="text"
          placeholder="Type seats like E5, E6 or pick from the map below"
          value={text}
          onChange={(e) => handleTextChange(e.target.value)}
          onBlur={handleTextBlur}
        />
        {hasTargetSeats && (
          <div className="seat-chip-list" aria-label="Selected target seats">
            {targetSeats.map((seat) => (
              <span className="seat-chip" key={seat}>
                {seat}
                <button
                  type="button"
                  aria-label={`Remove seat ${seat}`}
                  onClick={() => toggleSeat(seat)}
                >
                  <Icon name="close" size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
        <small>
          {hasTargetSeats
            ? `${targetSeats.length} exact seat${targetSeats.length === 1 ? "" : "s"} locked in (${targetSeats.join(", ")}). Seat count synced automatically.`
            : "Leave blank to let the bot pick the best available seats in your preferred rows."}
        </small>
      </div>

      <div className="seat-picker-map" role="group" aria-label="Interactive seat map">
        <div className="seat-picker-header">
          <span className="seat-category-bar">STAR CINEPLEX HALL LAYOUT · ROWS A–P</span>
          <span className="seat-picker-count">
            {targetSeats.length} selected
          </span>
        </div>
        <div className="seat-picker-screen">
          <div className="screen-trapezoid">
            <span>SCREEN THIS WAY</span>
          </div>
        </div>
        <div className="seat-picker-scroll seat-picker-grid-wrap">
          <div className="seat-picker-grid">
            {SEAT_ROWS.map((row) => (
              <div className="seat-picker-row" key={row}>
                <span className="seat-picker-row-label" aria-hidden="true">
                  {row}
                </span>
                <div className="seat-picker-cells">
                  {SEAT_PICKER_COLS.map((col) => {
                    const label = `${row}${col}`;
                    const selected = targetSeats.includes(label);
                    return (
                      <button
                        key={label}
                        type="button"
                        data-testid={`seat-picker-cell-${label}`}
                        aria-label={`Seat ${label}`}
                        aria-pressed={selected}
                        title={label}
                        className={`seat-picker-cell ${selected ? "selected" : ""} ${col === 8 ? "aisle-after" : ""}`}
                        onClick={() => toggleSeat(label)}
                      >
                        {col}
                      </button>
                    );
                  })}
                </div>
                <span className="seat-picker-row-label" aria-hidden="true">
                  {row}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="seat-picker-legend">
          <span>
            <i className="selected" />
            Target seat ({targetSeats.length})
          </span>
          <span>
            <i />
            Tap any seat A1–P16
          </span>
          <span>
            <i className="occupied" />
            Occupied (live check)
          </span>
        </div>
      </div>

      <div className="sniper-toggles">
        <label className={`check-row ${!hasTargetSeats ? "is-disabled" : ""}`}>
          <input
            type="checkbox"
            data-testid="exact-seats-only-toggle"
            disabled={!hasTargetSeats}
            checked={hasTargetSeats && exactSeatsOnly}
            onChange={(e) =>
              onExactSeatsOnlyChange(hasTargetSeats ? e.target.checked : false)
            }
          />
          <span>
            <strong>
              {hasTargetSeats && exactSeatsOnly
                ? "Exact seats only (strict)"
                : "Fallback to best available contiguous seats"}
            </strong>
            <small>
              {!hasTargetSeats
                ? "Select at least 1 exact seat above to enable strict exact-only mode."
                : exactSeatsOnly
                  ? "Only accept your exact selected seats. If any seat is taken mid-click, roll back cleanly and keep retrying."
                  : "Try your exact seats first; if unavailable, automatically grab the best contiguous block in your preferred rows."}
            </small>
            {hasTargetSeats &&
              exactSeatsOnly &&
              targetSeats.length < requiredSeats && (
                <small className="toggle-warn">
                  Select at least {requiredSeats} exact seat
                  {requiredSeats === 1 ? "" : "s"} or lower seat count.
                </small>
              )}
          </span>
        </label>

        {showRefreshToggle && (
          <label className="check-row">
            <input
              type="checkbox"
              data-testid="refresh-browser-page-toggle"
              checked={refreshBrowserPage}
              onChange={(e) => onRefreshBrowserPageChange(e.target.checked)}
            />
            <span>
              <strong>Live Cineplex page refresh (1s)</strong>
              <small>
                Keep a pre-warmed Cineplex tab refreshing every 1 second
                alongside API checks for instant ticket-drop detection.
              </small>
            </span>
          </label>
        )}
      </div>
    </section>
  );
}
