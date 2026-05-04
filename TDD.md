# Intel Board - Technical Design Document (TDD)

## Tech Stack

### Frontend
- **Electron 39+** (desktop app shell)
- **React 19** with TypeScript
- **Vite 7** via **electron-vite 5** (main, preload, renderer)
- **Mapbox GL JS** for geospatial visualization
- **Tailwind CSS v4** via `@tailwindcss/vite`

### Backend (Embedded in Electron)
- **Node.js** (Electron main process)
- **SQLite** via `better-sqlite3` (structured data storage)
- **ChromaDB** (embedded vector database for RAG)

### AI/ML Layer
- **LLM Service** (`rag/llm.ts`): Centralized chat() function for all LLM calls
  - Multi-provider: local Ollama + OpenAI-compatible cloud providers (ZAI, Groq, etc.)
  - Resolution: cloud (if configured) → local Ollama → fallback model
  - Tracks actual model used and fallback status
- **Embeddings:** `nomic-embed-text` via Ollama (always local)
- **No raw API calls:** All services use centralized chat()

## Project Structure (ACTUAL)

```
intel-board/
├── package.json
├── electron.vite.config.ts
├── electron-builder.yml
├── PRD.md
├── TDD.md
├── ITERATIONS.md
├── TEST-RESULTS.md
├── README.md
├── data/
│   └── settings.json              # Persisted app settings
├── src/
│   ├── main/
│   │   ├── index.ts               # Electron main process entry
│   │   ├── ipc/
│   │   │   ├── adsb.handlers.ts   # ADS-B data IPC
│   │   │   ├── ai.handlers.ts     # AI chat IPC
│   │   │   ├── ais.handlers.ts    # AIS data IPC
│   │   │   ├── anomaly.handlers.ts# Anomaly data IPC
│   │   │   ├── data.handlers.ts   # Articles, intel items, ingestion
│   │   │   ├── prediction.handlers.ts # Prediction CRUD + accuracy
│   │   │   ├── rag.handlers.ts    # RAG query, models, status
│   │   │   └── settings.handlers.ts # Settings CRUD, model listing
│   │   ├── services/
│   │   │   ├── adsb/adsbService.ts       # OpenSky polling
│   │   │   ├── ais/aisService.ts         # AISStream WebSocket
│   │   │   ├── analysis/predictor.ts     # AI predictions (90-min, HIGH/CRITICAL, max 3/cycle, failure backoff)
│   │   │   ├── anomaly/anomalyEngine.ts  # Statistical anomaly detection
│   │   │   ├── csg/
│   │   │   │   ├── csgService.ts         # CSG management, context string with intel snippets
│   │   │   │   ├── usniScraper.ts         # AI-powered USNI Fleet Tracker + intel storage
│   │   │   │   ├── twzScraper.ts          # TWZ Carrier Tracker scraper for CSG intel
│   │   │   │   └── aisMatcher.ts         # AIS matching with 6-layer guard
│   │   │   ├── ingestion/
│   │   │   │   ├── news.ts               # GDELT news ingestion
│   │   │   │   ├── processor.ts          # Data processing pipeline
│   │   │   │   └── scheduler.ts          # Ingestion scheduling
│   │   │   ├── rag/
│   │   │   │   ├── chunker.ts            # Text chunking
│   │   │   │   ├── embedder.ts           # nomic-embed-text embedding
│   │   │   │   ├── llm.ts               # Centralized LLM service (multi-provider, fallback, metadata)
│   │   │   │   ├── pipeline.ts           # Full RAG pipeline
│   │   │   │   └── retriever.ts          # ChromaDB vector search
│   │   │   └── storage/
│   │   │       ├── database.ts           # SQLite schema + init
│   │   │       ├── dbService.ts          # SQLite CRUD operations
│   │   │       ├── chromaProcess.ts      # ChromaDB process management
│   │   │       ├── ollamaProcess.ts      # Ollama process management
│   │   │       └── vectordb.ts           # ChromaDB operations
│   │   └── utils/config.ts              # App configuration
│   ├── preload/index.ts                  # IPC bridge (contextBridge)
│   ├── renderer/
│   │   ├── index.html
│   │   └── src/
│   │       ├── main.tsx
│   │       ├── App.tsx
│   │       ├── assets/main.css
│   │       ├── env.d.ts                 # Type declarations for IPC
│   │       ├── components/
│   │       │   ├── layout/
│   │       │   │   ├── AppShell.tsx      # Main layout, layer state
│   │       │   │   ├── HeaderBar.tsx     # Top bar with buttons
│   │       │   │   ├── StatusBar.tsx     # Stats (flight/vessel counts)
│   │       │   │   ├── IntelFeedPanel.tsx # Feed of intel items
│   │       │   │   └── AiAssistantStrip.tsx # Chat input/output
│   │       │   ├── map/
│   │       │   │   ├── SituationMap.tsx  # Map container, settings listener
│   │       │   │   ├── LayerControls.tsx # Left sidebar layer toggles
│   │       │   │   ├── FlightLayer.tsx   # ADS-B markers + clustering
│   │       │   │   ├── ShipLayer.tsx     # AIS markers + clustering
│   │       │   │   ├── IntelLayer.tsx    # Intel item markers
│   │       │   │   ├── TacticalOverlayLayer.tsx # Persistent map annotations
│   │       │   │   ├── MapDrawLayer.tsx  # Leaflet.Draw integration
│   │       │   │   ├── AnnotationToolbar.tsx # Create/edit/delete annotations
│   │       │   │   ├── AnnotationPopup.tsx  # Edit annotation properties
│   │       │   │   ├── ConflictZoneLayer.tsx # Dynamic conflict zones
│   │       │   │   ├── CarrierLayer.tsx  # CSG markers
│   │       │   │   ├── AlertZoneLayer.tsx # Alert zones
│   │       │   │   ├── RegionLayer.tsx   # Region boundaries
│   │       │   │   ├── TransitCorridorLayer.tsx # Choke points
│   │       │   │   └── UnifiedMapPopup.tsx # Unified marker popup
│   │       │   ├── feed/
│   │       │   │   ├── IntelFeedCard.tsx # Intel item display card
│   │       │   │   └── PredictionCard.tsx # Prediction display card
│   │       │   ├── settings/
│   │       │   │   ├── SettingsPanel.tsx # Settings slide-out drawer
│   │       │   │   └── AIPanel.tsx       # AI model configuration
│   │       │   └── chat/
│   │       │       ├── ChatMessage.tsx   # Chat message bubble with export buttons
│   │       │       └── SourceCitation.tsx # Inline source reference
│   │       └── stores/                   # (Zustand if needed)
│   └── shared/types.ts                  # Shared type definitions
```

## Database Schema (IMPLEMENTED)

### SQLite Tables

```sql
-- Raw data
CREATE TABLE articles (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    title TEXT,
    content TEXT,
    url TEXT,
    published_at DATETIME,
    ingested_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    sentiment REAL,
    entities TEXT,
    region TEXT,
    topics TEXT
);

CREATE TABLE flights (
    id TEXT PRIMARY KEY,
    icao24 TEXT,
    callsign TEXT,
    origin_country TEXT,
    latitude REAL, longitude REAL,
    altitude REAL, velocity REAL, heading REAL,
    is_military BOOLEAN,
    aircraft_type TEXT,
    timestamp DATETIME
);

CREATE TABLE vessels (
    id TEXT PRIMARY KEY,
    mmsi TEXT, imo TEXT,
    ship_name TEXT, ship_type TEXT,
    latitude REAL, longitude REAL,
    speed REAL, heading REAL,
    destination TEXT,
    timestamp DATETIME
);

-- AI outputs
CREATE TABLE intel_items (
    id TEXT PRIMARY KEY,
    tier TEXT CHECK(tier IN ('ALERT', 'WATCH', 'CONTEXT')),
    title TEXT NOT NULL,
    summary TEXT, analysis TEXT,
    confidence REAL,
    sources TEXT,
    region TEXT,
    categories TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME,
    expires_at DATETIME
);

CREATE TABLE anomalies (
    id TEXT PRIMARY KEY,
    source_type TEXT,
    metric TEXT, region TEXT,
    baseline_value REAL,
    observed_value REAL,
    deviation_sigma REAL,
    detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME,
    status TEXT DEFAULT 'active'
);

CREATE TABLE predictions (
    id TEXT PRIMARY KEY,
    prediction_text TEXT,
    confidence REAL,
    model_used TEXT,
    sources TEXT,
    predicted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expected_by DATETIME,
    outcome TEXT,
    resolved_at DATETIME,
    was_accurate BOOLEAN
);

-- CSG strategic intel (weekly article context)
CREATE TABLE csg_intel (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    group_id TEXT NOT NULL,
    group_name TEXT NOT NULL,
    week_of TEXT NOT NULL,
    raw_text TEXT NOT NULL,
    source TEXT NOT NULL,  -- 'usni' or 'twz'
    source_url TEXT NOT NULL,
    scraped_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(group_id, week_of, source)
);
```

## Map Layer Architecture

### SituationMap.tsx
- Creates Mapbox GL map instance
- Holds `mapRef`, `mapReady` state
- Reads settings via `refreshSettings()` on mount + `settings-changed` event
- Passes `clustering` and `visible` props to child layers
- Uses `key={dataType-${clustering}}` to force remount on clustering change

### FlightLayer.tsx
- ADS-B flight markers as square (military) or circle (civilian) icons
- Dual-source architecture: main source + military source
- Clustering via Mapbox GL GeoJSON `cluster: true/false`
- Generation counter (`_generation`) prevents cleanup race condition during key-change remounts
- Visibility useEffect hides/shows all layers based on `visible` prop
- Data streaming via IPC: `window.api.adsb.getGeoJSON()` + `onGeoJSONUpdated()`

### ShipLayer.tsx
- AIS vessel markers as triangle icons (heading-aware rotation)
- Ship types: military (red, 14px), cargo (cyan), tanker (amber), passenger (white), other (gray)
- Same dual-source + clustering architecture as FlightLayer
- Hollow ring style for clusters (vs solid circles for flights)
- Generation counter for safe cleanup during remounts
- Direct `addSourcesAndLayers()` call (no `isStyleLoaded` guard needed since SituationMap gates rendering behind `mapReady`)

### IntelLayer.tsx
- Geolocated markers from news/anomaly events
- Tied to intel items from the feed

### LayerControls.tsx
- Left sidebar with 3 toggle buttons: ADS-B Flights, AIS Vessels, Intel Items
- `aria-pressed` for accessibility state
- Default state: all enabled (`{adsb: true, ais: true, intel: true}`)

## Settings Architecture

### Settings File
- Location: `data/settings.json` (relative to app)
- Schema:

```typescript
interface AppSettings {
  dataSources: {
    adsb: { enabled: boolean; intervalMs: number }
    ais: { enabled: boolean; intervalMs: number }
    news: { enabled: boolean; intervalMs: number }
  }
  alerts: {
    militaryFlights: boolean
    chokePoints: boolean
    newsSpikes: boolean
  }
  map: {
    militaryOnly: boolean
    clustering: boolean
  }
  notifications: {
    alert: boolean
    watch: boolean
    context: boolean
  }
  retentionDays: number
  ai: {
    baseUrl: string
    chatModel: string
    temperature: number
  }
}
```

### Settings Change Flow
1. User toggles setting in SettingsPanel → local state updates
2. User clicks Save → `window.api.settings.save(settings)` → IPC to main
3. Main process writes to `data/settings.json`
4. Main process dispatches `window.dispatchEvent(new CustomEvent('settings-changed'))`
5. SituationMap's `settings-changed` listener calls `refreshSettings()`
6. `refreshSettings()` reads updated settings, updates React state
7. State change triggers re-render with new props (clustering, militaryOnly)
8. Key change forces layer remount with new configuration

## AI Model Configuration

### Architecture
- **Centralized LLM Service** (`rag/llm.ts`): Single `chat()` function used by all AI services
- **Multi-provider:** Local Ollama + OpenAI-compatible cloud providers (ZAI, OpenAI, Groq)
- **Resolution order:** Cloud provider (if configured) → local Ollama → fallback model
- **Metadata tracking:** Actual model used and fallback status returned with every call
- **No restart needed:** All services read settings at call time

### AIPanel.tsx (Renderer Settings UI)
- Slide-out drawer for AI configuration
- **Local Ollama:** Base URL, model dropdown (auto-populated), manual entry, temperature
- **Cloud Provider:** Provider selector, base URL, API key, model name, independent temperature
- **Fallback:** Optional fallback to local Ollama when cloud fails
- **Connection Test:** Tests connectivity for both local and cloud providers
- **Settings stored in:** `data/settings.json` → ai.* keys

### Token Conservation
- **Predictor:** 90-min interval (was 30), HIGH/CRITICAL anomalies only, max 3 per cycle
- **Failure backoff:** 30-min cooldown after 3 consecutive LLM failures (predictor + sense-making)
- **No-markdown rule:** All prompts use plain text, explicit instructions for natural prose output
- **Result:** ~4 LLM calls/hr (was ~12), 67% reduction

### Services Using Chat Model
- `predictor.ts` - Strategic predictions (90-min cycle, failure backoff)
- `predictionReviewer.ts` - Prediction accuracy review (2h cycle)
- `senseMakingEngine.ts` - Cross-source analysis (30-min cycle, failure backoff)
- `pipeline.ts` - RAG pipeline chat
- `processor.ts` - Article analysis and intel enrichment
- `usniScraper.ts` - AI-powered CSG parsing

### Embedding Model
- Fixed: `nomic-embed-text` (274 MB, always runs locally)
- Used by vector DB for RAG context retrieval
- Not configurable via UI (deliberate: embeddings must be consistent)

### Anti-Boilerplate (Predictor)
System prompt explicitly bans generic phrases:
- "high likelihood of increased military activity"
- "warrants monitoring"
- "remains a concern"
- "likely to continue"
- "may escalate"
- Requires every prediction to be verifiable

### IPC Handlers
- `settings:get` - Returns full settings including `ai` config
- `settings:save` - Writes settings to `data/settings.json`
- `settings:listModels` - Fetches available models from Ollama API
- `settings:testConnection` - Tests Ollama connectivity

## Data Flow

### ADS-B (Flights)
```
OpenSky API → adsbService.ts (polling) → IPC streaming → FlightLayer.tsx → Mapbox GL markers
```

### AIS (Vessels)
```
AISStream.io WebSocket → aisService.ts → IPC streaming → ShipLayer.tsx → Mapbox GL markers
```

### News
```
GDELT API → news.ts (scheduler) → processor.ts → SQLite + ChromaDB → IntelFeedPanel.tsx
```

### Anomalies
```
anomalyEngine.ts (baselines + z-scores) → SQLite → anomaly.handlers.ts → Intel items
```

### Predictions
```
Anomaly trigger → predictor.ts → RAG context → Ollama LLM → Parse structured response → SQLite → PredictionCard.tsx
```

## IPC Channels (Preload Bridge)

All renderer-to-main communication via `window.api.*`:

| Namespace | Methods |
|-----------|---------|
| `adsb` | getMarkers, getGeoJSON, getDetails, getCount, getMilitaryCount, startPolling, stopPolling, pollNow |
| `ais` | getMarkers, getGeoJSON, getDetails, getCount, getCountsByCategory, getChokePoints, startStreaming, stopStreaming, getStatus, onGeoJSONUpdated |
| `ai` | chat, getHistory, clearHistory |
| `chatExport` | messageMarkdown, messagePdf, conversationMarkdown, conversationPdf |
| `settings` | get, save, listModels, testConnection |
| `rag` | query, quickAnalysis, listModels, status |
| `data` | ingestion.start/stop/status/trigger, search, articles.*, intel.* |
| `predictions` | getUnresolved, resolve, getAccuracy |
| `anomalies` | getActive, getCount |
| `annotations` | getAll, create, update, delete |
| `zones` | list, detail, history, refresh |
| `export` | intelReportMarkdown, intelReportPdf |
| `notifications` | sendTest, getChannels, getStatus |
| `alertRules` | getAll, create, update, delete, test |

## Development Commands

```bash
npm run dev          # Start dev server (hot reload)
npm run dev:debug    # Dev server + remote debugging port 9222 (for CDP testing)
npm run build        # Typecheck + build
npm run start        # Preview built app
```

## Phase 4: Asset Identification & Tactical Intel

### New Files to Create

```
src/main/services/identification/
├── aircraftLookup.ts       # HexDB.io ICAO24 lookup + caching
├── vesselLookup.ts         # MMSI/IMO lookup (local DB + VesselFinder)
├── callsignDecoder.ts      # Military callsign → aircraft type mapping
└── tacticalEngine.ts       # Pattern detection + significance scoring

src/main/services/identification/data/
├── naval-vessel-registry.json  # ~500-1000 known naval vessels
└── conflict-zones.json         # Region sensitivity definitions

src/main/ipc/
└── identification.handlers.ts  # IPC for asset detail lookups
```

### Database Additions

```sql
-- Aircraft registry cache
CREATE TABLE aircraft_registry (
    icao24 TEXT PRIMARY KEY,
    aircraft_type TEXT,          -- e.g. 'C-17A Globemaster III'
    icao_type_code TEXT,         -- e.g. 'C17'
    manufacturer TEXT,
    registration TEXT,
    operator TEXT,
    is_military BOOLEAN,
    category TEXT,               -- 'fighter', 'transport', 'tanker', 'recon', 'awacs', 'bomber', 'uav', 'hva'
    looked_up_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Naval vessel registry cache
CREATE TABLE vessel_registry (
    mmsi TEXT PRIMARY KEY,
    vessel_name TEXT,
    vessel_class TEXT,           -- e.g. 'Nimitz-class', 'Arleigh Burke-class'
    vessel_type TEXT,            -- e.g. 'aircraft carrier', 'destroyer', 'submarine'
    hull_number TEXT,
    country TEXT,
    displacement_tons INTEGER,
    capabilities TEXT,           -- JSON array
    is_hva BOOLEAN DEFAULT FALSE, -- high-value asset
    looked_up_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Tactical events (auto-generated from pattern detection)
CREATE TABLE tactical_events (
    id TEXT PRIMARY KEY,
    event_type TEXT,             -- 'airlift', 'task_force', 'hva_tracking', 'formation', 'formation_flight'
    severity TEXT,               -- 'ALERT', 'WATCH', 'CONTEXT'
    description TEXT,
    assets TEXT,                 -- JSON array of involved asset IDs
    region TEXT,
    detected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME,
    status TEXT DEFAULT 'active'
);
```

### HexDB.io Integration (Aircraft Lookup)

**API Details:**
- Endpoint: `GET https://hexdb.io/api/v1/aircraft/{hex}`
- Auth: None required
- Rate: 1.1M+ requests/day (very generous)
- Response: `{ICAOTypeCode, Manufacturer, ModeS, OperatorFlagCode, RegisteredOwners, Registration, Type}`
- Also: Route lookup `GET https://hexdb.io/api/v1/route/icao/{callsign}` returns origin-dest airports

**Lookup Strategy:**
1. On military flight detection, check local `aircraft_registry` cache first
2. If not cached, query HexDB.io
3. Parse response, determine military category from ICAOTypeCode
4. Store in cache for future use
5. Rate limit: batch lookups, max 1 request per second, only lookup new icao24 codes

**Callsign Fallback (no HexDB data):**
```typescript
const CALLSIGN_TYPE_MAP: Record<string, { type: string; category: string }> = {
  // Strategic airlift
  REACH: { type: 'C-17A/C-5M', category: 'transport' },
  RCH:   { type: 'C-17A/C-5M', category: 'transport' },
  EVAC:  { type: 'C-130 Hercules', category: 'transport' },
  // Fighters
  DUKE:  { type: 'F-15 Eagle', category: 'fighter' },
  VIPER: { type: 'F-16 Fighting Falcon', category: 'fighter' },
  HAMER: { type: 'F-35 Lightning II', category: 'fighter' },
  RAPTR: { type: 'F-22 Raptor', category: 'fighter' },
  // Tankers
  FORGE: { type: 'KC-135 Stratotanker', category: 'tanker' },
  DRAG:  { type: 'KC-135/KC-46', category: 'tanker' },
  // ISR / UAV
  GRIM:  { type: 'MQ-9 Reaper', category: 'uav' },
  QID:   { type: 'RQ-4 Global Hawk', category: 'uav' },
  // Airborne Command & Control / AEW
  SENTRY:  { type: 'E-3 Sentry (AWACS)', category: 'hva' },
  FOAL:   { type: 'E-8 JSTARS', category: 'hva' },
  NIGHT:  { type: 'E-4B Nightwatch', category: 'hva' },
  TACAMO: { type: 'E-6B Mercury', category: 'hva' },
  WEDGE:  { type: 'E-7 Wedgetail', category: 'hva' },
  // Reconnaissance
  HOMER:  { type: 'RC-135V/W Rivet Joint', category: 'hva' },
  COBRA:  { type: 'RC-135S Cobra Ball', category: 'hva' },
  // Maritime Patrol
  TRACER: { type: 'P-8 Poseidon', category: 'hva' },
  // VIP
  AFS1:   { type: 'VC-25 (Air Force One)', category: 'hva' },
  EXEC:   { type: 'C-32/C-40 VIP', category: 'hva' },
}

// HVA ICAO type codes for identification from HexDB data
const HVA_ICAO_TYPES: Set<string> = new Set([
  'E3', 'E3A', 'E3B', 'E3C', 'E3D',  // E-3 Sentry
  'E4', 'E4B',                         // E-4 Nightwatch
  'E6', 'E6A', 'E6B',                 // E-6 Mercury
  'E7', 'E7A', 'E7W',                 // E-7 Wedgetail
  'E8', 'E8A', 'E8C',                 // E-8 JSTARS
  'E2', 'E2C', 'E2D',                 // E-2 Hawkeye
  'RC1', 'RC35', 'RC13', 'R135',      // RC-135 variants
  'P8', 'P8A', 'P8I',                 // P-8 Poseidon
  'P3', 'P3C', 'P3O',                  // P-3 Orion
  'RQ4', 'MQ4',                        // Global Hawk / Triton
  'U2', 'U2R', 'U2S',                 // U-2 Dragon Lady
  'VC2', 'VC25',                       // VC-25 Air Force One
  'C32', 'C32A',                       // C-32 VIP
  'C37', 'C37A', 'C37B',              // C-37 VIP
  'C40', 'C40A', 'C40B', 'C40C',      // C-40 VIP
  'B52', 'B52H',                       // B-52
  'B1', 'B1B',                         // B-1 Lancer
  'B2', 'B2A',                         // B-2 Spirit
  'TU95', 'T95',                       // Tu-95 Bear
  'TU160', 'T160',                     // Tu-160 Blackjack
  'Y20', 'Y20U',                       // Y-20 Kunpeng
  // Air Refueling Tankers
  'K35', 'K35R', 'K35T',                // KC-135 Stratotanker
  'K46', 'K46A',                         // KC-46 Pegasus
  'K10', 'K10A',                         // KC-10 Extender
  'IL78', 'I78',                         // Il-78 Midas (Russian)
  'YY20',                                // YY-20 (Chinese tanker)
])
```

### Tactical Significance Engine

**Runs on each polling cycle** (after ADS-B/AIS data refresh):

1. **Airlift Detection:**
   - Query flights with military transport callsigns (REACH, RCH) in last 4 hours
   - Group by bearing/direction (within 30° tolerance)
   - If 5+ aircraft in same direction → generate ALERT
   - Use HexDB route data to determine origin/destination if available

2. **HVA Proximity:**
   - Check if any high-value aircraft is within a conflict zone. HVA types include:
     - Command & Control: E-4/E-4B, E-6/E-6B, E-7, E-8
     - Airborne Early Warning: E-2, E-3
     - Intelligence & Recon: RC-135V/W, RC-135S, RQ-4, MQ-4, U-2
     - VIP Transport: VC-25, C-32, C-37, C-40
     - Air Refueling Tankers: KC-135, KC-46, KC-10, Il-78, YY-20
     - Maritime Patrol: P-8, P-3
     - Strategic Bombers: B-52, B-1, B-2
     - Adversary Strategic: Tu-95, Tu-160, Y-20
   - Tankers are a key indicator: fighters/bombers often go dark (Mode S off, low altitude), but tankers loiter at altitude with transponders on. A tanker orbit near a conflict zone is the most reliable public signal of sustained air operations.
   - Conflict zones defined in `conflict-zones.json` with center, radius, and sensitivity level
   - Generate WATCH or ALERT based on aircraft type × zone sensitivity

3. **Naval Formation Detection:**
   - Query military vessels, group by proximity (within 50nm) and similar heading
   - If 3+ vessels in formation → classify as task force, check vessel types
   - ARG/CSG patterns: LHD/LHA + DDG = amphibious ready group, CVN + CG + DDG = carrier strike group

4. **Choke Point Transit:**
   - Monitor known choke points for military vessel transits
   - Cross-reference with regional tensions (from news sentiment data)

**Significance Scoring:**
```typescript
interface TacticalScore {
  assetType: string        // e.g. 'E-4B Nightwatch'
  zone: string             // e.g. 'Eastern Mediterranean'
  sensitivity: 'high' | 'medium' | 'low'
  score: number            // 0-100
  tier: 'ALERT' | 'WATCH' | 'CONTEXT'
}
// High zone + HVA = ALERT (score 90+)
// High zone + standard military = WATCH (score 60-89)
// Medium zone + HVA = WATCH (score 70-89)
// Low zone + any = CONTEXT or ignore (score <50)
```

### Renderer Changes

**FlightLayer.tsx:**
- Add `aircraft_type` to marker properties (already in GeoJSON but unused)
- Display type abbreviation on hover/popup
- HVA markers: distinct style (larger, pulsing border)

**ShipLayer.tsx:**
- Add `vessel_class` to marker properties
- Display class abbreviation on hover/popup
- Task force/CSG/ARG markers get connecting lines

**IntelFeedPanel.tsx:**
- Tactical events appear as new intel items with distinct styling
- Show involved assets count and region

## Known Issues & Lessons Learned

1. **Key-change remount cleanup:** When using `key={value}` to force remounts, React processes mounts before unmounts. A generation counter prevents old instance cleanup from destroying new instance's resources. FlightLayer uses this pattern correctly.

2. **Mapbox `isStyleLoaded()` is unreliable:** Don't guard source creation behind `map.isStyleLoaded()`. If the map is already loaded, the `load` event never fires and `isStyleLoaded()` can return false. Call `addSourcesAndLayers()` directly since SituationMap already gates rendering behind `mapReady`.

3. **Settings propagation:** Use `settings-changed` CustomEvent for immediate propagation. SituationMap's 10-second polling interval is too slow for settings changes.

4. **Hot reload vs built output:** `npm run dev` serves via Vite dev server (always fresh). `npx electron .` loads stale built output from `out/`. Always use `npm run dev:debug` for testing.

## Phase 4H: Remote HTTP Server (IMPLEMENTED)

### Architecture

The app serves its renderer UI over HTTP for access from other devices (phone, iPad, etc.) on the local network.

**Server:** Express.js HTTP server on port 3210 (configurable)
- File: `src/main/services/remote/httpServer.ts`
- Serves static files from the built renderer output
- Provides REST API endpoints mirroring IPC handlers
- SPA fallback with CSP modification for remote browsers

**Transport Layer:** Browser-mode API shim
- File: `src/renderer/src/lib/apiTransport.ts`
- Detects Electron vs browser environment
- In browser: replaces `window.api` with nested object that calls REST endpoints via `fetch`
- In Electron: existing IPC bridge works unchanged

### REST API Endpoints

All endpoints mirror the IPC handler functions. Key routes:

| Route | Method | Maps to IPC |
|-------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/adsb/markers` | GET | `adsb:getMarkers` |
| `/api/adsb/geojson` | GET | `adsb:getGeoJSON` |
| `/api/adsb/geojson/lite` | GET | Lite GeoJSON for remote (capped 5000, military priority) |
| `/api/adsb/count` | GET | `adsb:getCount` |
| `/api/adsb/details` | GET | `adsb:getDetails` |
| `/api/ais/markers` | GET | `ais:getMarkers` |
| `/api/ais/geojson` | GET | `ais:getGeoJSON` |
| `/api/ais/geojson/lite` | GET | Lite GeoJSON for remote (capped 5000, military priority) |
| `/api/ais/count` | GET | `ais:getCount` |
| `/api/ais/countsByCategory` | GET | `ais:getCountsByCategory` |
| `/api/articles/*` | GET | `articles:*` |
| `/api/intel/*` | GET | `intel:*` |
| `/api/predictions/*` | GET/POST | `predictions:*` |
| `/api/ai/chat` | POST | `ai:chat` |
| `/api/rag/query` | POST | `rag:query` |
| `/api/settings` | GET/POST | `settings:get/save` |
| `/api/sources` | GET | Source list |
| `/api/carrier/groups` | GET | CSG tracking |
| `/api/tactical/events` | GET | Tactical events |
| `/api/sensemaking/*` | GET/POST | AI sense-making |

### Lite Endpoints for Mobile

Full GeoJSON payloads are too large for mobile (3.5MB ADS-B, 10MB AIS). Lite endpoints strip unnecessary fields and cap at 5000 features with military vessels/aircraft always included first.

### CSP Handling for Remote Access

The built `index.html` has a restrictive Content Security Policy meta tag. The HTTP server replaces it with a permissive CSP before serving to remote browsers. The Electron main window loads via `loadFile()` (not Express), so its CSP stays strict.

Key: `express.static(rendererPath, { index: false })` prevents Express from serving `index.html` for `/` before the CSP-modifying middleware runs.

### Mobile Layout

On mobile screens (`< 1280px`), the layout adapts:
- Root container: `h-auto min-h-screen` (grows beyond viewport, page scrolls)
- Desktop: `xl:h-full` (fixed viewport height)
- Map section: `h-[50vh]` on mobile, `xl:flex-1 xl:h-auto` on desktop
- Intel feed: stacks below map, scrolls naturally
- Body CSS: `overflow: hidden` only on desktop (`@media min-width: 1280px`)

### Error Handling

`jsonFetch` in apiTransport reads response as text first, then JSON.parses. Returns `null` on failure instead of throwing. This prevents partial/truncated responses from crashing components.

### Lessons Learned

1. **CSP blocks remote scripts:** The `index.html` CSP meta tag uses `'self'` which blocks scripts when served to a different origin. Must replace CSP for remote access.
2. **`express.static` intercepts root:** By default serves `index.html` for `/`, bypassing custom middleware. Use `{ index: false }` to prevent this.
3. **`window.api` must be nested objects:** Components call `window.api.adsb.getCount()` (nested), not `window.api['adsb:getCount']` (flat). Transport shim must match preload structure exactly.
4. **10MB JSON payloads fail:** AIS GeoJSON at 10MB causes `fetch` to timeout on mobile. Lite endpoints with field stripping + count capping are essential.
5. **`body { overflow: hidden }` blocks mobile scroll:** The Electron CSS locks body to viewport height. Must only apply on desktop breakpoints for mobile to scroll.

## Dynamic Conflict Zones

### Architecture

The zone engine runs on a 30-minute cycle and uses DBSCAN clustering to detect geographic concentrations of intelligence signals.

**File:** `src/main/services/analysis/zoneEngine.ts`

**Signal Sources (weighted by reliability):**
- tactical_events (weight: 3.0)
- anomalies (weight: 2.0)
- articles (weight: 1.5)
- flights/adsb (weight: 1.0)
- vessels/ais (weight: 1.0)
- intel_items (weight: 2.5)
- notams (weight: 2.5)

**Zone Lifecycle:**
- Created when cluster heat score >= 5.0 (CREATION_THRESHOLD)
- Status: monitoring → active → escalating → fading → resolved
- Decay factor: 0.85x per cycle (zones die naturally without fresh signals)
- Escalating: heat > 25.0 OR rapid increase (>1.5x previous)
- Resolved: heat < 2.0

**Home Territory Filtering:**
- Blocks zone creation over US, Canada, UK, France, Germany, Italy, Spain, Turkey, Australia, Japan
- Military aircraft/ships over their own country are routine, not signals
- Home port regions (Norfolk, San Diego, Portsmouth, Toulon, Yokosuka) filtered within 100nm

**Evidence Trail:**
- Fresh evidence IDs replace stale ones each cycle (no accumulation)
- When stored IDs return no results, `getZoneDetail` falls back to lat/lon query
- Queries intel_items, tactical_events, and articles within zone bounding box

**IPC:** `zone:list`, `zone:detail`, `zone:history`, `zone:refresh`

## Export System

### Architecture

Three exporters handle all PDF and Markdown output:

**Files:**
- `src/main/services/export/markdownExporter.ts` — Intel report Markdown export
- `src/main/services/export/pdfExporter.ts` — Intel report PDF export
- `src/main/services/export/chatExporter.ts` — AI chat message and conversation export

**IPC:**
- `export:intelReportMarkdown` / `export:intelReportPdf` — Intel feed report with tier filtering and date range
- `chatExport:messageMarkdown` / `chatExport:messagePdf` — Single AI message export
- `chatExport:conversationMarkdown` / `chatExport:conversationPdf` — Full conversation export

**PDF Features:**
- Colored confidence bars (green >= 80%, amber >= 60%, red < 60%)
- Numbered sources with bold titles and monospace URLs
- Footer timestamps in local time (not UTC)
- Save dialog with suggested filename

**Key Fixes:**
- `fillColor` reset after confidence bars (prevents orange text on page 2+)
- Local time formatting (was UTC, now system local time)
- Chat history loads newest-first (DESC order, no .reverse())

## Map Annotations (Tactical Overlay)

### Architecture

Persistent map annotations stored in SQLite, supporting 5 types:

**Types:** marker, line, polygon, circle, text label

**Components:**
- `TacticalOverlayLayer.tsx` — Manages annotation state and rendering
- `MapDrawLayer.tsx` — Leaflet.Draw integration for creating annotations
- `AnnotationToolbar.tsx` — UI toolbar for annotation type selection
- `AnnotationPopup.tsx` — Edit annotation properties (color, label, style)

**IPC:** `annotations:getAll`, `annotations:create`, `annotations:update`, `annotations:delete`

**Database:**
```sql
CREATE TABLE annotations (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,  -- 'marker', 'line', 'polygon', 'circle', 'text'
    label TEXT,
    color TEXT DEFAULT '#FF0000',
    coordinates TEXT NOT NULL,  -- JSON array of [lat, lon] pairs
    radius REAL,  -- circle radius in meters
    style TEXT,    -- JSON: strokeWidth, fillOpacity, etc.
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME
);
```
