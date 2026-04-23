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

### Phase 4J: CSG Intel Context (IMPLEMENTED) ✅
- [x] New `csg_intel` SQLite table (group_id, week_of, source, raw_text, dedup by UNIQUE constraint)
- [x] USNI article text stored per group after position parsing
- [x] TWZ Carrier Tracker scraper (twzScraper.ts) with article body extraction
- [x] Smart snippet extraction in getCSGContextString() (searches for group name, returns 400 chars)
- [x] AI chat now knows WHERE CSGs are heading and WHY (not just position)
- [x] Weekly dedup by ISO week, INSERT OR REPLACE for mid-week updates

### LLM Service Refactor (IMPLEMENTED) ✅
- [x] Centralized `chat()` function in llm.ts replaces all raw Ollama API calls
- [x] Multi-provider support: local Ollama + OpenAI-compatible cloud (ZAI, Groq, etc.)
- [x] Cloud provider settings: base URL, API key, model name, temperature
- [x] Fallback to local Ollama when cloud provider fails
- [x] Actual model used + fallback status tracked in metadata
- [x] All services migrated: predictor, sense-making, prediction reviewer, processor, USNI parser

### Token Conservation (IMPLEMENTED) ✅
- [x] Predictor interval: 90 min (was 30 min)
- [x] Only HIGH/CRITICAL anomalies trigger predictions
- [x] Max 3 predictions per cycle
- [x] Consecutive failure backoff: 30 min after 3 failures (predictor + sense-making)
- [x] ~67% reduction in LLM API calls

### No-Markdown AI Output (IMPLEMENTED) ✅
- [x] All LLM prompts use plain text formatting (no headers, bullets, bold)
- [x] Explicit instructions in prompts: respond in natural prose, no markdown
- [x] Applied across: predictor, prediction reviewer, sense-making, RAG pipeline, processor

### Phase 4I: GFW Vessel Presence (IMPLEMENTED) ✅
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

## Phase 1: Bug Fixes & Stability ✅ COMPLETE

### Critical Testing Items (all verified)
- [x] App launches without console errors
- [x] ADS-B data loads and renders on map
- [x] AIS data loads and renders on map
- [x] News feed populates
- [x] Anomaly detection runs without crashes
- [x] Predictions panel loads (IPC bridge working)
- [x] AI chat panel loads (IPC bridge working)
- [x] Settings panel opens and saves
- [x] AI model selector populates from provider
- [x] Settings persist across app restarts

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

## Phase 3: Feature Additions (Partially Complete)

### Completed
- [x] Cross-source correlation (tactical engine fuses ADS-B + AIS + news + CSG)
- [x] AI sense-making engine (cross-source analysis every 30 min)
- [x] CSG intel context (USNI + TWZ articles feed into AI analysis)
- [x] Multi-provider AI (local Ollama + cloud with fallback)
- [x] Prediction self-calibration (reviewer checks accuracy, feeds back into prompts)

### Remaining
- [ ] Weather overlay (Open-Meteo - free, no key needed)
- [ ] Economic indicators (FRED API - free)
- [ ] Earthquake/seismic data (USGS - free)
- [ ] Daily intelligence briefing (auto-generated summary)
- [ ] Export briefing as PDF or text
- [ ] Timeline view of events for a specific region
- [ ] Watchlists
- [ ] Alert rules - custom thresholds
- [ ] Multi-turn conversation with context retention
- [ ] Contradiction detection between sources
- [ ] Trend analysis

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
