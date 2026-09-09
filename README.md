# collabspace

Collaborative prompt-economy platform. See [docs/prompt-economy-platform-brief.md](docs/prompt-economy-platform-brief.md)
for the full build brief and [docs/world-room-design.md](docs/world-room-design.md) for the world-room pivot.
The viral public room is a **2D top-down world** grown by prompts ("The Block"); the Art wall and
Kanban board exercise the same engine.

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
| **World rooms** (2D top-down, prompt → patch, timelapse, fork) | `src/lib/world/`, `src/components/world-*.tsx` | done — see [docs/world-room-design.md](docs/world-room-design.md) |
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

## Hosted Supabase (done) + Vercel (to do)

1. **Supabase**: project `collabspace` (ref `aqszydhbnfvvnfeupnmk`, ap-southeast-2, $10/month on the Pro org).
   All migrations and the seed (system user, The Wall, The Block) are applied via the Supabase MCP.
   To apply future migrations: `npx supabase link --project-ref aqszydhbnfvvnfeupnmk && npx supabase db push`.
   Hosted env values:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://aqszydhbnfvvnfeupnmk.supabase.co
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_K_WYw6TYrlVDDPiSgMPZQw_L4UxJ5U7
   SUPABASE_SERVICE_ROLE_KEY=<Project Settings → API keys → secret key; never commit>
   ```
   Enable phone auth + an SMS provider when ready (brief §2.2).
2. **Vercel / ironically.ai**: the app is served at **https://ironically.ai/collabspace** (unlisted: no links
   from the main site, `noindex` header + meta on every page, not in any sitemap). It works like this:
   - This repo deploys as its own Vercel project with `basePath: "/collabspace"` (see `next.config.ts`).
   - The ironically.ai Vercel project (repo `imvibecoding/ironicallyai`) has a `vercel.json` rewrite that proxies
     `/collabspace/*` to this project's production URL. Update that destination if the production URL changes.
   - Env vars on the collabspace Vercel project: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`,
     `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` (random string; protects the tick endpoint),
     `IMAGE_PROVIDER_DEFAULT=mock`. Also add `https://ironically.ai/collabspace` to Supabase Auth → URL configuration
     (site URL + redirect URLs).
   - `vercel.json` here schedules `/collabspace/api/queue/tick` every minute.
   - To run locally the app is at http://localhost:3000/collabspace (set `NEXT_PUBLIC_BASE_PATH=` to serve at the root).
3. **GitHub**: protect `main` (require PRs). `gh` is installed locally; run `gh auth login` first.
