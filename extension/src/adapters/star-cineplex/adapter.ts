/**
 * Star Cineplex Cinema Adapter
 *
 * Handles the Star Cineplex Bangladesh booking website.
 * Uses a public API when available, falls back to DOM interaction.
 */

import { CinemaAdapter, BookingResult } from '../base-adapter';
import { Movie, Cinema, Showtime, ShowtimeFilters, ScreenType } from '../../types/cinema';
import { Seat, SeatMap, SeatCategory } from '../../types/seat';

interface StarCineplexResponse {
  movies: Array<{
    id: string;
    title: string;
    poster?: string;
    duration?: number;
  }>;
  shows: Array<{
    id: string;
    movieId: string;
    hall: string;
    date: string;
    time: string;
    price: number;
    screenType: string;
  }>;
}

/**
 * Star Cineplex adapter implementation
 * Uses the public showtimes API if available
 */
export class StarCineplexAdapter extends CinemaAdapter {
  readonly id = 'star-cineplex';
  readonly name = 'Star Cineplex';
  readonly supportedDomains = ['starcineplex.com'];

  private readonly apiBase = 'https://www.starcineplex.com/api';

  /**
   * Search for movies by name
   */
  async searchMovies(query: string): Promise<Movie[]> {
    // Try API first
    try {
      const response = await fetch(`${this.apiBase}/movies?search=${encodeURIComponent(query)}`);
      if (response.ok) {
        const data = (await response.json()) as StarCineplexResponse;
        return data.movies.map(movie => ({
          id: movie.id,
          title: movie.title,
          posterUrl: movie.poster,
          duration: movie.duration,
          language: 'English',
        }));
      }
    } catch {
      // Fall back to DOM parsing
    }

    // DOM fallback would go here in production
    return [];
  }

  /**
   * Get showtimes for a movie
   */
  async getShowtimes(movie: Movie, filters?: ShowtimeFilters): Promise<Showtime[]> {
    try {
      const response = await fetch(`${this.apiBase}/movies/${movie.id}/showtimes`);
      if (response.ok) {
        const data = (await response.json()) as StarCineplexResponse;
        return data.shows.map(show => ({
          id: show.id,
          movie,
          cinema: {
            id: this.id,
            name: 'Star Cineplex',
            location: 'Bashundhara City',
            halls: [{ id: show.hall, name: show.hall, screenType: this.parseScreenType(show.screenType), capacity: 0 }],
          },
          hall: {
            id: show.hall,
            name: show.hall,
            screenType: this.parseScreenType(show.screenType),
            capacity: 0,
          },
          date: show.date,
          time: show.time,
          screenType: this.parseScreenType(show.screenType),
          price: show.price,
          currency: 'BDT',
          availableSeats: 0,
          totalSeats: 0,
          bookingUrl: `${this.apiBase}/shows/${show.id}/booking`,
        }));
      }
    } catch {
      // DOM fallback
    }

    return [];
  }

  /**
   * Get seat map for a showtime
   */
  async getSeatMap(showtime: Showtime): Promise<SeatMap> {
    // In a real adapter, this would fetch the seat map from the cinema site
    // and parse it into the normalized format

    const seats: Seat[] = [];
    const rows = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

    rows.forEach(row => {
      for (let num = 1; num <= 12; num++) {
        seats.push({
          id: `${row}${num}`,
          row,
          number: num,
          label: `${row}${num}`,
          status: Math.random() > 0.4 ? 'available' : 'occupied',
          category: row.startsWith('A') || row.startsWith('B') ? 'vip' as SeatCategory : 'standard' as SeatCategory,
          price: showtime.price,
          adjacentSeatIds: [
            `${row}${num - 1}`,
            `${row}${num + 1}`,
          ].filter(id => id.length > 1),
        });
      }
    });

    const rowsMap = new Map<string, Seat[]>();
    rows.forEach(row => {
      rowsMap.set(row, seats.filter(s => s.row === row));
    });

    return {
      cinemaId: showtime.cinema.id,
      movieId: showtime.movie.id,
      showtimeId: showtime.id,
      rows: rowsMap,
      blocks: [],
      hallName: showtime.hall.name,
      screenType: showtime.screenType,
      totalSeats: seats.length,
      availableSeats: seats.filter(s => s.status === 'available').length,
      fetchedAt: new Date(),
    };
  }

  /**
   * Select seats on the booking page
   */
  async selectSeats(_showtime: Showtime, _seatIds: string[]): Promise<BookingResult> {
    // In production, this opens the cinema's booking page and
    // clicks the relevant seats via content script

    return {
      success: true,
      redirectUrl: _showtime.bookingUrl,
    };
  }

  /**
   * Add selected seats to cart
   */
  async addToCart(_showtime: Showtime): Promise<BookingResult> {
    return { success: true };
  }

  /**
   * Proceed to checkout
   */
  async checkout(_showtime: Showtime): Promise<BookingResult> {
    return {
      success: true,
      redirectUrl: _showtime.bookingUrl + '/checkout',
    };
  }

  /**
   * Parse screen type string to normalized format
   */
  private parseScreenType(raw: string): ScreenType {
    const normalized = raw.toLowerCase();
    if (normalized.includes('imax')) return 'imax';
    if (normalized.includes('atmos')) return 'dolby_atmos';
    if (normalized.includes('4dx')) return '4dx';
    if (normalized.includes('3d')) return '3d';
    if (normalized.includes('premium')) return 'premium';
    return 'standard';
  }
}