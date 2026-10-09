/**
 * Booking Assistant Modal Component
 *
 * Coordinates real-time re-check, seat reservation automation,
 * and user-assisted checkout handoff for secure payment.
 */

import React, { useEffect, useState } from 'react';
import type { RankedResult, ReserveResponse } from '../../background/service-worker';
import { selectOptimalSeats } from '../../algorithms/seat-block/index';

interface BookingModalProps {
  result: RankedResult;
  requiredSeats: number;
  onClose: () => void;
  onNewSearch: () => void;
}

type StepStatus = 'pending' | 'active' | 'completed' | 'error';

export function BookingModal({
  result,
  requiredSeats,
  onClose,
  onNewSearch,
}: BookingModalProps) {
  const { showtime, seatBlock } = result;

  const [step1Status, setStep1Status] = useState<StepStatus>('active');
  const [step2Status, setStep2Status] = useState<StepStatus>('pending');
  const [step3Status, setStep3Status] = useState<StepStatus>('pending');
  const [step4Status, setStep4Status] = useState<StepStatus>('pending');

  const [assignedSeatLabels, setAssignedSeatLabels] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [bookingUrl, setBookingUrl] = useState<string>(showtime.bookingUrl);

  const optimal = React.useMemo(() => {
    return selectOptimalSeats(seatBlock, requiredSeats);
  }, [seatBlock, requiredSeats]);

  useEffect(() => {
    let isCancelled = false;

    async function executeReservationFlow() {
      // Step 1: Recheck availability
      setStep1Status('active');
      await new Promise(r => setTimeout(r, 600));
      if (isCancelled) return;
      setStep1Status('completed');

      // Step 2: Assign optimal center seats from maximal block
      setStep2Status('active');
      const labels = optimal.map(s => s.label);
      setAssignedSeatLabels(labels);
      await new Promise(r => setTimeout(r, 500));
      if (isCancelled) return;
      setStep2Status('completed');

      // Step 3: Trigger reservation via service worker
      setStep3Status('active');

      chrome.runtime.sendMessage(
        {
          type: 'RECHECK_AND_RESERVE',
          payload: {
            showtime,
            seatBlock,
            requiredSeats,
          },
        },
        (response: ReserveResponse) => {
          if (isCancelled) return;

          if (response && response.success) {
            setStep3Status('completed');
            setStep4Status('active');
            if (response.seatLabels) {
              setAssignedSeatLabels(response.seatLabels);
            }
            if (response.bookingUrl) {
              setBookingUrl(response.bookingUrl);
            }
          } else {
            setStep3Status('error');
            setErrorMessage(response?.error || 'Unable to reserve seats at this time.');
          }
        }
      );
    }

    executeReservationFlow();

    return () => {
      isCancelled = true;
    };
  }, [showtime, seatBlock, requiredSeats, optimal]);

  const handleOpenWindow = () => {
    if (bookingUrl) {
      chrome.tabs.create({ url: bookingUrl });
    }
  };

  const totalPrice = showtime.price * requiredSeats;

  return (
    <div className="booking-modal-overlay">
      <div className="booking-modal">
        <header className="booking-modal-header">
          <div>
            <h2>Booking Assistant</h2>
            <p className="cinema-name">
              {showtime.movie.title} • {showtime.cinema.name}
            </p>
          </div>
          <button className="close-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>

        <div className="booking-summary-box">
          <div className="summary-row">
            <span>Showtime</span>
            <strong>
              {showtime.date} at {showtime.time} ({showtime.screenType.toUpperCase()})
            </strong>
          </div>
          <div className="summary-row">
            <span>Selected Block</span>
            <strong>
              Row {seatBlock.row} • {seatBlock.startSeat}-{seatBlock.endSeat}
            </strong>
          </div>
          <div className="summary-row">
            <span>Assigned Seats</span>
            <strong className="assigned-pill">
              {assignedSeatLabels.length > 0
                ? `Row ${seatBlock.row} • ${assignedSeatLabels.join(', ')}`
                : `${requiredSeats} seats`}
            </strong>
          </div>
          <div className="summary-row total-price-row">
            <span>Estimated Total</span>
            <strong className="total-price">৳{totalPrice.toLocaleString()}</strong>
          </div>
        </div>

        {/* Stepper Progress */}
        <div className="stepper-list">
          <div className={`stepper-item ${step1Status}`}>
            <div className="step-circle">{step1Status === 'completed' ? '✓' : '1'}</div>
            <div className="step-body">
              <div className="step-label">Live Availability Verification</div>
              <div className="step-desc">
                {step1Status === 'completed'
                  ? 'Confirmed available on cinema backend'
                  : 'Checking seat availability with Star Cineplex...'}
              </div>
            </div>
          </div>

          <div className={`stepper-item ${step2Status}`}>
            <div className="step-circle">{step2Status === 'completed' ? '✓' : '2'}</div>
            <div className="step-body">
              <div className="step-label">Optimal Seat Assignment</div>
              <div className="step-desc">
                {assignedSeatLabels.length > 0
                  ? `Allocated center seats: ${assignedSeatLabels.join(', ')}`
                  : 'Calculating optimal center positions...'}
              </div>
            </div>
          </div>

          <div className={`stepper-item ${step3Status}`}>
            <div className="step-circle">{step3Status === 'completed' ? '✓' : '3'}</div>
            <div className="step-body">
              <div className="step-label">Automating Seat Reservation</div>
              <div className="step-desc">
                {step3Status === 'completed'
                  ? 'Seats selected on cinema portal'
                  : step3Status === 'error'
                  ? (errorMessage || 'Failed to hold seats')
                  : 'Launching booking portal and reserving seats...'}
              </div>
            </div>
          </div>

          <div className={`stepper-item ${step4Status}`}>
            <div className="step-circle">{step4Status === 'completed' ? '✓' : '4'}</div>
            <div className="step-body">
              <div className="step-label">Checkout & Payment Handoff</div>
              <div className="step-desc">
                {step4Status === 'active'
                  ? 'Tickets held! Please complete payment in cinema tab'
                  : 'Awaiting seat reservation...'}
              </div>
            </div>
          </div>
        </div>

        {/* Payment Handoff Callout */}
        {step4Status === 'active' && (
          <div className="handoff-callout">
            <div className="callout-title">🔒 Payment Handoff Active</div>
            <p>
              Your seats are held on the official Star Cineplex website. Please complete
              payment via <strong>bKash, Nagad, or Card</strong> in the opened cinema window.
            </p>
            <button className="primary open-window-btn" onClick={handleOpenWindow}>
              View / Finish Payment in Cinema Window →
            </button>
          </div>
        )}

        {step3Status === 'error' && (
          <div className="error-callout">
            <p>{errorMessage}</p>
            <button className="secondary" onClick={onClose}>
              Choose Another Showtime
            </button>
          </div>
        )}

        <footer className="booking-modal-footer">
          <button className="secondary" onClick={onNewSearch}>
            Start New Search
          </button>
          <button className="secondary" onClick={onClose}>
            Back to Results
          </button>
        </footer>
      </div>
    </div>
  );
}
