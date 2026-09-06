# collabspace

Read `docs/prompt-economy-platform-brief.md` before making architectural decisions.
MVP scope is **only** the Public Art Prompt Room and the Kanban Room (brief §4).
Anything in brief §3 is parked — do not build it.

## Conventions
- Next.js App Router, `src/` layout, TypeScript strict, Tailwind v4.
- Supabase clients: `src/lib/supabase/server.ts` (server components / route
  handlers) and `src/lib/supabase/client.ts` (browser).
- Schema changes go in `supabase/migrations/<timestamp>_<name>.sql` and are
  applied to the hosted project. Every table has RLS enabled.
- Credits are an append-only ledger (`credit_ledger`); never store a mutable
  balance column as the source of truth.
- `main` is protected; work on branches and open PRs.
