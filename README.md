# PhoneMark Benchmark

Browser-based mobile CPU, GPU and hybrid benchmark.

## Stack
- Vite/static frontend
- Web Workers for CPU load
- WebGL for GPU/hybrid load
- Supabase/Postgres for public results
- Vercel for hosting

## Important
Exact phone-model detection is intentionally conservative. Browsers often hide the precise model, especially iOS Safari, so PhoneMark reports the best device identification it can actually support rather than inventing a model.

The public Supabase publishable key is designed for browser use. Database writes are protected by RLS; never put a Supabase service-role key in frontend code.

## Account and scores setup

Run `supabase.sql` in the Supabase SQL editor before using account features. It adds:

- username/password accounts backed by Supabase Auth, optional contact email, and avatar storage
- saved CPU/GPU device configurations with unlimited devices per account
- benchmark ownership, exact CPU/GPU labels, public score access, and matching average RPCs
- filtered Scores data for overall, CPU, GPU, and Hybrid rankings
- offline-first result queue: runs are kept locally and retried automatically when the database or connection returns
- production PWA shell with cached navigation after the first successful load

The frontend uses an internal account identity derived from the username so username/password login works even when contact email is omitted. Disable Supabase Auth email confirmation for this username-only flow. Copy `.env.example` to `.env.local` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_KEY` when deploying to a project other than the configured fallback.

Exact CPU model comparison depends on a saved device configuration because browsers cannot reliably expose a CPU model such as Ryzen 7 7800X3D. Automatic detection remains available as a fallback.

If a run finishes while Supabase is unavailable, the result is still added to local history and queued in the browser. PhoneMark retries queued uploads when the connection comes back; the Results screen also exposes a manual retry action. In production, `public/sw.js` provides a network-backed offline shell after the first successful load.
