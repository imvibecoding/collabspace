# collabspace

Collaborative prompt-economy platform. See [docs/prompt-economy-platform-brief.md](docs/prompt-economy-platform-brief.md)
for the full build brief. MVP scope is the **Public Art Prompt Room** and the **Kanban Room** (brief §4).

## Stack

Next.js 16 (App Router, TypeScript, Tailwind v4) · Supabase (Postgres, Auth, Realtime) · Vercel · Stripe (later).

## What is built

| System | Where | Status |
| --- | --- | --- |
| Queue engine (base lottery / premium bids / instant) | `src/lib/queue/` | done, unit + integration tested |
| Credit ledger (append-only, free vs paid, private-room rule) | `supabase/migrations/*credit_rpcs.sql`, `src/lib/credits/` | done |
| Moderation (blocklist, room rules, classifier hook) | `src/lib/moderation/` | layers 1 + 6 done; hosted classifier is a plug-in slot |
| Image provider abstraction | `src/lib/providers/image.ts` | mock provider; hosted provider stub |
| Reputation, weighted downvotes, escalation ladder, appeal review | `src/lib/reputation/` | done (heuristic reviewer; model reviewer pluggable) |
| Rooms, invites, adaptive mode suggestions | `src/lib/rooms/` | done |
| Snapshots / "buy a print" | `src/lib/rooms/service.ts`, `/s/[id]` | done |
| Art room UI | `src/components/art-room.tsx` | done |
| Kanban UI with card locks and turn mode | `src/components/kanban-room.tsx` | done |
| Queue tick endpoint + Vercel cron | `src/app/api/queue/tick`, `vercel.json` | done |

Deferred (per brief §3 / §6): music/video/3D, CRDT live editing, enterprise rooms, third-party routing, Stripe checkout,
phone verification.

## Local development

Requires Docker Desktop and Node 20+.

```bash
npm install
npm run db:start        # local Supabase on ports 55321-55329 (see supabase/config.toml)
npm run db:reset        # apply migrations + seed (creates the public room "The Wall")
node scripts/seed-users.mjs   # optional throwaway accounts bob/carol/dave @test.local
npm run dev
```

`.env.local` for the local stack:

```
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:55321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<PUBLISHABLE_KEY from `npx supabase status`>
SUPABASE_SERVICE_ROLE_KEY=<SECRET_KEY from `npx supabase status`>
IMAGE_PROVIDER_DEFAULT=mock
```

Tests: `npm test` runs unit tests and, when the local stack is up, an end-to-end integration test of the
queue, ledger, downvote and appeal paths.

Schema changes: add a file to `supabase/migrations/`, run `npx supabase migration up`, then `npm run db:types`.

## Moving to hosted Supabase + Vercel

1. **Supabase**: create a project (free tier allows two active projects per org; pause one if needed). Then:
   ```bash
   npx supabase link --project-ref <ref>
   npx supabase db push          # applies supabase/migrations
   ```
   Run `supabase/seed.sql` in the SQL editor once to create the system user and The Wall.
   Enable phone auth + SMS provider when ready (brief §2.2).
2. **Vercel**: import the GitHub repo as a new project. Set env vars:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
   `CRON_SECRET` (any random string; protects `/api/queue/tick`), `IMAGE_PROVIDER_DEFAULT=mock` until a real
   image API key is added as `IMAGE_PROVIDER_API_KEY`.
   `vercel.json` schedules the queue tick every minute.
3. **GitHub**: protect `main` (require PRs). `gh` is installed locally; run `gh auth login` first.
