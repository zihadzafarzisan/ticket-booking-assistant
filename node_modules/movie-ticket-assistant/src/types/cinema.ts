/**
 * Cinema data types for the Movie Ticket Discovery Assistant
 */

export interface Movie {
  id: string;
  title: string;
  posterUrl?: string;
  synopsis?: string;
  duration?: number; // minutes
  releaseDate?: string;
  rating?: string; // e.g., "PG-13", "R"
  genres?: string[];
  director?: string;
  cast?: string[];
  language?: string;
  subtitleLanguages?: string[];
}

export interface Cinema {
  id: string;
  name: string;
  location: string;
  address?: string;
  phone?: string;
  website?: string;
  halls?: Hall[];
  amenities?: string[];
  coordinates?: {
    lat: number;
    lng: number;
  };
}

export interface Hall {
  id: string;
  name: string;
  screenType: ScreenType;
  capacity: number;
  seatingLayout?: string;
}

export type ScreenType = 'standard' | 'imax' | 'dolby_atmos' | '4dx' | '3d' | 'premium' | 'laser' | '2d';

export interface Showtime {
  id: string;
  movie: Movie;
  cinema: Cinema;
  hall: Hall;

  date: string; // ISO date
  time: string; // HH:mm format

  screenType: ScreenType;
  price: number;
  currency: string;

  availableSeats: number;
  totalSeats: number;

  seatMapId?: string;
  venueId?: string;

  // For booking
  bookingUrl: string;
}

export interface ShowtimeFilters {
  date?: string;
  timeRange?: {
    start?: string;
    end?: string;
  };
  cinemaId?: string;
  screenType?: ScreenType;
  maxPrice?: number;
  minAvailableSeats?: number;
  preferredLocationIds?: string[];
}

export interface CinemaLocation {
  id: string;
  venueId?: string;
  name: string;
  shortName: string;
  city: string;
  keywords: string[];
}

export const STAR_CINEPLEX_LOCATIONS: CinemaLocation[] = [
  {
    id: 'bashundhara',
    venueId: '8be12859-1385-45b6-89da-46ab8154ea3d',
    name: 'Bashundhara City, Panthapath',
    shortName: 'Bashundhara City',
    city: 'Dhaka',
    keywords: ['bashundhara', 'panthapath'],
  },
  {
    id: 'sony-square',
    venueId: '07ce0273-2b9f-4563-a02c-bb160284cb3b',
    name: 'Sony Square, Mirpur',
    shortName: 'Sony Square',
    city: 'Dhaka',
    keywords: ['sony', 'mirpur'],
  },
  {
    id: 'sks-tower',
    venueId: 'b6bfb03a-e6ca-402c-a115-02ecef7ed060',
    name: 'SKS Tower, Mohakhali',
    shortName: 'SKS Tower',
    city: 'Dhaka',
    keywords: ['sks', 'mohakhali'],
  },
  {
    id: 'shimanto-shambhar',
    venueId: '9dfeb55a-5db5-48a1-b54b-312b94be94b6',
    name: 'Shimanto Shambhar, Dhanmondi',
    shortName: 'Shimanto Shambhar',
    city: 'Dhaka',
    keywords: ['shimanto shambhar', 'dhanmondi'],
  },
  {
    id: 'centrepoint',
    venueId: '1ab63a71-af64-444f-85aa-d682bfd2609c',
    name: 'Centrepoint, Uttara',
    shortName: 'Centrepoint (Uttara)',
    city: 'Dhaka',
    keywords: ['centrepoint', 'uttara'],
  },
  {
    id: 'military-museum',
    venueId: 'c4671ef9-2d06-4d4a-b0aa-d7754aad7e4c',
    name: 'Military Museum, Bijoy Sarani',
    shortName: 'Military Museum',
    city: 'Dhaka',
    keywords: ['military', 'bijoy', 'sarani', 'museum'],
  },
  {
    id: 'narayanganj',
    venueId: '3b3e2a8a-49d2-42a7-b89d-b170ec54e149',
    name: 'Shimanto Tower, Narayanganj',
    shortName: 'Narayanganj',
    city: 'Narayanganj',
    keywords: ['narayanganj', 'jalkuri', 'shimanto tower'],
  },
  {
    id: 'chattogram-bali',
    venueId: '429925b0-b1a5-42bd-b109-4d189c608797',
    name: 'Bali Arcade, Chattogram',
    shortName: 'Bali Arcade (CTG)',
    city: 'Chattogram',
    keywords: ['bali arcade', 'chattogram', 'chittagong'],
  },
  {
    id: 'chattogram-finlay',
    venueId: 'ec41bb92-83ea-4eeb-939f-67b1c6ab51bd',
    name: 'Finlay Square, Chattogram',
    shortName: 'Finlay Square (CTG)',
    city: 'Chattogram',
    keywords: ['finlay', 'nasirabad'],
  },
];

export const DHAKA_LOCATION_IDS = [
  'bashundhara',
  'sony-square',
  'sks-tower',
  'shimanto-shambhar',
  'centrepoint',
  'military-museum',
];

/**
 * Check if a showtime matches any of the specified location IDs
 */
export function matchesLocation(showtime: Showtime, locationIds?: string[]): boolean {
  if (!locationIds || locationIds.length === 0) return true;

  const cinemaText = `${showtime.cinema.name} ${showtime.cinema.location} ${showtime.cinema.address || ''}`.toLowerCase();
  const venueId = showtime.venueId;

  for (const locId of locationIds) {
    const loc = STAR_CINEPLEX_LOCATIONS.find(l => l.id === locId);
    if (!loc) {
      if (venueId && venueId === locId) return true;
      if (cinemaText.includes(locId.toLowerCase())) return true;
      continue;
    }

    if (venueId && loc.venueId && venueId === loc.venueId) {
      return true;
    }

    if (loc.keywords.some(k => cinemaText.includes(k))) {
      return true;
    }
  }

  return false;
}

/**
 * Identify the location ID for a given showtime
 */
export function getShowtimeLocationId(showtime: Showtime): string {
  if (showtime.venueId) {
    const matched = STAR_CINEPLEX_LOCATIONS.find(l => l.venueId === showtime.venueId);
    if (matched) return matched.id;
  }

  const cinemaText = `${showtime.cinema.name} ${showtime.cinema.location} ${showtime.cinema.address || ''}`.toLowerCase();
  for (const loc of STAR_CINEPLEX_LOCATIONS) {
    if (loc.keywords.some(k => cinemaText.includes(k))) {
      return loc.id;
    }
  }

  return showtime.venueId || showtime.cinema.id;
}

/**
 * Convert time string to comparable value
 */
export function timeToNumber(time: string): number {
  const [hours, minutes] = time.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * Check if a showtime matches filters
 */
export function matchesFilters(showtime: Showtime, filters: ShowtimeFilters): boolean {
  if (filters.date && showtime.date !== filters.date) return false;

  if (filters.timeRange) {
    const showtimeMinutes = timeToNumber(showtime.time);
    if (filters.timeRange.start) {
      const startMinutes = timeToNumber(filters.timeRange.start);
      if (showtimeMinutes < startMinutes) return false;
    }
    if (filters.timeRange.end) {
      const endMinutes = timeToNumber(filters.timeRange.end);
      if (showtimeMinutes > endMinutes) return false;
    }
  }

  if (filters.cinemaId && showtime.cinema.id !== filters.cinemaId) return false;

  if (filters.screenType && showtime.screenType !== filters.screenType) return false;

  if (filters.maxPrice && showtime.price > filters.maxPrice) return false;

  if (filters.minAvailableSeats && showtime.availableSeats < filters.minAvailableSeats) return false;

  if (filters.preferredLocationIds && !matchesLocation(showtime, filters.preferredLocationIds)) {
    return false;
  }

  return true;
}