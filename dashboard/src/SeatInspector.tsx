import { useEffect, useRef } from "react";
import type { Candidate } from "../../bot/src/contracts";
import { Icon } from "./icons";
export default function SeatInspector({
  candidate,
  onClose,
}: {
  candidate: Candidate;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const grouped = new Map<string, typeof candidate.seatBlock.seats>();
  for (const seat of candidate.seatBlock.seats) {
    const seats = grouped.get(seat.row) || [];
    seats.push(seat);
    grouped.set(seat.row, seats);
  }
  return (
    <dialog
      ref={dialog}
      className="seat-dialog"
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === dialog.current) onClose();
      }}
    >
      <header className="dialog-head">
        <div>
          <span className="eyebrow">YOUR SEAT BLOCK</span>
          <h2>{candidate.showtime.movie.title}</h2>
          <p>
            {candidate.showtime.cinema.name} · {candidate.showtime.time}
          </p>
        </div>
        <button
          className="icon-button"
          aria-label="Close seat map"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </header>
      <div className="seat-content">
        <div className="screen">
          <span>SCREEN THIS WAY</span>
        </div>
        <div className="seat-rows">
          {[...grouped].map(([row, seats]) => (
            <div className="seat-row" key={row}>
              <strong>{row}</strong>
              <div>
                {[...seats]
                  .sort((a, b) => a.number - b.number)
                  .map((seat) => (
                    <span
                      title={seat.label}
                      key={seat.id}
                      className={`seat ${candidate.seatLabels.includes(seat.label) ? "chosen" : ""}`}
                    >
                      {seat.number}
                    </span>
                  ))}
              </div>
              <strong>{row}</strong>
            </div>
          ))}
        </div>
        <div className="seat-legend">
          <span>
            <i className="chosen" />
            Proposed seats
          </span>
          <span>
            <i />
            Remaining block
          </span>
        </div>
        <div className="inspector-note">
          {candidate.simulated
            ? "Simulated layout for demonstration."
            : "This is the candidate block from discovery. The bot checks actual seat states on the live page before selecting."}
        </div>
        <div className="inspector-total">
          <span>{candidate.seatLabels.join(", ")}</span>
          <strong>
            ৳
            {(
              candidate.showtime.price * candidate.seatLabels.length
            ).toLocaleString()}
          </strong>
        </div>
      </div>
    </dialog>
  );
}
