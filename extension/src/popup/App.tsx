/**
 * Main Application Component
 *
 * Manages the discovery flow, continuous block results, visual hall inspection,
 * instant booking assistant, and the high-frequency Seat Drop Sniper system.
 */
import React, { useState, useEffect } from 'react';
import { SearchForm } from './components/SearchForm';
import { ResultsGrid } from './components/ResultsGrid';
import { LoadingState } from './components/LoadingState';
import { BookingModal } from './components/BookingModal';
import { SeatMapInspector } from './components/SeatMapInspector';
import { AutoBookedView } from './components/AutoBookedView';
import { SniperForm } from './components/SniperForm';
import { SniperActiveView } from './components/SniperActiveView';
import type { RankedResult, SniperConfig, SniperState } from '../types/sniper';
import type { TimeSlot } from '../utils/date';

type ViewState = 'search' | 'loading' | 'results' | 'auto_booked' | 'error';
type AppTab = 'instant' | 'sniper';

interface SearchParams {
  movie: string;
  seats: number;
  preferredTimes?: TimeSlot[];
  allowedRows?: string[];
}

interface AutoBookedPayload {
  result: RankedResult;
  optimalSeatLabels: string[];
  bookingUrl: string;
  tabId?: number;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<AppTab>('instant');
  const [view, setView] = useState<ViewState>('search');
  const [results, setResults] = useState<RankedResult[]>([]);
  const [lastSearch, setLastSearch] = useState<SearchParams>({ movie: '', seats: 2 });
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [autoBookedData, setAutoBookedData] = useState<AutoBookedPayload | null>(null);

  // Seat Drop Sniper State
  const [sniperState, setSniperState] = useState<SniperState>({
    config: null,
    status: 'idle',
    refreshCount: 0,
    lastCheckTime: 0,
    logs: [],
  });

  // Modals
  const [selectedForBooking, setSelectedForBooking] = useState<RankedResult | null>(null);
  const [inspectingResult, setInspectingResult] = useState<RankedResult | null>(null);

  const isPopout = typeof window !== 'undefined' && window.location.search.includes('window=1');

  /**
   * Helper to send messages with timeout and runtime.lastError safety
   */
  const sendMessageWithTimeout = <T,>(message: any, timeoutMs = 15000): Promise<T> => {
    return new Promise((resolve, reject) => {
      let resolved = false;
      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          reject(new Error('Operation timed out. Please check your network connection and try again.'));
        }
      }, timeoutMs);

      try {
        chrome.runtime.sendMessage(message, (response: T) => {
          if (resolved) return;
          resolved = true;
          clearTimeout(timer);
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      } catch (err) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          reject(err);
        }
      }
    });
  };

  /**
   * Refresh and start over: stops active bot, clears state & storage, returns to search
   */
  const handleRefreshAndStartOver = async () => {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime) {
        await sendMessageWithTimeout<any>({ type: 'RESET_AND_START_OVER' }, 4000);
      }
    } catch (err) {
      console.warn('[Movie Assistant] Reset message error:', err);
    }

    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      try {
        await chrome.storage.local.remove(['lastAutoBooked', 'sniperState', 'pendingReservation']);
      } catch {}
    }

    setSelectedForBooking(null);
    setInspectingResult(null);
    setAutoBookedData(null);
    setResults([]);
    setErrorMessage('');
    setView('search');
    setActiveTab('instant');
    setSniperState({
      config: null,
      status: 'idle',
      refreshCount: 0,
      lastCheckTime: 0,
      logs: [],
    });
  };

  // Listen for popout window closing to stop background tasks
  useEffect(() => {
    if (!isPopout) return;

    const handleUnload = () => {
      try {
        chrome.runtime.sendMessage({ type: 'POPOUT_CLOSED' });
      } catch {}
    };

    window.addEventListener('beforeunload', handleUnload);
    window.addEventListener('pagehide', handleUnload);
    return () => {
      window.removeEventListener('beforeunload', handleUnload);
      window.removeEventListener('pagehide', handleUnload);
    };
  }, [isPopout]);

  /**
   * Sync sniper state on mount and subscribe to updates
   */
  useEffect(() => {
    // If the popout window was reloaded/refreshed (e.g. F5, Ctrl+R), start over clean!
    const isReload = (() => {
      try {
        const navEntries = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
        if (navEntries.length > 0) {
          return navEntries[0].type === 'reload';
        }
        return (performance as any)?.navigation?.type === 1;
      } catch {
        return false;
      }
    })();

    if (isPopout && isReload) {
      console.log('[Movie Assistant] Popout refreshed by user. Starting over clean.');
      handleRefreshAndStartOver();
      return;
    }

    if (typeof chrome !== 'undefined' && chrome.runtime) {
      // Query current background sniper state
      sendMessageWithTimeout<SniperState>({ type: 'GET_SNIPER_STATE' }, 3000)
        .then(state => {
          if (state && state.config) {
            setSniperState(state);
            if (state.config.active) {
              setActiveTab('sniper');
            }
            if (state.status === 'booked' && state.result) {
              setAutoBookedData({
                result: state.result,
                optimalSeatLabels: state.bookedSeats || [],
                bookingUrl: state.bookingUrl || state.result.showtime.bookingUrl,
                tabId: state.targetTabId,
              });
              setView('auto_booked');
            }
          }
        })
        .catch(() => {});

      // Check if an auto-booking was completed while popup was closed
      chrome.storage.local.get('lastAutoBooked').then(data => {
        const last = data?.lastAutoBooked;
        if (last?.reservation?.success && last.result && Date.now() - (last.timestamp || 0) < 300000) {
          setAutoBookedData({
            result: last.result,
            optimalSeatLabels: last.reservation.seatLabels || [],
            bookingUrl: last.reservation.bookingUrl || last.result.showtime.bookingUrl,
            tabId: last.reservation.tabId,
          });
          setView('auto_booked');
        }
      }).catch(() => {});

      // Listen for real-time sniper state updates
      const listener = (msg: any) => {
        if (msg?.type === 'SNIPER_STATE_CHANGED' && msg.payload) {
          const updated: SniperState = msg.payload;
          setSniperState(updated);
          if (updated.status === 'booked' && updated.result) {
            setAutoBookedData({
              result: updated.result,
              optimalSeatLabels: updated.bookedSeats || [],
              bookingUrl: updated.bookingUrl || updated.result.showtime.bookingUrl,
              tabId: updated.targetTabId,
            });
            setView('auto_booked');
          }
        }
      };

      chrome.runtime.onMessage.addListener(listener);
      return () => chrome.runtime.onMessage.removeListener(listener);
    }
  }, []);

  /**
   * Send discovery request to service worker with full background auto-reservation
   * so it completes even if the user clicks outside or closes the popup.
   */
  const runDiscovery = async (params: SearchParams) => {
    setLastSearch(params);
    setErrorMessage('');
    setAutoBookedData(null);
    setView('loading');
    setSelectedForBooking(null);
    setInspectingResult(null);

    try {
      const response = await sendMessageWithTimeout<any>({
        type: 'AUTO_DISCOVER_AND_RESERVE',
        request: {
          movieName: params.movie,
          requiredSeats: params.seats,
          criteria: {
            preferredTimes: params.preferredTimes,
            allowedRows: params.allowedRows || ['B', 'C', 'D', 'E', 'F'],
          },
        },
      }, 25000);

      const discovery = response?.discovery;
      const reservation = response?.reservation;

      if (reservation?.success && discovery?.results?.length > 0) {
        const topResult = discovery.results[0];
        setResults(discovery.results);
        setAutoBookedData({
          result: topResult,
          optimalSeatLabels: reservation.seatLabels || [],
          bookingUrl: reservation.bookingUrl || topResult.showtime.bookingUrl,
          tabId: reservation.tabId,
        });
        setView('auto_booked');
        return;
      }

      if (discovery?.results && discovery.results.length > 0) {
        setResults(discovery.results);
        setView('results');
        return;
      }

      setResults([]);
      const errorDetail = discovery?.errors?.length
        ? discovery.errors.map((e: any) => e.error).join('; ')
        : `No continuous seat blocks of ${params.seats} seat${params.seats > 1 ? 's' : ''} found for "${params.movie}".`;
      setErrorMessage(errorDetail);
      setView('error');
    } catch (error) {
      console.error('Discovery failed:', error);
      setResults([]);
      setErrorMessage((error as Error)?.message || 'An unexpected error occurred during discovery.');
      setView('error');
    }
  };

  /**
   * Arm Seat Drop Sniper
   */
  const handleArmSniper = async (config: SniperConfig) => {
    try {
      const res = await sendMessageWithTimeout<any>({
        type: 'START_SNIPER',
        config,
      }, 5000);

      if (res?.state) {
        setSniperState(res.state);
      }
    } catch (err) {
      console.error('Failed to start sniper:', err);
    }
  };

  /**
   * Stop Seat Drop Sniper
   */
  const handleStopSniper = async () => {
    try {
      const res = await sendMessageWithTimeout<any>({
        type: 'STOP_SNIPER',
        reason: 'User stopped from extension popup',
      }, 5000);

      if (res?.state) {
        setSniperState(res.state);
      }
    } catch (err) {
      console.error('Failed to stop sniper:', err);
    }
  };

  /**
   * Trigger immediate check
   */
  const handleSniperCheckNow = async () => {
    try {
      await sendMessageWithTimeout<any>({ type: 'SNIPER_CHECK_NOW' }, 8000);
    } catch (err) {
      console.error('Manual check failed:', err);
    }
  };

  const reset = () => {
    setSelectedForBooking(null);
    setInspectingResult(null);
    setAutoBookedData(null);
    setErrorMessage('');
    setView('search');
  };

  const isSniperActive = sniperState.config?.active === true;

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-top-row">
          <h1>🎬 Movie Tickets</h1>
          <div className="header-actions">
            {isSniperActive && (
              <span className="live-sniper-badge" onClick={() => setActiveTab('sniper')}>
                <span className="pulse-dot"></span> Sniper Active ({sniperState.refreshCount})
              </span>
            )}
            <button
              type="button"
              className="refresh-btn"
              title="Refresh and start over (stops bot and resets everything)"
              onClick={handleRefreshAndStartOver}
            >
              🔄 Refresh
            </button>
            {!isPopout && (
              <button
                type="button"
                className="popout-window-btn"
                title="Pop out into a floating desktop window that won't close when you click outside"
                onClick={() => {
                  if (typeof chrome !== 'undefined' && chrome.runtime) {
                    chrome.runtime.sendMessage({ type: 'OPEN_POPOUT_WINDOW' });
                    window.close();
                  }
                }}
              >
                ↗ Pop out
              </button>
            )}
          </div>
        </div>
        <p className="tagline">Star Cineplex continuous blocks & scheduled drop sniper</p>

        {/* Tab Navigation */}
        <div className="tab-nav">
          <button
            type="button"
            className={`tab-btn ${activeTab === 'instant' ? 'is-active' : ''}`}
            onClick={() => {
              setActiveTab('instant');
              if (view === 'error') reset();
            }}
          >
            ⚡ Instant Book
          </button>
          <button
            type="button"
            className={`tab-btn ${activeTab === 'sniper' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('sniper')}
          >
            🎯 Seat Drop Sniper
            {isSniperActive && <span className="tab-pulse-dot"></span>}
          </button>
        </div>
      </header>

      <main>
        {activeTab === 'sniper' ? (
          /* Seat Drop Sniper Tab */
          isSniperActive ? (
            <SniperActiveView
              state={sniperState}
              onStop={handleStopSniper}
              onCheckNow={handleSniperCheckNow}
              onBackToConfig={handleStopSniper}
            />
          ) : (
            <SniperForm
              onArmSniper={handleArmSniper}
              initialMovie={lastSearch.movie}
              initialSeats={lastSearch.seats}
            />
          )
        ) : (
          /* Instant Search & Book Tab */
          <>
            {view === 'loading' && (
              <LoadingState
                movie={lastSearch.movie}
                seats={lastSearch.seats}
                onCancel={reset}
              />
            )}

            {view === 'error' && (
              <div className="error-state">
                <p className="error-message">
                  {errorMessage || `No continuous seat blocks found for "${lastSearch.movie}".`}
                </p>
                <p className="error-hint">Try searching for fewer seats, another movie title, or use the Seat Drop Sniper.</p>
                <button className="primary" onClick={reset}>← Try again</button>
              </div>
            )}

            {view === 'auto_booked' && autoBookedData && (
              <AutoBookedView
                result={autoBookedData.result}
                requiredSeats={lastSearch.seats}
                optimalSeatLabels={autoBookedData.optimalSeatLabels}
                bookingUrl={autoBookedData.bookingUrl}
                tabId={autoBookedData.tabId}
                totalOptionsCount={results.length}
                onViewAllOptions={() => setView('results')}
                onNewSearch={reset}
              />
            )}

            {view === 'results' && (
              <ResultsGrid
                results={results}
                requiredSeats={lastSearch.seats}
                onBack={reset}
                onSelectResult={res => setSelectedForBooking(res)}
                onInspectResult={res => setInspectingResult(res)}
              />
            )}

            {view === 'search' && (
              <SearchForm
                onSubmit={runDiscovery}
                initialMovie={lastSearch.movie}
                initialSeats={lastSearch.seats}
              />
            )}
          </>
        )}
      </main>

      {/* Visual Hall Inspector Modal */}
      {inspectingResult && (
        <SeatMapInspector
          result={inspectingResult}
          requiredSeats={lastSearch.seats}
          onClose={() => setInspectingResult(null)}
          onBook={() => {
            const target = inspectingResult;
            setInspectingResult(null);
            setSelectedForBooking(target);
          }}
        />
      )}

      {/* Automated Booking & Reservation Assistant Modal */}
      {selectedForBooking && (
        <BookingModal
          result={selectedForBooking}
          requiredSeats={lastSearch.seats}
          onClose={() => setSelectedForBooking(null)}
          onNewSearch={reset}
        />
      )}

      <footer className="app-footer">
        <span>Instant continuous blocks • Star Cineplex Bangladesh drop sniper</span>
      </footer>
    </div>
  );
}