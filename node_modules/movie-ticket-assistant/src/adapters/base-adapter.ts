/**
 * Base Cinema Adapter
 *
 * Abstract class that all cinema adapters must implement.
 * Each adapter handles a specific cinema chain/website.
 */

import { Movie, Cinema, Showtime, ShowtimeFilters } from '../types/cinema';
import { SeatMap } from '../types/seat';

export interface AdapterConfig {
  enabled: boolean;
  priority: number;
  timeout: number;
}

export interface BookingResult {
  success: boolean;
  error?: string;
  bookingId?: string;
  redirectUrl?: string;
}

/**
 * Abstract base class for cinema adapters
 */
export abstract class CinemaAdapter {
  /** Unique identifier for this adapter */
  abstract readonly id: string;

  /** Display name */
  abstract readonly name: string;

  /** Supported domain patterns */
  abstract readonly supportedDomains: string[];

  /** Adapter configuration */
  config: AdapterConfig = {
    enabled: true,
    priority: 1,
    timeout: 30000,
  };

  /**
   * Search for movies by name
   */
  abstract searchMovies(query: string): Promise<Movie[]>;

  /**
   * Get showtimes for a movie
   */
  abstract getShowtimes(movie: Movie, filters?: ShowtimeFilters): Promise<Showtime[]>;

  /**
   * Get seat map for a showtime
   */
  abstract getSeatMap(showtime: Showtime): Promise<SeatMap>;

  /**
   * Select seats on the booking page
   */
  abstract selectSeats(showtime: Showtime, seatIds: string[]): Promise<BookingResult>;

  /**
   * Add selected seats to cart
   */
  abstract addToCart(showtime: Showtime): Promise<BookingResult>;

  /**
   * Proceed to checkout
   */
  abstract checkout(showtime: Showtime): Promise<BookingResult>;

  /**
   * Check if this adapter can handle a given URL
   */
  canHandleUrl(url: string): boolean {
    return this.supportedDomains.some(domain => url.includes(domain));
  }

  /**
   * Validate adapter is properly configured
   */
  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!this.id) errors.push('Adapter must have an ID');
    if (!this.name) errors.push('Adapter must have a name');
    if (!this.supportedDomains?.length) {
      errors.push('Adapter must specify supported domains');
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Get adapter status
   */
  getStatus(): { healthy: boolean; message: string } {
    const validation = this.validate();
    if (!validation.valid) {
      return { healthy: false, message: validation.errors.join(', ') };
    }
    return { healthy: true, message: 'Ready' };
  }
}

/**
 * Registry for all available cinema adapters
 */
export class AdapterRegistry {
  private adapters: Map<string, CinemaAdapter> = new Map();

  /**
   * Register an adapter
   */
  register(adapter: CinemaAdapter): void {
    const validation = adapter.validate();
    if (!validation.valid) {
      throw new Error(`Invalid adapter ${adapter.id}: ${validation.errors.join(', ')}`);
    }
    this.adapters.set(adapter.id, adapter);
  }

  /**
   * Get adapter by ID
   */
  get(id: string): CinemaAdapter | undefined {
    return this.adapters.get(id);
  }

  /**
   * Get all enabled adapters, sorted by priority
   */
  getEnabled(): CinemaAdapter[] {
    return Array.from(this.adapters.values())
      .filter(a => a.config.enabled)
      .sort((a, b) => b.config.priority - a.config.priority);
  }

  /**
   * Find adapter that can handle a URL
   */
  findForUrl(url: string): CinemaAdapter | undefined {
    return this.getEnabled().find(adapter => adapter.canHandleUrl(url));
  }

  /**
   * Get all adapter IDs
   */
  listIds(): string[] {
    return Array.from(this.adapters.keys());
  }
}

// Singleton registry instance
export const adapterRegistry = new AdapterRegistry();