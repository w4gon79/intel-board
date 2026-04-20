# Intel Board - MVP Testing & Iteration Plan

## Recent Iterations (2026-04-10)

### Phase 4H: Remote HTTP Server ✅ COMPLETE
- [x] HTTP server serves renderer UI to browsers on local network (port 3210)
- [x] REST API endpoints mirror all IPC handlers
- [x] Browser-mode apiTransport.ts replaces window.api with fetch-based calls
- [x] CSP fix: permissive CSP injected for remote, strict for Electron
- [x] express.static `{ index: false }` fix for root URL
- [x] Nested object API structure (not flat keys with Proxy)
- [x] Lite GeoJSON endpoints (capped 5000, military priority, stripped fields)
- [x] jsonFetch error handling (returns null, catches truncated responses)
- [x] Mobile layout: map 50vh, feed below, page scrolls
- [x] Body overflow hidden only on desktop (CSS media query)
- [x] Tested working on PC browser, iPhone, iPad

### Phase 4I: GFW Vessel Presence (PLANNED)
- [ ] Register for GFW API token at globalfishingwatch.org
- [ ] Add `GFW_API_TOKEN` to .env
- [ ] Create gfwService.ts for 4Wings API polling
- [ ] Define choke point polygons (Hormuz, Malacca, Bab el-Mandeb, Suez, Gibraltar, Taiwan Strait)
- [ ] Create gfw_presence SQLite table
- [ ] Poll every 6-12 hours per choke point
- [ ] Add REST endpoint /api/gfw/chokepoints
- [ ] Add GFW heatmap overlay to SituationMap
- [ ] SAR dark vessel detection overlay (bonus)

---

## Testing Method

Carl can test the app using Chrome DevTools Protocol (CDP) - the same approach used for testing the DISCLOSURE game. This allows:
- Automated UI interaction (click buttons, type text, navigate)
- Console log inspection
- DOM state verification
- Screenshot capture for visual review

### Launch for Testing
```powershell
# From project directory, launch with remote debugging:
npx electron . --remote-debugging-port=9222
```

Carl connects via `http://localhost:9222` and can test everything.

---

## Phase 1: Bug Fixes & Stability

### Critical Testing Items
- [ ] App launches without console errors
- [ ] ADS-B data loads and renders on map
- [ ] AIS data loads and renders on map
- [ ] News feed populates
- [ ] Anomaly detection runs without crashes
- [ ] Predictions panel loads (IPC bridge working)
- [ ] AI chat panel loads (IPC bridge working)
- [ ] Settings panel opens and saves
- [ ] AI model selector populates from Ollama
- [ ] Settings persist across app restarts

### Known Issues (from initial testing)
- [ ] IPC bridge had undefined namespaces (predictions, ai, settings) - FIXED
- [ ] Ship layer starts at 0 features, takes time to accumulate
- [ ] AIS WebSocket reconnection loop (1006 errors) - FIXED with correct message format
- [ ] OpenSky required OAuth2 instead of Basic auth - FIXED

### Performance
- [ ] 9000+ ADS-B features render smoothly with GeoJSON layers
- [ ] 10,000+ AIS features render smoothly
- [ ] Map remains responsive with both layers active
- [ ] Memory usage stays reasonable over 1+ hour of operation
- [ ] SQLite database doesn't grow unbounded (retention cleanup working)

---

## Phase 2: Polish & UX Improvements

### Map
- [ ] Default view shows the full globe, not just US
- [ ] ADS-B flight tracks show heading/direction (rotation on markers)
- [ ] AIS ship icons distinguish cargo/tanker/military/passenger
- [ ] Military aircraft highlighted distinctively (different color/size)
- [ ] Click on aircraft/ship shows info popup with details
- [ ] Legend/key for map symbols
- [ ] Layer toggle controls (show/hide ADS-B, AIS, news markers)

### Intelligence Feed
- [ ] Feed auto-scrolls to newest items
- [ ] Items show relative time ("2 min ago", "1 hour ago")
- [ ] Click on feed item zooms map to that location
- [ ] Filter by tier (ALERT/WATCH/CONTEXT/PREDICTION)
- [ ] Search within feed
- [ ] Mark items as read/unread

### AI Chat
- [ ] Chat responds with RAG-grounded answers
- [ ] Source citations are clickable
- [ ] Suggested questions based on active anomalies
- [ ] Chat history persists across sessions
- [ ] "Show evidence" button works for any claim

### Settings
- [ ] All settings save and load correctly
- [ ] Model selector shows available Ollama models
- [ ] Connection test shows green/red status
- [ ] Settings apply immediately without restart

---

## Phase 3: Feature Additions

### New Data Sources
- [ ] Weather overlay (Open-Meteo - free, no key needed)
- [ ] Economic indicators (FRED API - free)
- [ ] Earthquake/seismic data (USGS - free)

### Enhanced Anomaly Detection
- [ ] Weather-based anomaly detection (sudden pressure drops, temperature extremes)
- [ ] Cross-source correlation (military flights + news + ship movements = higher confidence)
- [ ] Historical anomaly comparison ("similar pattern occurred on [date]")
- [ ] Adjustable sensitivity levels per metric

### Intelligence Features
- [ ] Daily intelligence briefing (auto-generated summary)
- [ ] Export briefing as PDF or text
- [ ] Timeline view of events for a specific region
- [ ] Watchlists - user can track specific areas, ship MMSIs, aircraft callsigns
- [ ] Alert rules - custom thresholds beyond default z-score

### AI Enhancements
- [ ] Multi-turn conversation with context retention
- [ ] "Deep dive" mode for thorough analysis of a topic
- [ ] Contradiction detection between sources
- [ ] Trend analysis ("military activity in Middle East has increased 40% over 7 days")

---

## Phase 4: Advanced Features (Future)

### Collaboration
- [ ] Share intelligence briefings
- [ ] Export data as CSV/JSON for external analysis
- [ ] Webhook notifications for ALERT-tier events

### Customization
- [ ] Custom map layers (user-defined KML/GeoJSON)
- [ ] Custom anomaly rules (user-defined thresholds)
- [ ] Theme customization (dark/light/custom)

### Performance
- [ ] Data archiving (move old data to compressed storage)
- [ ] Configurable data retention per source
- [ ] Background processing optimization
