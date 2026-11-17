import { TIME_SLOT_CONFIG, type TimeSlot } from "../../packages/core/src";

export default function BookingPreferences({
  allowedRows,
  preferredTimes,
  onRowsChange,
  onTimesChange,
}: {
  allowedRows: string[];
  preferredTimes: TimeSlot[];
  onRowsChange(rows: string[]): void;
  onTimesChange(times: TimeSlot[]): void;
}) {
  return (
    <>
      <section className="field" aria-label="Preferred showtimes">
        <div className="label-row">
          <span>Preferred showtimes</span>
          <button
            type="button"
            className="text-button"
            onClick={() => onTimesChange([])}
          >
            Any time
          </button>
        </div>
        <div className="slot-choices">
          {(Object.keys(TIME_SLOT_CONFIG) as TimeSlot[]).map((slot) => (
            <button
              type="button"
              key={slot}
              aria-pressed={preferredTimes.includes(slot)}
              className={`choice ${preferredTimes.includes(slot) ? "selected" : ""}`}
              onClick={() =>
                onTimesChange(
                  preferredTimes.includes(slot)
                    ? preferredTimes.filter((time) => time !== slot)
                    : [...preferredTimes, slot],
                )
              }
            >
              {TIME_SLOT_CONFIG[slot].label}
              <small>{TIME_SLOT_CONFIG[slot].desc}</small>
            </button>
          ))}
        </div>
        <small>
          {preferredTimes.length
            ? "Only selected time slots will be searched. Times are in Dhaka time."
            : "Any showtime. Times are in Dhaka time."}
        </small>
      </section>
      <section className="field" aria-label="Seat rows">
        <div className="label-row">
          <span>Seat rows</span>
          <button
            type="button"
            className="text-button"
            onClick={() => onRowsChange([])}
          >
            Any row
          </button>
        </div>
        <div className="row-choices">
          {["A", "B", "C", "D", "E", "F", "G", "H", "J", "K", "L", "M", "N"]
            .concat(allowedRows)
            .filter((row, index, rows) => rows.indexOf(row) === index)
            .map((row) => (
              <button
                key={row}
                type="button"
                aria-pressed={allowedRows.includes(row)}
                className={`choice ${allowedRows.includes(row) ? "selected" : ""}`}
                onClick={() =>
                  onRowsChange(
                    allowedRows.includes(row)
                      ? allowedRows.filter((value) => value !== row)
                      : [...allowedRows, row],
                  )
                }
              >
                {row}
              </button>
            ))}
        </div>
        <small>
          {allowedRows.length
            ? "Only selected rows will be used. Row availability is verified in your browser."
            : "Any available row. Row availability is verified in your browser."}
        </small>
      </section>
    </>
  );
}
