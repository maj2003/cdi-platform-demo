# Daikin Benchmarking MVP

A **Product Benchmarking** web app: tear down competitor products, capture measurements (dimensions, weight, cost), and generate cost/design/executive reports comparing them. Built for the Daikin Comforts Hackathon (Aug 2026) as a **pre-integration proof of concept** — everything runs locally with dummy data and stubbed AI, with the swap to Azure/Snowflake/Entra ID left for later.

See [`CONTEXT.md`](CONTEXT.md) for the full project brief (scope, constraints, data model) and [`PROGRESS.md`](PROGRESS.md) for what's actually built, commit by commit.

## Tech stack

| Layer | This build |
|---|---|
| Frontend | React 19 (Vite) + Tailwind + shadcn/ui + Recharts |
| Backend | Node.js + Express |
| Database | SQLite via Prisma |
| AI | Stubbed service, canned responses |
| Auth | Hardcoded "Demo user" |

## Quickstart

Requires Node 24.x (or close to it).

```bash
# 1. Backend — install, seed the sample data, run the API
cd backend
npm install
npm run seed      # loads 3 competitor teardowns (43 parts, 172 measurements)
npm run dev       # http://localhost:4000

# 2. Frontend — in a second terminal
cd frontend
npm install
npm run dev       # http://localhost:5173
```

Open `http://localhost:5173`. Re-run `npm run seed` any time to reset the sample data to its pristine state (it wipes any hand-entered captures on the three seed products).

### Environment variables

Neither `.env` carries a real secret — this build has none.

**`backend/.env`**
```
DATABASE_URL="file:./dev.db"
```

**`frontend/.env.local`**
```
VITE_API_URL=http://localhost:4000/api
```

## Project structure

```
daikin-benchmark-mvp/
├── frontend/                # React (Vite)
│   └── src/
│       ├── pages/            # one file per route (see "Navigating the app" below)
│       ├── components/       # ProductCard, PartRow, ProductSubNav, reports/, ui/ (shadcn)
│       └── lib/              # api client, useApi hook, format helpers, utils
├── backend/                  # Node + Express
│   └── src/
│       ├── routes/           # products, reports, capture, ai — thin HTTP layer
│       ├── services/         # productService, benchmarkService, captureService, aiService
│       ├── data/             # the ONLY layer that imports Prisma — the swap seam
│       └── db/                # schema, migrations, seed.js
├── shared/                   # reserved for shared types/sample data (currently empty)
├── CONTEXT.md                # full project brief
├── PROGRESS.md                # build log — what's done, commit by commit
└── README.md                  # this file
```

## Navigating the app

**Products** (`/`) is the home page — three teardown cards, Northwind first (it's the seed's baseline). Click a title to open its **Detail** page; click **Compare all** to jump to **Compare**.

**Product Detail** (`/products/:id`) is the hub for one teardown. A tab row under the title —

```
[ Teardown ] [ Capture ] [ AI BOM parse ] [ Reports ]
```

— appears on all four product-scoped pages, so you move between them directly:

- **Capture** — HID-style data entry. Pick a part, type a value, press Enter; it auto-advances Length → Width → Height → Weight → next part.
- **AI BOM parse** — paste a rough parts list, get back a classified-parts table (material/category/confidence). Stubbed, not persisted.
- **Reports** — Cost Engineer / Design Engineer / Executive tabs, with a Cached/Fresh badge and Regenerate button.

**Compare** (`/compare`) — pick 2–5 products via the chips, see the indexed cost-vs-weight chart and deltas table. Click a product's name in that table to jump to its Detail page.

The header's **Products** / **Compare** links are always visible, so you can reach either top-level view from anywhere, including from inside a product's Capture/Reports/AI-parse screens.

## API overview

All routes are mounted under `/api` (backend `src/index.js`).

| Route | Purpose |
|---|---|
| `GET /api/health` | Process + DB connectivity check |
| `GET/POST/PATCH/DELETE /api/products*` | Products, teardown tree, parts, costs, measurements |
| `GET/POST/DELETE /api/reports*` | Persona reports (cost/design/executive) + comparison |
| `GET /api/capture/types`, `POST /api/capture`, `POST /api/capture/part/:id` | Measurement ingestion |
| `POST /api/ai/parse-bom` | Stubbed BOM classification |

## Key conventions (see `PROGRESS.md` for the full list)

- **Only `backend/src/data/*` imports Prisma.** Routes → services → data — swapping SQLite for Azure SQL later means rewriting that folder alone.
- **Two-fetch pattern on the frontend:** the teardown tree supplies structure, `/api/reports/*` supplies all computed figures (costs, totals, deltas). Nothing is recomputed in the browser.
- **AI and cloud are deliberately stubbed** — do not wire real Azure/OpenAI/Entra ID into this build; that's the later, separate integration pass.

## Scripts

| Command | Where | What |
|---|---|---|
| `npm run dev` | `backend/` | Start the API with nodemon (`:4000`) |
| `npm run seed` | `backend/` | Reset the database to the sample teardowns |
| `npm run dev` | `frontend/` | Start the Vite dev server (`:5173`) |
| `npm run build` | `frontend/` | Production build |
| `npm run lint` | `frontend/` | ESLint |
