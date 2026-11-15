# Live Star Cineplex inventory plan

1. Add typed provider normalization and a refresh service using public movie, venue, show and seat-map metadata endpoints. Verify live field shapes and enforce stale/error reporting and opening-change detection.
2. Expose cached/streamed inventory and use it for bot movie/show discovery. Add exact-show task targeting without relaxing date or branch constraints.
3. Add a Live Cineplex dashboard for movies, show sales and halls, filters, refresh timestamp/errors, and mission creation from live data.
4. Cover provider/state/API behavior with unit tests and the connected UI with offline browser fixtures. Build, inspect screenshots, and perform a read-only real-feed check.
