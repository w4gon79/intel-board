# Intel Board

RAG-grounded intelligence dashboard: multi-source data, local-first Electron desktop app, citations for every AI claim.

**Product:** [PRD.md](./PRD.md) · **Engineering:** [TDD.md](./TDD.md) · **Cursor:** [.cursorrules](./.cursorrules)

## Prerequisites

- **Node.js** [20.19+ or 22.12+](https://electron-vite.org/guide/) (required by electron-vite)
- **npm** (this repo uses npm; pnpm/yarn work if you adapt commands)

Optional / next milestones:

- **Mapbox** — set `VITE_MAPBOX_TOKEN` in `.env` for the situation map (renderer).
- **Ollama** with `nomic-embed-text` and a chat model (RAG + LLM).

## Setup

```bash
npm install
npm run dev
```

The Electron window should open with the dashboard: **Mapbox** globe (dark style), layer placeholders, feed column, and AI strip.

Copy [`.env.example`](./.env.example) to `.env` when you add Mapbox or API keys. Vite exposes only variables prefixed with `VITE_` to the renderer.

### Mapbox `events.mapbox.com` / `ERR_NAME_NOT_RESOLVED`

Mapbox GL JS sends **usage events** to `events.mapbox.com` (separate from **tiles**, which use `api.mapbox.com`). Many DNS blockers and privacy lists block the events host, which produces `net::ERR_NAME_NOT_RESOLVED` in devtools even when the map renders fine.

**Fix options (pick one):**

1. **Allow the host** on your network (whitelist `events.mapbox.com` in Pi-hole / AdGuard / NextDNS / router, or try another DNS provider).
2. **Rely on the built-in dev behavior:** in development, the app **short-circuits** those `fetch` calls so the console stays quiet (see `src/renderer/src/lib/mapboxEventsSilencer.ts`). To force real event POSTs while developing, set `VITE_MAPBOX_SILENCE_EVENTS=false` in `.env` and restart dev.
3. **Production builds:** event requests are sent unless you set `VITE_MAPBOX_SILENCE_EVENTS=true` before `npm run build` (only if you intentionally need to avoid that traffic).

If you pasted a Mapbox token in a public chat or screenshot, **rotate it** in [Mapbox account tokens](https://account.mapbox.com/access-tokens/).

## Scripts

| Script                            | Purpose                                            |
| --------------------------------- | -------------------------------------------------- |
| `npm run dev`                     | Dev: HMR renderer, hot reload main/preload         |
| `npm run build`                   | Typecheck + production bundles + Electron output   |
| `npm start`                       | Preview production build (`electron-vite preview`) |
| `npm run typecheck`               | `tsc --noEmit` for main, preload, renderer         |
| `npm run lint` / `npm run format` | ESLint / Prettier                                  |

Platform installers: `npm run build:win`, `build:mac`, `build:linux` (after `build`).

## Repository layout (current)

Scaffold follows [electron-vite](https://electron-vite.org/) + [@electron-toolkit](https://github.com/alex8088/electron-toolkit):

```
src/
  main/index.ts       # Electron main process
  preload/index.ts    # Preload (context bridge)
  renderer/src/
    components/layout/   # AppShell, header, status bar, feed panel, AI strip
    components/map/      # SituationMap, LayerControls
resources/icon.png
electron.vite.config.ts
electron-builder.yml
```

Ingestion, SQLite, ChromaDB, and RAG will live in the **main** process (and shared types) as described in [TDD.md](./TDD.md); the renderer talks to main via IPC.

## Implementation status

| Step                                    | Status                                   |
| --------------------------------------- | ---------------------------------------- |
| 1. Electron + React + Vite + Tailwind   | Done                                     |
| 2. Mapbox situation map + shell + CSP   | Done                                     |
| 3–12. SQLite, news, RAG, feed, ADS-B, … | Planned ([.cursorrules](./.cursorrules)) |

## License

Private / unlicensed unless you add a `LICENSE` file.
