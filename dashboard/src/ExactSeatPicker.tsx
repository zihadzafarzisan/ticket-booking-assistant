import { useEffect, useState } from "react";
import { Icon } from "./icons";
import {
  SEAT_COLUMNS,
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

  useEffect(() => {
    setText((current) =>
      parseTargetSeatsInput(current).join(",") === targetSeatsKey
        ? current
        : targetSeats.join(", "),
    );
  }, [targetSeatsKey, targetSeats]);

  const toggleSeat = (label: string) => {
    const next = targetSeats.includes(label)
      ? targetSeats.filter((seat) => seat !== label)
      : [...targetSeats, label];
    onTargetSeatsChange(next);
  };

  const handleTextChange = (raw: string) => {
    setText(raw);
    const parsed = parseTargetSeatsInput(raw);
    if (parsed.join(",") !== targetSeats.join(",")) {
      onTargetSeatsChange(parsed);
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
          {targetSeats.length > 0 && (
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setText("");
                onTargetSeatsChange([]);
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
        {targetSeats.length > 0 && (
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
          {targetSeats.length > 0
            ? `${targetSeats.length} exact seat${targetSeats.length === 1 ? "" : "s"} locked in (${targetSeats.join(", ")}). Seat count synced automatically.`
            : "Leave blank to let the bot pick the best available seats in your preferred rows."}
        </small>
      </div>

      <div className="seat-picker-map" role="group" aria-label="Interactive seat map">
        <div className="seat-picker-screen">
          <span>SCREEN THIS WAY</span>
        </div>
        <div className="seat-picker-scroll">
          <div className="seat-picker-grid">
            {SEAT_ROWS.map((row) => (
              <div className="seat-picker-row" key={row}>
                <span className="seat-picker-row-label" aria-hidden="true">
                  {row}
                </span>
                <div className="seat-picker-cells">
                  {SEAT_COLUMNS.map((col) => {
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
                        className={`seat-picker-cell ${selected ? "selected" : ""} ${col === 7 ? "aisle-after" : ""}`}
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
            Tap any seat A1–P14
          </span>
        </div>
      </div>

      <div className="sniper-toggles">
        <label className="check-row">
          <input
            type="checkbox"
            data-testid="exact-seats-only-toggle"
            checked={exactSeatsOnly}
            onChange={(e) => onExactSeatsOnlyChange(e.target.checked)}
          />
          <span>
            <strong>
              {exactSeatsOnly
                ? "Exact seats only (strict)"
                : "Fallback to best available contiguous seats"}
            </strong>
            <small>
              {exactSeatsOnly
                ? "Only accept your exact selected seats. If any seat is taken mid-click, roll back cleanly and keep retrying."
                : "Try your exact seats first; if unavailable, automatically grab the best contiguous block in your preferred rows."}
            </small>
            {exactSeatsOnly &&
              targetSeats.length > 0 &&
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
