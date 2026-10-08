/**
 * Main Application Component
 *
 * Manages the discovery flow state and renders the appropriate view.
 */
import React, { useState } from 'react';
import { SearchForm } from './components/SearchForm';
import { ResultsGrid } from './components/ResultsGrid';
import { LoadingState } from './components/LoadingState';
import type { RankedResult } from '../background/service-worker';

type ViewState = 'search' | 'loading' | 'results' | 'error';

interface SearchParams {
  movie: string;
  seats: number;
}

export default function App() {
  const [view, setView] = useState<ViewState>('search');
  const [results, setResults] = useState<RankedResult[]>([]);
  const [lastSearch, setLastSearch] = useState<SearchParams>({ movie: '', seats: 2 });

  /**
   * Send discovery request to service worker
   */
  const runDiscovery = async (params: SearchParams) => {
    setLastSearch(params);
    setView('loading');

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'DISCOVER',
        request: {
          movieName: params.movie,
          requiredSeats: params.seats,
          criteria: {},
        },
      });

      if (response?.results) {
        setResults(response.results);
        setView(response.results.length > 0 ? 'results' : 'error');
      } else {
        setResults([]);
        setView('error');
      }
    } catch (error) {
      console.error('Discovery failed:', error);
      setResults([]);
      setView('error');
    }
  };

  const reset = () => setView('search');

  return (
    <div className="app">
      <header className="app-header">
        <h1>🎬 Movie Tickets</h1>
        <p className="tagline">Find the best seats across cinemas in seconds</p>
      </header>

      <main>
        {view === 'loading' && (
          <LoadingState movie={lastSearch.movie} seats={lastSearch.seats} />
        )}

        {view === 'error' && (
          <div className="error-state">
            <p>No tickets found for "{lastSearch.movie}".</p>
            <button onClick={reset}>← Try again</button>
          </div>
        )}

        {view === 'results' && (
          <ResultsGrid
            results={results}
            requiredSeats={lastSearch.seats}
            onBack={reset}
          />
        )}

        {view === 'search' && (
          <SearchForm
            onSubmit={runDiscovery}
            initialMovie={lastSearch.movie}
            initialSeats={lastSearch.seats}
          />
        )}
      </main>

      <footer className="app-footer">
        <span>Results appear as they're discovered across supported cinemas.</span>
      </footer>
    </div>
  );
}