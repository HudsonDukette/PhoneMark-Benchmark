# Graph Report - C:/Users/hudso/Documents/PhoneMark-Benchmark  (2026-08-19)

## Corpus Check
- Corpus is ~1,499 words - fits in a single context window. You may not need a graph.

## Summary
- 47 nodes · 66 edges · 11 communities (10 shown, 1 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 3 edges (avg confidence: 0.92)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Project Architecture & Stack
- App Bootstrap & Detection
- UI Helpers & Rendering
- Page Screens & UX Flow
- Benchmark Execution Pipeline
- Package Metadata
- Vite Tooling & Build
- NPM Scripts
- Vercel Deployment Config

## God Nodes (most connected - your core abstractions)
1. `run()` - 9 edges
2. `PhoneMark Benchmark` - 7 edges
3. `PhoneMark Benchmark page` - 6 edges
4. `fmt()` - 5 edges
5. `cpuTest()` - 5 edges
6. `renderResults()` - 5 edges
7. `show()` - 4 edges
8. `setProgress()` - 4 edges
9. `gpuTest()` - 4 edges
10. `leaderboard()` - 4 edges

## Surprising Connections (you probably didn't know these)
- `Supabase JS CDN script` --semantically_similar_to--> `Supabase/Postgres public results`  [INFERRED] [semantically similar]
  index.html → README.md
- `PhoneMark Benchmark` --references--> `PhoneMark Benchmark page`  [INFERRED]
  README.md → index.html

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **PhoneMark screen flow (home → running → results → leaderboard)** — index_screen_home, index_screen_running, index_screen_results, index_screen_leaderboard [EXTRACTED 1.00]

## Communities (11 total, 1 thin omitted)

### Community 0 - "Project Architecture & Stack"
Cohesion: 0.22
Nodes (10): Browser-based mobile benchmark (CPU/GPU/hybrid), Supabase/Postgres public results, Vercel hosting, Vite/static frontend, Web Workers for CPU load, WebGL for GPU/hybrid load, Supabase JS CDN script, Conservative phone-model detection (+2 more)

### Community 1 - "App Bootstrap & Detection"
Cohesion: 0.47
Nodes (5): detect(), gpuTest(), initApp(), renderer(), saveResult()

### Community 2 - "UI Helpers & Rendering"
Cohesion: 0.60
Nodes (5): esc(), fmt(), leaderboard(), renderResults(), show()

### Community 3 - "Page Screens & UX Flow"
Cohesion: 0.70
Nodes (5): PhoneMark Benchmark page, Home screen, Leaderboard screen, Results screen, Running screen

### Community 4 - "Benchmark Execution Pipeline"
Cohesion: 0.83
Nodes (4): cpuTest(), run(), setProgress(), workerRun()

### Community 5 - "Package Metadata"
Cohesion: 0.50
Nodes (3): name, private, version

### Community 6 - "Vite Tooling & Build"
Cohesion: 0.50
Nodes (3): devDependencies, vite, vite

### Community 7 - "NPM Scripts"
Cohesion: 0.50
Nodes (4): scripts, build, dev, preview

## Knowledge Gaps
- **10 isolated node(s):** `name`, `version`, `private`, `dev`, `build` (+5 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `PhoneMark Benchmark` connect `Project Architecture & Stack` to `Page Screens & UX Flow`?**
  _High betweenness centrality (0.064) - this node is a cross-community bridge._
- **Why does `PhoneMark Benchmark page` connect `Page Screens & UX Flow` to `Project Architecture & Stack`?**
  _High betweenness centrality (0.044) - this node is a cross-community bridge._
- **Why does `scripts` connect `NPM Scripts` to `Package Metadata`?**
  _High betweenness centrality (0.026) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _10 weakly-connected nodes found - possible documentation gaps or missing edges._