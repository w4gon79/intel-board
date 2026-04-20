# Intel Board - Product Requirements Document (PRD)

## Vision

A RAG-grounded AI intelligence dashboard that aggregates multi-source data (news, flight tracking, ship tracking) to generate predictions and early warnings about developing global events. Every AI output is grounded in verifiable source material. No hallucinations.

## Core Philosophy

**"See it first. Understand it faster. Act on it sooner."**

The Intel Board is not a news reader. It is a **sense-making engine** that detects anomalies, correlates across domains, and surfaces developing events before they become headlines.

## Current Status: MVP Complete (v0.1.0)

All Tier 1 data sources are live and integrated. The core feedback loop (data ingestion, anomaly detection, AI prediction, user display) is fully functional.

### What's Working
- Live ADS-B flight tracking with military identification
- Live AIS vessel tracking via WebSocket streaming
- News ingestion from GDELT
- Interactive Mapbox GL map with layered overlays
- RAG-grounded intelligence feed (ALERT/WATCH/CONTEXT tiers)
- AI chat assistant with source citations
- Anomaly detection engine with statistical baselines
- Prediction engine with confidence scoring
- Settings and AI model configuration panels
- Layer controls (ADS-B, AIS, Intel toggleable)
- Clustering toggle for map markers
- Military-only filter mode
- Desktop notifications

### What's Not Yet Built
- Weather overlay (Tier 2)
- Economic indicators (Tier 2)
- Social media signals (Tier 2)
- Satellite imagery (Tier 3)
- Custom alert rules
- Export/share intelligence briefs
- Offline mode
- Conversational queries on the map (click-for-brief)

## Data Sources

### Tier 1: Real-Time Feeds (LIVE)

1. **OpenSky Network API** - Military and civilian flight tracking
   - Polling via main process IPC handlers
   - Military detection: callsign patterns, ICAO24 ranges, aircraft type filtering
   - Real-time GeoJSON pushed to renderer via IPC streaming

2. **AISStream.io** - Ship tracking via WebSocket
   - WebSocket stream (no polling needed)
   - Ship type filtering: cargo, tanker, military, passenger
   - Naval vessel detection by type codes 35-39
   - Choke point monitoring: Hormuz, Suez, Panama, Taiwan Strait, Bab el-Mandeb, Bosporus, Malacca, Gibraltar

3. **GDELT / NewsAPI** - News ingestion
   - Scheduled ingestion via processor/scheduler
   - Sentiment analysis and entity extraction
   - Region/topic categorization

### Tier 2: Supplemental Intelligence (PLANNED)
- Weather/Meteorological (Open-Meteo, NOAA)
- Economic Indicators (FRED, World Bank)
- Social Media Signals (Reddit, Twitter/X)

### Tier 3: Specialized Feeds (FUTURE)
- Earthquake/Seismic (USGS)
- Satellite Imagery (Sentinel, Planet Labs)
- Cyber Threat Intel

## Core Features

### 1. Live Situation Map (IMPLEMENTED)
- Interactive Mapbox GL dark-themed map
- Three toggleable layers via left sidebar buttons:
  - **ADS-B Flights** - Square markers for military, circles for civilian
  - **AIS Vessels** - Triangle markers for ships, hollow ring clusters
  - **Intel Items** - Geolocated markers from news/anomaly events
- Clustering toggle (settings) groups nearby markers
- Military-only filter mode
- Layer visibility controls with stats bar counts
- Click markers for detail popups
- Zoom/pan with real-time marker updates

### 2. RAG-Grounded Intelligence Feed (IMPLEMENTED)
- Real-time feed of AI-generated intelligence cards
- Three tiers with color coding:
  - **ALERT** (red): High-confidence prediction of imminent event
  - **WATCH** (yellow): Anomalous pattern detected
  - **CONTEXT** (blue): Background analysis
- Each card shows: title, summary, confidence score, sources, timestamp
- Prediction cards track outcome accuracy

### 3. AI Chat Assistant (IMPLEMENTED)
- Natural language queries in bottom strip
- RAG-grounded responses citing specific sources
- Chat history maintained
- Uses configured chat model (from AI settings)
- Source citations inline

### 4. Anomaly Detection Engine (IMPLEMENTED)
- Statistical baselines per region/domain
- Z-score based anomaly detection
- Triggers intel item creation and predictions
- Active anomaly tracking in database

### 5. Prediction Engine (IMPLEMENTED)
- AI-generated predictions based on detected anomalies
- Structured output: prediction text, confidence %, timeframe, sources, reasoning, alternatives
- Deduplication: skips if recent prediction exists for same metric/region
- Outcome tracking: predictions can be resolved and rated for accuracy
- Anti-boilerplate: system prompt bans generic phrases, requires verifiable predictions
- Reads AI model from settings at call time (no restart needed for model changes)

### 6. AI Configuration (IMPLEMENTED)
- Slide-out drawer (AIPanel.tsx) for LLM model selection and connection management
- **Provider:** Ollama (unified API for local and cloud models)
- **Base URL:** Configurable, defaults to `http://localhost:11434`
- **Chat Model Selection:**
  - Dropdown auto-populates from Ollama's installed local models
  - Manual entry field for any model name (local or cloud)
  - Cloud models use `-cloud` suffix (e.g., `deepseek-v3.1:671b-cloud`)
  - Cloud models route through Ollama's cloud infrastructure
  - Privacy warning displayed when cloud model is active
- **Temperature Slider:** 0.0 (precise) to 1.0 (creative), stored as float
- **Embedding Model:** Fixed to `nomic-embed-text` (always runs locally)
- **Connection Testing:** Test button verifies Ollama connectivity and refreshes model list
- **No Restart Required:** All AI services read model from settings at call time via `getConfiguredModel()`
- **Currently Configured:** `deepseek-v3.1:671b-cloud` at temperature 0.3

**Cloud Model Convention:**
- Any model name ending in `-cloud` is treated as a cloud-hosted model
- Examples: `deepseek-v3.1:671b-cloud`, `llama4:120b-cloud`, `gpt-oss:120b-cloud`
- Same Ollama API endpoint (`/api/chat`) for both local and cloud
- Cloud models show blue "cloud" badge in the UI

### 7. Settings & Configuration (IMPLEMENTED)
- Slide-out drawer with toggle switches
- Sections: Data Sources, Alert Preferences, Map Preferences, Notifications, Data Retention
- Clustering toggle (on/off) for map markers
- Military-only display filter
- Saves to `data/settings.json`, applies immediately
- Settings-changed event propagates to all components

### 7. AI Configuration Panel (IMPLEMENTED)
- Model dropdown populated from Ollama
- Base URL configuration (default: localhost:11434)
- Temperature slider
- Test connection button
- Chat model selection (reads from/writes to settings.ai.chatModel)
- All AI services (predictor, llm, RAG pipeline) read model from settings at call time

## User Interface Layout

```
+---------------------------------------------------------------+
| INTEL BOARD          [Live stats bar]    [Settings] [AI]      |
+---------------------------------------------------------------+
| [ADS-B] |                                                     |
| [AIS]   |    SITUATION MAP          |   INTELLIGENCE FEED     |
| [Intel] |    (Mapbox GL)            |   (Scrollable cards)    |
|         |    Layered overlays       |   ALERT/WATCH/CONTEXT   |
|         |    Clustering toggle      |   + Predictions         |
|         |                          |                         |
+---------+--------------------------+-------------------------+
|  AI ASSISTANT: "Ask about any developing situation..."        |
|  > Chat input with source-cited responses                     |
+---------------------------------------------------------------+
```

## Technical Architecture

**Stack:** Electron + React 19 + TypeScript + Mapbox GL JS + Tailwind CSS v4 + SQLite + Ollama

**Frontend:** Electron app with React renderer, Mapbox GL for map, Tailwind for styling

**Backend:** Node.js main process with SQLite database, ChromaDB for vector storage, Ollama for LLM inference

**Build:** electron-vite with hot reload dev server. Use `npm run dev:debug` for CDP testing.

## Privacy & Security

- **Local-first:** All data processing on your machine
- **No cloud required:** Works offline with local LLM
- **No user tracking:** Zero telemetry
- **Source transparency:** Every AI claim traceable to raw data

## Success Metrics

1. **Detection speed:** Alert on developing events before mainstream media
2. **Accuracy:** >80% confidence on ALERT-tier predictions
3. **Zero hallucinations:** Every claim backed by retrieved source material
4. **Usability:** Non-technical users can query the system naturally

## Development Phases

### Phase 1: Foundation (COMPLETE)
- Electron app with React UI
- Mapbox GL map with dark theme
- ADS-B flight tracking
- AIS vessel tracking
- News ingestion
- Layer controls and clustering
- Settings and AI configuration panels

### Phase 2: AI Intelligence (COMPLETE)
- RAG pipeline (embed, retrieve, generate)
- Anomaly detection engine
- Prediction engine
- Intelligence feed with ALERT/WATCH/CONTEXT
- AI chat assistant

### Phase 3: Polish & Refinement (COMPLETE)
- Fix bugs found during testing (layer visibility, clustering, model settings)
- Improve prediction quality (anti-boilerplate prompts)
- Visual distinction between flight and vessel clusters
- Performance optimization
- Intelligence feed sorting and filter fixes
- Projection toggle (Globe/Mercator) and Region selector

### Phase 4: Asset Identification & Tactical Intel (CURRENT)

This phase transforms raw dots on a map into identified military assets with tactical significance. The goal: know not just THAT a military aircraft exists, but WHAT it is and whether its presence matters.

#### 4A: Aircraft Identification via ICAO24 Lookup

**Problem:** The ADS-B feed gives us `icao24` hex codes and callsigns but `aircraft_type` is always null. We know a plane is military but not whether it's a C-17 transport, KC-135 tanker, F-16 fighter, or E-4B Nightwatch.

**Solution:** Use HexDB.io (free, no API key required) to resolve ICAO24 hex codes to aircraft type, manufacturer, registration, and operator.

- API: `GET https://hexdb.io/api/v1/aircraft/{hex}`
- Returns: `ICAOTypeCode`, `Manufacturer`, `Registration`, `RegisteredOwners`, `Type`
- Example: hex `ae1463` returns `{"ICAOTypeCode":"C17","Manufacturer":"Boeing","Type":"C-17A Globemaster III"}`
- Also available: route lookup via callsign (`GET https://hexdb.io/api/v1/route/icao/{callsign}`), airport info
- Rate limit: generous (1.1M+ requests/day served)

**Implementation:**
1. When a military flight is detected, query HexDB with its icao24 hex
2. Cache results in SQLite (aircraft_registry table) to avoid repeated lookups
3. Populate the `aircraft_type` field in the flights table
4. Display aircraft type on map markers and in detail popups

**Callsign-to-Type Mapping (built-in fallback):**
For military aircraft where HexDB has no data, map known callsign prefixes to aircraft types:
- REACH/RCH → C-17A Globemaster III, C-5M Galaxy (strategic airlift)
- DUKE → F-15 Eagle (fighter)
- EVAC → C-130 Hercules (medical evacuation)
- VIPER → F-16 Fighting Falcon (fighter)
- FORGE/DRAG → KC-135 Stratotanker (aerial refueling)
- GRIM → MQ-9 Reaper (UAV)
- QID → RQ-4 Global Hawk (UAV)
- SENTRY → E-3 AWACS (airborne early warning)
- VIPER/SEAM → E-4B Nightwatch (National Airborne Operations Center)
- N/A → RC-135V/W Rivet Joint (reconnaissance)

#### 4B: Vessel Identification via MMSI/IMO Lookup

**Problem:** The AIS feed gives MMSI, IMO, and ship_name but doesn't classify military vessels by type/class. We know a ship is military but not if it's a destroyer, carrier, submarine, or amphibious assault ship.

**Solution:** Use a combination of approaches:
1. **Local naval vessel database:** Ship a static JSON/SQLite database of known naval vessels by MMSI/IMO, sourced from publicly available naval registers and Wikipedia military ship lists. Fields: name, class, type (carrier/destroyer/frigate/submarine/amphibious), country, displacement, capabilities.
2. **VesselFinder API** (free, web-based): Search by MMSI or IMO for vessel details including type and photos. Use for unknown vessels not in local DB.
3. **IMO GISIS** (free registration): International Maritime Organization's database for vessel verification.

**Implementation:**
1. Build local naval vessel registry (JSON file, ~500-1000 major naval vessels globally)
2. On vessel detection with military type code, check local registry by MMSI
3. If not found, attempt VesselFinder lookup
4. Cache results, display vessel class on map markers and in detail popups

#### 4C: Tactical Significance Engine

This is the intelligence layer that makes identified assets actionable.

**Aircraft Significance Rules:**
1. **Airlift Detection:** 5+ C-17/C-5 flights heading same direction within 4 hours = significant military logistics operation. Auto-generate ALERT with destination analysis.
2. **High-Value Aircraft (HVA) Tracking:** The following aircraft types are classified as HVAs. Their presence near conflict zones is always newsworthy.
   - **Command & Control:** E-4 / E-4B Nightwatch (NAOC), E-6 / E-6B Mercury (TACAMO), E-7 Wedgetail, E-8 JSTARS
   - **Airborne Early Warning:** E-2 Hawkeye, E-3 Sentry (AWACS)
   - **Intelligence & Recon:** RC-135V/W Rivet Joint, RC-135S Cobra Ball, RQ-4 Global Hawk, MQ-4 Triton, U-2 Dragon Lady
   - **VIP Transport:** VC-25 (Air Force One), C-32 (757 VIP), C-37 (Gulfstream V), C-40 (737 VIP)
   - **Maritime Patrol:** P-8 Poseidon, P-3 Orion
   - **Air Refueling Tankers:** KC-135 Stratotanker, KC-46 Pegasus, KC-10 Extender. Tankers loiter at altitude with transponders on, making them the most reliable indicator of sustained air operations near conflict zones. Fighters and bombers often go dark, but tankers cannot.
   - **Strategic Bombers:** B-52 Stratofortress, B-1 Lancer, B-2 Spirit
   - **Adversary Strategic:** Tu-95 Bear, Tu-160 Blackjack, Il-78 Midas (Russian tanker), Y-20 Kunpeng (Chinese strategic airlift), YY-20 (Chinese tanker)
3. **Region Context:** Same aircraft type has different significance based on location:
      - E-4B over Nebraska = training/transit (no alert)
   - E-4B over Eastern Mediterranean = major signal (ALERT)
   - B-52 over Barksdale AFB = routine (ignore)
   - B-52 over Baltic Sea = significant power projection (ALERT)
   - Tu-95 over Norwegian Sea = NATO intercept scenario (ALERT)
   - P-8 over Jacksonville = routine training (ignore)
   - P-8 over South China Sea = ISR collection (WATCH)
   - KC-135 over Kansas = routine (ignore)
   - KC-135 over Poland near Ukraine border = notable (WATCH)
   - KC-135 over Black Sea = sustained air operations (WATCH)
   - KC-46 over Eastern Mediterranean = refueling arc for strike package (WATCH)
   - Y-20 over Myanmar = expanding Chinese influence (WATCH)
4. **Formation Detection:** Multiple military aircraft in close proximity heading same direction = possible formation flight, escort operation, or exercise.
5. **Callsign Analysis:** Certain callsign patterns indicate specific operations (e.g., EVAC = medical evacuation, PAT = patrol mission).

**Vessel Significance Rules:**
1. **Naval Task Force Detection:** 3+ military vessels in formation within 50nm = task force. Cross-reference with regional tensions.
2. **Amphibious Ready Group (ARG):** LHD/LHA-class vessels with escorts near contested coastline = potential amphibious operation preparation.
3. **Carrier Strike Group (CSG):** CVN-class with cruiser/destroyer escort = power projection. Track movement patterns.
4. **Submarine Transit:** Known submarine tender or submarine support vessel transiting choke point = possible submarine deployment.
5. **Unusual Destination:** Military vessel heading to an unexpected port (e.g., Russian vessel heading to a South American port) = diplomatic signal.

**Region-Aware Scoring:**
Define conflict/sensitivity zones with different alert thresholds:
- High sensitivity: Eastern Mediterranean, South China Sea, Taiwan Strait, Korean Peninsula, Persian Gulf, Black Sea, Baltic Sea
- Medium sensitivity: Horn of Africa, Gulf of Aden, Arctic passages
- Low sensitivity: Open ocean transit routes, home waters (continental US, Western Europe peacetime)

**Conflict Zone Definitions (center lat/lon, radius nm):**
```json
[
  {"name": "Eastern Mediterranean", "lat": 34, "lon": 35, "radius": 400, "sensitivity": "high"},
  {"name": "South China Sea", "lat": 12, "lon": 114, "radius": 500, "sensitivity": "high"},
  {"name": "Taiwan Strait", "lat": 24, "lon": 119, "radius": 200, "sensitivity": "high"},
  {"name": "Persian Gulf", "lat": 26, "lon": 52, "radius": 300, "sensitivity": "high"},
  {"name": "Black Sea", "lat": 44, "lon": 34, "radius": 350, "sensitivity": "high"},
  {"name": "Korean Peninsula", "lat": 38, "lon": 127, "radius": 300, "sensitivity": "high"},
  {"name": "Baltic Sea", "lat": 58, "lon": 20, "radius": 400, "sensitivity": "high"},
  {"name": "Gulf of Aden", "lat": 12, "lon": 45, "radius": 200, "sensitivity": "medium"},
  {"name": "Arctic", "lat": 75, "lon": 0, "radius": 1000, "sensitivity": "medium"}
]
```

#### 4D: Enhanced Map Display

- Military aircraft markers show aircraft type abbreviation (C-17, F-16, KC-135, etc.)
- Military vessel markers show vessel class abbreviation (DDG, CVN, SSN, etc.)
- HVA markers get a distinct visual treatment (larger, pulsing border, or star icon)
- Click on any military asset shows full identification: type, callsign, operator, registration, altitude/speed, and tactical significance assessment
- Airlift/task force detections show a connecting line between related assets
- Region boundaries shown as subtle dashed circles on the map when sensitivity zones are active

#### 4E: Automated Intel Generation

When the tactical significance engine detects a pattern, it auto-generates intel items:
- ALERT: "Airlift operation detected: 7 C-17A Globemaster III aircraft transiting from US to Ramstein AB, Germany in the past 3 hours. Likely major logistical deployment."
- ALERT: "E-4B Nightwatch (NAOC) detected over Eastern Mediterranean. National Command Authority aircraft presence indicates elevated command posture."
- WATCH: "Carrier Strike Group transiting Strait of Hormuz. CVN-78 group with 3 DDG escort vessels detected. Regional tensions elevated."
- WATCH: "3 RC-135V Rivet Joint reconnaissance aircraft operating near Baltic Sea. Signals intelligence collection pattern detected."

These auto-generated items are fed into the existing intel feed with the same ALERT/WATCH/CONTEXT tier system and confidence scoring.

#### 4F: Carrier Strike Group Tracker

Persistent tracking of carrier strike groups (CSGs) and amphibious ready groups (ARGs) using two complementary data sources:

**Source A: USNI News Fleet Tracker (weekly strategic picture)**
- Scrape `https://news.usni.org/category/fleet-tracker` weekly
- Parse carrier names (USS Eisenhower, USS Vinson, etc.), strike group composition, and approximate operating areas
- Provides known deployment data even when ships go AIS-dark
- Updated every Monday

**Source B: AIS Live Tracking (real-time tactical supplement)**
- Cross-reference USNI-reported ship names with live AIS data
- Match by MMSI (exact) first, then by normalized vessel name
- **Guard 1: Water sanity check** - Reject AIS positions on land (simple lat/lon bounds check)
- **Guard 2: MMSI-first matching** - Prefer exact MMSI matches over name matches to avoid false positives
- **Guard 3: Operating area proximity** - Reject AIS matches more than 2000nm from the USNI-reported operating area
- **Guard 4: Confidence levels** - AIS positions flagged as LOW confidence if name-only match, HIGH if MMSI confirmed
- AIS never overrides USNI position for the strategic picture, only supplements when confirmed
- Known Navy MMSI lookup table for reliable matching

**CSG Marker Design:**
- Distinct map marker (carrier silhouette or anchor icon) different from regular military vessel triangles
- Shows carrier name and strike group designation
- Click for full group composition (CVN, CG, DDGs, supply ship)
- Dashed circle showing estimated patrol radius (~200nm)

**Data Model:**
- `carrier_groups` table: group_id, name (e.g. "CSG-2"), flagship (e.g. "USS Eisenhower CVN-69"), status (deployed/in-port/transiting), operating_area, lat, lon, last_updated, source (usni/ais/both)
- `carrier_group_vessels` table: vessel_id, group_id, vessel_name, vessel_type (CVN/CG/DDG/AOE/LHD), mmsi, lat, lon
- Updated weekly from USNI, real-time from AIS

#### 4H: Remote HTTP Server (IMPLEMENTED)

Access the Intel Board from any device on the local network (phone, iPad, laptop) via a built-in HTTP server.

- **URL:** `http://<host-ip>:3210` (configurable port)
- **Transport:** REST API shim replaces Electron IPC for browser clients
- **Lite endpoints:** Capped GeoJSON payloads (5000 features, military priority) for mobile performance
- **Mobile layout:** Map at 50vh, intel feed stacks below, full page scrolling
- **CSP handling:** Permissive CSP injected for remote browsers; Electron window unchanged

#### 4I: GFW Vessel Presence Supplement (PLANNED)

Supplement AISStream.io with Global Fishing Watch (GFW) 4Wings API data for choke point areas where terrestrial AIS coverage is poor (e.g., Strait of Hormuz, Malacca).

**Problem:** AISStream.io only aggregates terrestrial (land-based) AIS receivers. Areas like the Strait of Hormuz have limited receiver coverage on the Iranian side, resulting in sparse vessel data.

**Solution:** Use GFW's free (non-commercial) 4Wings API to periodically poll vessel presence data for defined choke point polygons. GFW combines terrestrial AND satellite AIS data, filling the coverage gap.

**GFW API Details:**
- Base URL: `https://gateway.api.globalfishingwatch.org/v3`
- Auth: Bearer token (free registration at globalfishingwatch.org)
- Dataset: `public-global-presence:latest` (all vessel types, global AIS presence)
- Bonus: `public-global-sar-presence:latest` (SAR satellite detections, catches "dark" vessels with AIS off)
- Endpoint: `POST /4wings/report` with GeoJSON polygon + date range
- Response: Gridded vessel presence data (lat/lon/hours/vesselIDs per cell)
- Data lag: ~96 hours (4 days behind real-time)
- Rate limit: 1 concurrent report on free tier
- Cost: Free for non-commercial use

**Choke Point Polygons (to be defined):**
1. Strait of Hormuz
2. Strait of Malacca
3. Bab el-Mandeb
4. Suez Canal approaches
5. Strait of Gibraltar
6. Taiwan Strait
7. Bosporus/Dardanelles

**Integration Plan:**
1. Add `GFW_API_TOKEN` to `.env` file
2. Create `src/main/services/remote/gfwService.ts` for API polling
3. Poll every 6-12 hours per choke point
4. Store results in `gfw_presence` SQLite table
5. Merge GFW presence data into the AIS layer as supplemental heatmap or markers
6. SAR dark vessel detections flagged distinctly on the map

**Data Model:**
```sql
CREATE TABLE gfw_presence (
    id TEXT PRIMARY KEY,
    chokepoint TEXT NOT NULL,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    vessel_count INTEGER,
    presence_hours REAL,
    vessel_types TEXT,          -- JSON: {cargo: 5, tanker: 3, ...}
    flag_states TEXT,            -- JSON: ["IRN", "USA", "CHN"]
    dataset TEXT,                -- 'ais-presence' or 'sar-detections'
    date TEXT NOT NULL,
    fetched_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

**Architecture:**
```
GFW 4Wings API (6-12h poll)
    → gfwService.ts
    → SQLite gfw_presence table
    → HTTP endpoint /api/gfw/chokepoints
    → Map overlay (heatmap layer on SituationMap)
```

### Phase 5: Advanced Features (NEXT)
- Weather overlay
- Economic indicators
- Custom alert rules
- Export/share intelligence briefs
- Click-for-brief on map markers
- Conversational map queries

### Phase 6: Deploy (FUTURE)
- Offline mode
- Auto-update
- Multi-platform packaging
- Documentation

## External API Reference

### Aircraft Identification
| API | Endpoint | Auth | Cost | Returns |
|-----|----------|------|------|----------|
| HexDB.io | `GET https://hexdb.io/api/v1/aircraft/{hex}` | None | Free | ICAOTypeCode, Manufacturer, Registration, Operator, Type |
| HexDB.io Route | `GET https://hexdb.io/api/v1/route/icao/{callsign}` | None | Free | Flight route (origin-dest ICAO codes) |
| HexDB.io Airport | `GET https://hexdb.io/api/v1/airport/icao/{icao}` | None | Free | Airport name, coordinates, country |
| ADS-B Exchange | `GET https://adsbexchange.com/api/aircraft/icao/{hex}` | API key | Free tier | Full aircraft data + position |

### Vessel Identification
| API | Endpoint | Auth | Cost | Returns |
|-----|----------|------|------|----------|
| VesselFinder | Web search by MMSI/IMO | None | Free | Vessel type, class, flag, photos |
| IMO GISIS | `https://gisis.imo.org` | Free account | Free | Official vessel registration data |
| Local Naval DB | Static JSON file | None | Free | Pre-built naval vessel class/type data |

### Carrier Strike Group Tracking
| API | Endpoint | Auth | Cost | Returns |
|-----|----------|------|------|----------|
| USNI Fleet Tracker | `https://news.usni.org/category/fleet-tracker` | None | Free | Weekly CSG/ARG deployment reports with ship names and operating areas |
| AIS (existing) | AISStream.io WebSocket | API key | Free | Live vessel positions for cross-referencing carrier group ships |

### GFW Vessel Presence (Supplemental AIS)
| API | Endpoint | Auth | Cost | Returns |
|-----|----------|------|------|----------|
| GFW 4Wings Report | `POST https://gateway.api.globalfishingwatch.org/v3/4wings/report` | Bearer token | Free (non-commercial) | Gridded vessel presence data (lat/lon/hours/vessel count) for any polygon |
| GFW 4Wings PNG | `POST https://gateway.api.globalfishingwatch.org/v3/4wings/generate-png` | Bearer token | Free (non-commercial) | Map tile style for heatmap visualization |
| GFW SAR Detections | Same 4Wings endpoint with `public-global-sar-presence:latest` dataset | Bearer token | Free (non-commercial) | Satellite radar vessel detections (catches dark vessels) |
| GFW Vessel Search | `GET https://gateway.api.globalfishingwatch.org/v3/vessels/search` | Bearer token | Free (non-commercial) | Vessel identity by MMSI/IMO/name |
| GFW Events | `GET https://gateway.api.globalfishingwatch.org/v3/events` | Bearer token | Free (non-commercial) | Encounters, port visits, loitering, AIS gaps |

**Registration:** https://globalfishingwatch.org/our-apis/documentation
**Data lag:** ~96 hours (4 days). Not real-time, supplements AISStream for coverage gaps.
**Key advantage:** SAR dataset detects vessels with AIS transponders turned off.
