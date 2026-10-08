/**
 * Results Grid Component
 *
 * Shows ranked ticket options as cards.
 */
import React from 'react';
import type { RankedResult } from '../../background/service-worker';
import { ResultCard } from './ResultCard';

interface ResultsGridProps {
  results: RankedResult[];
  requiredSeats: number;
  onBack: () => void;
}

type SortKey = 'best' | 'seats' | 'price' | 'time';

export function ResultsGrid({ results, requiredSeats, onBack }: ResultsGridProps) {
  const [sortKey, setSortKey] = React.useState<SortKey>('best');

  const sorted = React.useMemo(() => {
    const copy = [...results];
    switch (sortKey) {
      case 'best':
        return copy.sort((a, b) => b.overallScore - a.overallScore);
      case 'seats':
        return copy.sort((a, b) => b.seatBlock.centerScore - a.seatBlock.centerScore);
      case 'price':
        return copy.sort((a, b) => a.showtime.price - b.showtime.price);
      case 'time':
        return copy.sort((a, b) => a.showtime.time.localeCompare(b.showtime.time));
      default:
        return copy;
    }
  }, [results, sortKey]);

  return (
    <div className="results">
      <div className="results-header">
        <div>
          <h2>{results.length} option{results.length > 1 ? 's' : ''} found</h2>
          <span className="results-count">
            for {requiredSeats} seat{requiredSeats > 1 ? 's' : ''}
          </span>
        </div>
        <div className="sort-row">
          <label htmlFor="sort">Sort</label>
          <select
            id="sort"
            value={sortKey}
            onChange={e => setSortKey(e.target.value as SortKey)}
          >
            <option value="best">Best match</option>
            <option value="seats">Best seats</option>
            <option value="price">Cheapest</option>
            <option value="time">Earliest</option>
          </select>
        </div>
      </div>

      <div className="results-grid">
        {sorted.map((result, index) => (
          <ResultCard
            key={`${result.showtime.id}-${result.seatBlock.id}`}
            result={result}
            isBest={index === 0}
          />
        ))}
      </div>

      <button className="secondary" onClick={onBack}>
        ← New search
      </button>
    </div>
  );
}