# Daikin Comforts Hackathon — Master Context Brief for Claude

> **How to use this doc:** Paste this entire brief at the start of a new Claude session before asking it to build anything. It gives Claude the full project context, scope boundaries, architecture, and conventions so every response stays aligned. Update the "Session Goal" line at the bottom each time.

---

## 1. Who I am / My role
- I'm a developer on a team building an MVP for the **Daikin Comforts Hackathon** (Aug 4–6, 2026, Houston).
- My responsibilities: the **web application**, the **backend/API**, the **data layer design**, and the **AI layer**.
- I have full-stack + AI/ML background (React, JavaScript/Node, Python, cloud) but I'm **rusty in React and Python**, so explain your reasoning as you go and keep code idiomatic and well-commented.
- Teammate split: Yuvaraj owns hardware/data-capture; I own app + AI; Sathish co-owns architecture; Abhijeet guides; Santosh leads.

## 2. What we're building (in plain terms)
A **Product Benchmarking web application**. Engineers physically tear down competitor products, capture measurements (dimensions, weight, photos), and the app stores that data, runs cost & design benchmarking analysis, and generates reports for different stakeholder personas.

The full production version already exists internally (mature, patented) — **but we are NOT rebuilding that.** We're building a small, clean MVP that demonstrates the concept.

## 3. CRITICAL constraints — read these before writing any code

### 3a. This is a PRE-INTEGRATION build
- Everything must **run fully locally on my personal laptop** with **no cloud services connected.**
- **No credentials, no API keys, no real client data, no corporate/IP content — ever.**
- Use **local dummy data** (SQLite or JSON) and **stubbed/fake AI responses** so the app runs end-to-end offline.
- Later, on my work laptop, I'll swap the local pieces for Azure SQL/Snowflake, Azure OpenAI, and Entra ID auth. **Design the code so this swap is a config/connection change, not a rewrite.**

### 3b. IP boundary (do not cross)
- Do **not** try to replicate any real proprietary benchmarking algorithm, patented "smart measure" capture logic, or internal product frameworks.
- Keep all analysis logic **generic and obvious** (simple cost rollups, weight comparisons, material breakdowns). This is a proof-of-concept, not the real engine.

### 3c. Keep it demo-able, not production-grade
- Favor clarity, polish, and a clean happy-path demo over completeness.
- Build in **vertical slices** (one full feature working end-to-end) rather than all-backend-then-all-frontend.

## 4. Tech stack (locked for MVP)
| Layer | MVP (build now, local) | Later (work laptop) |
|---|---|---|
| Frontend | **React (Vite)** + a component lib (shadcn/ui or MUI) | same |
| Backend | **Node.js + Express** *(or FastAPI if I say so)* | same |
| Database | **SQLite** (local file) via an ORM (Prisma or Drizzle) | Azure SQL → Snowflake |
| AI | **Stubbed function** returning canned JSON | Azure OpenAI |
| Auth | **Fake/hardcoded login** | Microsoft Entra ID |
| Reporting | **Charts in-app** (Recharts) | Power BI / Fabric embed |
| Hosting | **localhost** | Azure Container Apps |

> Use a clean **data-access layer** and a clean **AI-service interface** so the SQLite→cloud and stub→OpenAI swaps happen behind an interface.

## 5. Architecture (layers)
1. **Interface Layer** — React web app (persona views) + REST API.
2. **Data Capture Layer** — *(Yuvaraj's hardware; for MVP I just accept uploads)* — a flexible ingestion endpoint that takes measurement JSON + optional image, so the format can change later.
3. **Ingestion & Integration** — normalize incoming data, validate, store.
4. **Data Store** — products, sub-assemblies, parts, measurements, costs.
5. **Processing + AI Layer** — benchmarking calcs + a stubbed "AI BOM parsing & classification" feature.
6. **Analytics & Reporting** — persona-targeted report views with charts.

## 6. Data model (design the schema around this)
- **Product** — id, name, brand, category, notes
- **SubAssembly** — id, productId (FK), name, description
- **Part** — id, subAssemblyId (FK), name, material, finish, weight_g, dimensions (L/W/H mm), quantity
- **Measurement** — id, partId (FK), type (dimension/weight/etc.), value, unit, capturedAt, capturedBy, imageUrl (nullable)
- **Cost** — id, partId (FK), material_cost, process_cost, labour_cost, currency
- **Report** — id, persona (cost_engineer / design_engineer / executive), productId, generatedAt, payload (JSON of the computed view)

## 7. Personas for reports (build a subset)
- **Cost Engineer** — cost breakdown by part/material, product-vs-product cost comparison.
- **Design Engineer** — weight, material, dimensions, part-count (numerosity) comparisons.
- **Executive** — high-level summary: total cost, total weight, key differences, one headline chart.

## 8. The AI stub (important pattern)
Create an `aiService` module with a single function like:
```
parseBOM(rawText | measurements) -> { parts: [{name, material, category, confidence}], summary }
```
- For MVP, this returns **hardcoded/canned but realistic** results (optionally with a fake delay to feel real).
- Keep the function signature identical to what a real Azure OpenAI call would use, so later I only replace the body.

## 9. Dummy data
- Seed **2–3 competitor products**, each with a few sub-assemblies and ~5–10 parts, realistic measurements and costs.
- Make it look like a believable teardown dataset so the demo feels real.
- Provide a `seed` script I can re-run.

## 10. Folder structure (as built)
```
daikin-benchmark-mvp/
├── frontend/            # React (Vite)
│   ├── src/
│   │   ├── components/  # PartRow, reports/, ui/ (shadcn primitives)
│   │   ├── pages/       # products, detail, capture, ai-parse, reports (per persona), compare
│   │   ├── lib/         # api client, useApi, format, utils
│   │   └── ...
├── backend/              # Node + Express
│   ├── src/
│   │   ├── routes/       # products, reports, capture, ai
│   │   ├── services/     # aiService (stub), benchmarkService, captureService, productService
│   │   ├── data/         # data-access layer (swappable — the only layer that imports Prisma)
│   │   ├── db/            # schema + migrations + seed
│   │   └── index.js
├── CONTEXT.md
├── PROGRESS.md
└── README.md
```

## 11. Coding conventions I want
- Clear comments explaining *why*, since I'm relearning React/Python.
- Small, composable functions; keep the swappable layers (data, AI, auth) behind interfaces.
- No secrets in code; use a `.env.example` with placeholder keys only.
- Include run instructions in the README (install, seed, run frontend + backend).

## 12. Definition of done for the pre-integration MVP
- App runs locally end-to-end: enter/seed a teardown → see it stored → run benchmarking → view a persona report with a chart.
- The stubbed AI feature returns a believable BOM parse result in the UI.
- Nothing depends on any cloud service or credential.
- Source is clean and portable so I can move it to the work laptop and swap in Azure/Snowflake/OpenAI/Entra later.

---

## ▶️ SESSION GOAL (edit this line each session)
> Demo polish: product sort order, cross-page nav, branding/accent color, semantic status colors. Then, on the work laptop: Azure SQL/Snowflake, Azure OpenAI, Entra ID integration.
