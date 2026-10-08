# 🎬 Movie Ticket Discovery & Booking Assistant

A production-grade Chrome extension (Manifest V3) that finds the best seats across supported cinema booking websites — all from one search.

## The Problem It Solves

Manually browsing multiple cinema sites to find good seats is slow. This extension lets you enter just:

1. **Movie name**
2. **Number of consecutive seats**

…and it discovers cinemas, halls, dates, showtimes, seat maps, and — crucially — **every maximal continuous block of available seats** that fits your party.

### No Overlapping Results

If a row has `F2-F6` continuously available and you need 3 seats, it shows **one** result:

> Row F • F2-F6 — 5 consecutive seats available

…not `F2-F4`, `F3-F5`, `F4-F6` as three separate choices.

## Architecture

```
User Input (Movie + Seats)
        ↓
┌─────────────────────────────┐
│ Popup UI (React)            │
└─────────────────────────────┘
        ↓ chrome.runtime messages
┌─────────────────────────────┐
│ Service Worker (orchestrator)│
└─────────────────────────────┘
        ↓ concurrent
┌─────────────────────────────┐
│ Cinema Adapters (pluggable) │
│  ├─ Star Cineplex           │
│  ├─ Blockbuster             │
│  └─ (add more easily)       │
└─────────────────────────────┘
        ↓ normalized data
┌─────────────────────────────┐
│ Seat Block Detection        │   ← maximal contiguous blocks
│ Ranking (weighted scoring)  │
└─────────────────────────────┘
        ↓
Ranked results, then booking (user-assisted checkout)
```

### Key Design Decisions

| Decision | Why |
|----------|-----|
| **Manifest V3** | Only supported Chrome format for new extensions |
| **React** | Component UI, clean state handling |
| **Pluggable adapters** | New cinemas don't touch core logic |
| **Maximal block algorithm** | No redundant overlapping results |
| **Weighted ranking** | Configurable (seat 40% / time 20% / cinema 15% / format 15% / price 10%) |
| **Local-first seat processing** | Privacy + speed, no PII leaves browser |
| **User-assisted checkout** | Never stores payment credentials; hands back to secure payment window |

## Project Structure

```
extension/
├── public/manifest.json        # MV3 manifest + minimal permissions
├── src/
│   ├── popup/                  # React UI (search → results)
│   │   ├── index.html
│   │   ├── index.tsx
│   │   ├── App.tsx
│   │   ├── styles.css
│   │   └── components/         # SearchForm, ResultsGrid, ResultCard, LoadingState
│   ├── background/             # service-worker.ts (orchestration + message routing)
│   ├── content/                # bridge.ts + utils.ts (DOM interaction, booking-state detection)
│   ├── adapters/               # base-adapter.ts, registry, star-cineplex/
│   ├── algorithms/             # seat-block/ (detection), ranking/ (scoring)
│   ├── types/                  # cinema.ts, seat.ts
│   ├── services/
│   └── utils/
├── vite.config.ts              # Vite + chrome-extension plugin build
└── tsconfig.json
```

## Core Algorithm: Seat Block Detection

`src/algorithms/seat-block/index.ts`

- Groups seats by row, sorts by position.
- Splits on unavailable seats / numeric gaps / aisles (windows of contiguous *available* seats).
- Each run of contiguous seats → **one maximal `SeatBlock`** (never overlapping combos).
- Respects seat categories (VIP, couple, etc.) when configured.
- Uses explicit `adjacentSeatIds` from the adapter when available — **never assumes numeric adjacency implies physical adjacency**.
- Computes a `centerScore` for ranking.

## Ranking

`src/algorithms/ranking/scorer.ts`

Configurable weights + presets (`bestValue`, `bestExperience`, `closestCinema`). Produces an overall score and human-readable reasoning:

> ⭐ Best match — Excellent center seats + preferred time + IMAX

## Booking Flow (Security-Aware)

```
Discovery → Result selected → Re-check availability → Select seats
        → Add to cart → Checkout → User completes payment
        → Detect confirmation page → Show 🎉 Booking Confirmed
```

- **Never stores** card numbers, CVV, OTPs, banking credentials.
- Re-fetches seat map before booking — availability can change between discovery and checkout, so `selection succeeds` = actually verified.
- If a CAPTCHA or payment screen appears, control hands back to the user.

## Getting Started

```bash
cd extension
npm install
npm run dev        # dev server
npm run build      # production build → dist/
```

### Load into Chrome (unpacked)

1. Go to `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select the `extension/dist` folder (after `npm run build`)

## Testing

```bash
npm test           # vitest: seat-block detection, ranking, edge cases
```

Test coverage includes:

- Maximal block detection (no overlapping combos)
- Multiple rows / mixed statuses / empty maps
- Aisle gaps and seat category filtering
- Center-score ranking
- Optimal seat selection within a block

## Adding a New Cinema

1. Create `src/adapters/<cinema>/adapter.ts`.
2. Extend `CinemaAdapter` and implement: `searchMovies`, `getShowtimes`, `getSeatMap`, `selectSeats`, `addToCart`, `checkout`.
3. Register it in `src/background/service-worker.ts`.
4. Add its domain to `manifest.json` (`host_permissions` + `content_scripts.matches`).

The core never changes — it only speaks through the adapter interface. See `docs/ADAPTER_GUIDE.md` (planned) for details.

## Legal & Ethical Constraints

- Operates only where automated interaction is permitted.
- Does **not** bypass CAPTCHAs, bot detection, authentication, rate limits, or security controls.
- When automation isn't permitted, the extension hands the user the booking page to continue manually.
- Never attempts to purchase via unauthorized methods.

## Roadmap

- [x] MVP: search → discovery → seat-block detection → ranking → re-verify → user-assisted checkout
- [ ] Backend (movie/cinema metadata cache, preferences, analytics) — optional, local-first stays default
- [ ] Second cinema adapter
- [ ] Seat map visual viewer in popup
- [ ] Booking state machine + confirmation detection polish