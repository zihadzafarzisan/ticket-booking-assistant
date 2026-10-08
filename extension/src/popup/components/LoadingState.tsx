/**
 * Loading State Component
 */
import React from 'react';

interface LoadingStateProps {
  movie: string;
  seats: number;
}

export function LoadingState({ movie, seats }: LoadingStateProps) {
  const steps = [
    'Searching cinemas...',
    'Finding showtimes...',
    'Analyzing seat maps...',
    'Detecting available blocks...',
    'Ranking best options...',
  ];

  return (
    <div className="loading">
      <div className="spinner" />
      <h2>Finding tickets for "{movie}"</h2>
      <p className="seats-requested">
        Looking for {seats} seat{seats > 1 ? 's' : ''} together
      </p>
      <ul className="progress-list">
        {steps.map(step => (
          <li key={step} className="progress-item">
            <span className="progress-dot">{step}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}