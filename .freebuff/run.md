# PhoneMark-Benchmark — run doc

## Reproduce the uncommitted artifacts a fresh checkout needs

- Dependencies: `npm install` (creates `node_modules/`). `npm.cmd` resolves from PATH (e.g. `C:\nvm4w\nodejs2\nodejs\npm.cmd`).
- No env files are required for dev: there is no `.env.local` in the main checkout, only `.env.example`.
  `app.js` falls back to hardcoded Supabase URL/publishable key when `VITE_SUPABASE_URL` /
  `VITE_SUPABASE_KEY` are unset, so `vite dev` works with no env. If a `.env.local` is later added
  to the main checkout, copy it here (do not symlink) — Vite reads it at server start.
- Code artifacts are committed; nothing else needs to be built for `vite dev`.
- Database setup: run `supabase.sql` in the Supabase SQL editor once to create profiles, avatar storage, saved device configurations, benchmark comparison fields, RLS policies, and the averages RPC.
- Production-only PWA support is provided by `public/sw.js`; it is registered automatically after a production build and first successful load.

## Run the server

```bash
npm run dev
```

- Default port: **5173** (Vite default; change with `--port <n>` if occupied).
- Detached start (Windows, survives this conversation):

```powershell
powershell -NoProfile -Command "(Start-Process -FilePath 'npm.cmd' -ArgumentList 'run','dev' -WorkingDirectory 'C:\Users\hudso\Documents\PhoneMark-Benchmark' -RedirectStandardOutput 'C:\Users\hudso\Documents\PhoneMark-Benchmark\.freebuff\preview-3451d4cb-ef7a-40a4-8059-de354cfd3c30.log' -RedirectStandardError 'C:\Users\hudso\Documents\PhoneMark-Benchmark\.freebuff\preview-3451d4cb-ef7a-40a4-8059-de354cfd3c30.log.err' -WindowStyle Hidden -PassThru).Id"
```

- stdout and stderr go to **different** files (`<log>` and `<log>.err`) — PowerShell fails if both point at one path.
- URLs: `http://localhost:5173/` (dev server). Production build: `npm run build` → `vite preview` on port 4173.