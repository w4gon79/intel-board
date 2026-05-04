# Intel Board - MVP Testing & Iteration Plan

## Recent Iterations

### Phase 5A: Notifications, Export, and Tactical Overlay (2026-05-03)

**Push Notifications (IMPLEMENTED) ✅**
- [x] Alert rules with user-defined triggers (keywords, regions, event types, tiers)
- [x] Telegram bot notifications with rate limiting (15-min cooldown per alert key)
- [x] Webhook notifications (generic HTTP POST)
- [x] Email notifications via nodemailer (SMTP)
- [x] Built-in detection notifications: tactical events, economic anomalies, sense-making analysis
- [x] Notification toggles per channel and per detection type in Settings

**Export System (IMPLEMENTED) ✅**
- [x] Intel report export as Markdown and PDF with tier filtering and date range
- [x] AI chat message export (single message as Markdown/PDF with sources and confidence bars)
- [x] Full conversation export (Markdown/PDF with all messages, sources, confidence bars)
- [x] PDF formatting: colored confidence bars (green/amber/red), numbered sources, footer timestamps
- [x] Local time formatting on all exports (was UTC, now system local time)
- [x] Clear chat history button (🗑️) with database purge

**Tactical Overlay & Map Annotations (IMPLEMENTED) ✅**
- [x] 5 annotation types: marker, line, polygon, circle, text label
- [x] Persistent annotations stored in SQLite (survive app restart)
- [x] Color picker and style options per annotation type
- [x] Annotation toolbar for creating/editing/deleting
- [x] MapDrawLayer with Leaflet.Draw integration
- [x] AnnotationPopup for editing annotation properties

**Dynamic Conflict Zones (IMPLEMENTED) ✅**
- [x] DBSCAN clustering engine (epsilon=200nm, min_samples=3)
- [x] Zone lifecycle: monitoring → active → escalating → fading → resolved
- [x] Decay factor (0.85x per cycle) prevents stale zones
- [x] Home territory filtering (US, UK, France, etc.)
- [x] Home port filtering (Norfolk, San Diego, Portsmouth, Toulon, Yokosuka)
- [x] Evidence trail with fallback lat/lon query when stored IDs are stale
- [x] Fresh evidence IDs replace stale ones each cycle (no accumulation)

**AI Chat Improvements (IMPLEMENTED) ✅**
- [x] Chat history loads newest-first (most recent messages at top)
- [x] New messages prepended (appear at top)
- [x] Export single messages or full conversations as Markdown/PDF
- [x] Clear chat history with confirmation
- [x] PDF page 2 text color fix (fillColor reset after confidence bar)

**FRED Economic Indicators (IMPLEMENTED) ✅**
- [x] FRED API integration for bond yields and interest rates
- [x] economicService.ts with Yahoo Finance + FRED data sources
- [x] Interest rate series: FEDFUNDS, DGS1MO, DGS2, DGS10, DGS30, T10Y2Y, MORTGAGE30US

**Foreign Language Translation (IMPLEMENTED) ✅**
- [x] AI-powered translation pipeline for non-English articles
- [x] Language detection and full article translation
- [x] Bilingual storage (original + English) for search
- [x] Intel relevance filter to skip off-topic translated content

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
- [x] Default view shows the full globe, not just US
- [ ] ADS-B flight tracks show heading/direction (rotation on markers)
- [ ] AIS ship icons distinguish cargo/tanker/military/passenger
- [ ] Military aircraft highlighted distinctively (different color/size)
- [x] Click on aircraft/ship shows info popup with details
- [ ] Legend/key for map symbols
- [x] Layer toggle controls (show/hide ADS-B, AIS, news markers)
- [x] Tactical overlay with persistent map annotations
- [x] Dynamic conflict zones with evidence trail
- [x] Transit corridors and choke points

### Intelligence Feed
- [ ] Feed auto-scrolls to newest items
- [ ] Items show relative time ("2 min ago", "1 hour ago")
- [x] Click on feed item zooms map to that location
- [ ] Filter by tier (ALERT/WATCH/CONTEXT/PREDICTION)
- [ ] Search within feed
- [ ] Mark items as read/unread
- [x] Export intel report as Markdown or PDF

### AI Chat
- [x] Chat responds with RAG-grounded answers
- [x] Source citations are clickable
- [x] Suggested questions based on active anomalies
- [x] Chat history persists across sessions
- [x] "Show evidence" button works for any claim
- [x] Newest messages appear at top
- [x] Clear chat history button
- [x] Export single message or full conversation as Markdown/PDF

### Settings
- [x] All settings save and load correctly
- [x] Model selector shows available Ollama models
- [x] Connection test shows green/red status
- [x] Settings apply immediately without restart
- [x] Notification channels: Telegram, webhook, email
- [x] Alert rules with keyword/region/tier filters

---

## Phase 3: Feature Additions (Partially Complete)

### Completed
- [x] Cross-source correlation (tactical engine fuses ADS-B + AIS + news + CSG)
- [x] AI sense-making engine (cross-source analysis every 30 min)
- [x] CSG intel context (USNI + TWZ articles feed into AI analysis)
- [x] Multi-provider AI (local Ollama + cloud with fallback)
- [x] Prediction self-calibration (reviewer checks accuracy, feeds back into prompts)
- [x] Dynamic conflict zones (DBSCAN clustering, zone lifecycle, evidence trails)
- [x] Tactical overlay (persistent map annotations: markers, lines, polygons, circles, text)
- [x] Push notifications (Telegram, webhook, email)
- [x] Alert rules (keyword, region, tier triggers)
- [x] Export system (intel reports, AI chat, conversations as Markdown/PDF)
- [x] FRED economic indicators (bond yields, interest rates)
- [x] Foreign language translation pipeline

### Remaining
- [ ] Weather overlay (removed Open-Meteo, not used)
- [ ] Daily intelligence briefing (auto-generated summary)
- [ ] Timeline view of events for a specific region
- [ ] Watchlists
- [ ] Contradiction detection between sources
- [ ] Trend analysis

---

## Phase 4: Advanced Features (Future)

### Collaboration
- [ ] Share intelligence briefings
- [ ] Export data as CSV/JSON for external analysis
- [ ] Multi-turn conversation with context retention

### Customization
- [ ] Custom map layers (user-defined KML/GeoJSON)
- [ ] Custom anomaly rules (user-defined thresholds)
- [ ] Theme customization (dark/light/custom)

### Performance
- [ ] Data archiving (move old data to compressed storage)
- [ ] Configurable data retention per source
- [ ] Background processing optimization