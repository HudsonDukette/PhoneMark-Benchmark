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
