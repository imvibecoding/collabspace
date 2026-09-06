# collabspace

Collaborative prompt-economy platform. See `docs/prompt-economy-platform-brief.md`
for the full build brief and `docs/` for design notes.

## Stack

Next.js (App Router, TypeScript, Tailwind) on Vercel · Supabase (Postgres, Auth,
Realtime, Storage) · Stripe.

## Local development

```bash
cp .env.example .env.local   # fill in Supabase values
npm install
npm run dev
```

Database schema lives in `supabase/migrations/` and is applied to the hosted
Supabase project via the Supabase MCP / CLI.
