/**
 * Search Form Component
 *
 * Collects movie name and seat requirements from the user.
 */
import React, { useState } from 'react';

interface SearchFormProps {
  onSubmit: (params: { movie: string; seats: number }) => void;
  initialMovie?: string;
  initialSeats?: number;
}

export function SearchForm({ onSubmit, initialMovie = '', initialSeats = 2 }: SearchFormProps) {
  const [movie, setMovie] = useState(initialMovie);
  const [seats, setSeats] = useState(initialSeats);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (movie.trim().length === 0) return;
    onSubmit({ movie: movie.trim(), seats });
  };

  return (
    <form className="search-form" onSubmit={handleSubmit}>
      <div className="form-group">
        <label htmlFor="movie">Movie</label>
        <input
          id="movie"
          type="text"
          value={movie}
          onChange={e => setMovie(e.target.value)}
          placeholder="Search movie..."
          autoFocus
        />
      </div>

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

      <button
        type="button"
        className="advanced-toggle"
        onClick={() => setShowAdvanced(s => !s)}
      >
        {showAdvanced ? '▲ Hide' : '▼ Show'} advanced filters
      </button>

      {showAdvanced && (
        <div className="advanced-filters">
          <div className="form-group">
            <label htmlFor="date">Date</label>
            <input id="date" type="date" />
          </div>
          <div className="form-group">
            <label htmlFor="time">Preferred time</label>
            <select id="time" defaultValue="any">
              <option value="any">Any</option>
              <option value="morning">Morning</option>
              <option value="afternoon">Afternoon</option>
              <option value="evening">Evening</option>
            </select>
          </div>
        </div>
      )}

      <button
        type="submit"
        className="primary"
        disabled={movie.trim().length === 0}
      >
        Find Tickets
      </button>
    </form>
  );
}