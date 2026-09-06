# Collaborative Prompt-Economy Platform — Build Brief

## 1. Vision

A collaboration platform where people (and eventually enterprises) work together on
creative and productive work — AI-generated or not — through a shared, credit-gated,
queue-managed workspace. Public "rooms" are viral/fun and drive top-of-funnel growth
(shared AI art canvases, isometric 3D worlds, music collabs). The same underlying
engine also powers serious, private, invite-only collaboration (kanban boards, vibe
coding, diagramming, team-building exercises), which is where the business model
matures into recurring/enterprise revenue.

**Core insight driving the architecture:** the expensive, reusable parts (queue engine,
credit/billing system, generation-provider abstraction, moderation stack, reputation/
downvote system, versioning & fork/snapshot history, collaboration-mode engine) are
identical whether the "room" is a silly public art wall or a private corporate kanban
board. Only the front-end skin and room-specific rules differ. Build the engine once;
skin it many ways.

## 2. Core Systems (build these generically, not per-room)

### 2.1 Queue Engine
- Two lanes per public room: **base lane** (flat-price entries, resolved every N
  minutes, winner picked randomly among that window's submissions — keeps it feeling
  fair/lottery-like) and **premium lane** (bid-based, highest bid wins that window,
  minimum bid increment enforced).
- Resolution order when both lanes land in the same window: premium applies first,
  then base.
- "Instant apply" = pay to skip the queue entirely for a single action.
- Same engine underlies private collab, but permission rules replace bidding (see 2.4).

### 2.2 Credit & Billing System
- One universal credit currency, but **per-feature-type consumption** (text, image,
  music, video, 3D, priority-queue, room-hosting) so pricing can track true underlying
  provider cost per generation type without becoming confusing to users.
- Tiers: Free (small monthly allotment per type, tuned so a user can actually finish
  one thing worth sharing — not a single throwaway action), Premium (adds video, more
  volume), Enterprise (custom rooms, brand-controlled prompt space, contracts).
- **Private collabs always bill at real pay-per-use rates**, even for free-tier
  members — free credits are valid in public rooms only. This closes the "stockpile
  free credits on multiple accounts, spend them in a paid collab" loophole.
- Anti-abuse: phone/SMS verification for account creation; card-on-file (even
  uncharged) required to create or accept invites to a private collab, since that's
  where abuse becomes real cost to you.
- Markup model: track actual provider cost per generation; apply a transparent,
  consistent % margin rather than baking it invisibly into flat credit pricing.

### 2.3 Generation-Provider Abstraction Layer
- Every AI capability (image, music, video, 3D, text) is a pluggable "engine" behind
  one interface — e.g. `generate(roomType, prompt, providerConfig) -> asset`.
- V1 providers: an image model (choose based on cost/quality), Suno (music, subject to
  their API rate limits/ToS — confirm before locking any "every N minutes" cadence),
  Meshy or similar (3D, optional for MVP).
- **Do not rebuild what these providers already do.** The platform's job is
  orchestration, queueing, versioning, and multiplayer — not replicating a DAW or a
  3D modeling tool.
- Import support: users can bring in externally-generated assets (e.g. a Meshy model,
  a CC-licensed asset) with a lightweight rights-confirmation step at import time and
  a provenance/license metadata field stored against the asset.

### 2.4 Collaboration-Mode Engine
- Modes: **freeform** (small private groups, no queue needed), **turn/queue-based**
  (larger groups or public rooms), **sectioned/locked-ownership** (each collaborator
  owns a region — an art zone, an instrument track, a kanban swimlane — and can lock
  it while editing).
- Mode is a per-room setting, changeable mid-project. When a room crosses a
  size/participant threshold (e.g. 4th person invited), **suggest** a mode change
  (Claude-Code-style recommendation UI: show the suggestion, let the room owner
  accept/decline) rather than forcing it. Suggest the reverse when participants drop.
- Public rooms always default to queue-based (see 2.1). Private rooms default to
  freeform for ≤3 people, with a suggested upgrade path as more people join.

### 2.5 Fork, Snapshot & History
- **Snapshot**: a frozen, explorable/shareable read-only state of a room at a point in
  time. No further editing. Good for "look what we made," diorama-style world walk-
  throughs, timelapse replays (cheap to generate since every prompt/action is already
  logged).
- **Fork**: a new, independent, **invite-only** (never openly public/collaborative)
  copy seeded from a snapshot. The forker owns it and can work alone or invite specific
  people. This is deliberate: it keeps the public canonical room from fragmenting into
  dead branches, while still letting individuals "take it and run with it" privately.
- Content-type nuance: worlds and shared visual canvases are "one canonical public
  version + snapshots + private forks." Story and music content can support more open
  forking/branching, since divergence is often the creative point there.
- Full action history stored per room/asset (GitHub-style), independent of whether
  forking is enabled for that content type — this powers timelapses, attribution,
  and the reputation system.

### 2.6 Reputation, Downvote & Anti-Troll System
- Any collaborator can flag/downvote a change in larger collaborative rooms.
- Downvotes are **weighted by the downvoter's own account reputation/history** — new
  or low-activity accounts count for less. This blunts coordinated brigading before
  it reaches enforcement.
- Enough weighted downvotes → change is reverted, and the change-maker's future queue
  priority is nudged down.
- Escalation ladder (not one-strike): revert → priority penalty → short cooldown →
  longer cooldown. Repeat genuine trolling escalates; a single pile-on can't nuke
  someone instantly.
- **Appeal path**: a cheap, purpose-tuned review model checks whether the cooldown was
  fair. Critically, it must have access to **both sides**: the flagged user's history
  AND the pattern of who downvoted (timing, whether they have other activity in the
  room, coordination signals). If it finds brigading, the penalty flips onto the
  people who piled on, not the flagged user.

### 2.7 Moderation Stack (defense in depth)
1. Pre-generation prompt filter (blocklist/classifier before it reaches any model).
2. Prompt-injection / jailbreak defense at the system-prompt level for every
   AI-generation call — treat as an ongoing tuning effort, not a one-time build.
3. Post-generation output classification (benign prompt can still produce bad output).
4. Community reporting + human review queue for what automated layers miss.
5. Mandatory sign-in to participate (not just view) — enables a banned-user list and
   accountability.
6. Per-room configurable constraints (e.g. 6-word max prompt for the art room) — treat
   these as room-specific rules layered on the generic engine, not core architecture.

### 2.8 Third-Party Tool Routing (no-build integrations)
- For tools that already do collaboration well but are underused because people don't
  know how to set them up (Google Sheets, Docs, Notion, Miro, Trello, etc.): the
  platform's job is **only** to automate account linking, file/sheet creation, and
  invite sending through the user's own OAuth connection — then either embed it or
  hand off to the native app.
- Zero generation cost, but still valuable: track that the collab happened, who was
  invited, and engagement, feeding the same growth/usage metrics as native rooms.
- Requires proper OAuth consent and clear data-handling disclosure since the platform
  is creating files and sending invites on the user's behalf.
- List these at the bottom of the room-type picker — reinforces the "hub for any kind
  of collaboration" positioning cheaply.

### 2.9 Enterprise / Branded Rooms
- Gated to premium/enterprise tier. A brand (with the brand's own sign-off — hard
  product rule, not optional) commissions a themed room with a constrained/allow-
  listed prompt space so output can't be steered somewhere embarrassing next to their
  IP. Sold as sponsorship/marketing product, not a self-serve feature.
- Separate, lighter tier: generic "premium creator rooms" for individuals/small
  businesses with no IP/trademark concerns — self-serve, different price point from
  true enterprise brand deals.

## 3. Explicitly Parked (not in scope for MVP or near-term roadmap)
- **Simultaneous multi-agent/multi-dev code collaboration** (true live, non-linear,
  concurrent editing of code by multiple humans/agents at once, beyond what Git
  worktrees give you) — flagged as a separate, harder R&D problem with its own
  potential product. See companion note:
  `multi-agent-coding-orchestration-idea.md`. Do not let MVP scope creep into this.
- Full real-time simultaneous editing (Figma/Word-style CRDT-based live cursors) —
  v2+. MVP private collab uses the turn/queue or sectioned-lock model instead.

## 4. MVP Scope — Build These Two Rooms First

Chosen because together they exercise nearly every core system above, at the lowest
possible cost and complexity, before any spend on 3D/video/music generation.

### 4.1 Public Art Prompt Room
Tests: queue engine (both lanes), credit system, generation-provider abstraction,
full moderation stack, downvote/reputation/cooldown/appeal, snapshot (no forking
needed at MVP — canonical room only).

- One shared image canvas. Users submit a prompt (enforce a short max length, e.g.
  6 words, as a room-level rule) plus a choice of image model/provider.
- Base lane resolves every N minutes (random pick among that window's base
  submissions); premium lane resolves every N minutes by highest bid.
- "Buy a print" = paid static export of the current canvas state (the snapshot
  mechanic in its simplest form).
- Downvote button on the currently-applied change; enough weighted downvotes triggers
  revert + priority penalty, with appeal flow.
- All prompts pass through the moderation stack before reaching the provider.

### 4.2 Kanban / Project Board Room
Tests: sectioned/locked ownership, private invite-only collaboration, mode-switch
suggestions as group size changes — with **zero AI generation cost**, proving the
engine generalizes beyond AI content.

- Standard kanban columns/cards. Cards are the "sections" — a user can lock a card
  while editing it.
- Private by default, invite-only, freeform mode for ≤3 people.
- When a 4th person is invited, surface a suggestion to switch to a turn/queue mode
  for edits (accept/decline), demonstrating the adaptive collab-mode engine end to end.
- Full action history per card/board (foundation for the GitHub-style history system).

**Everything else (music, 3D world, vibe-coding IDE, team-building game modes,
diagramming, third-party routing) is explicitly deferred until these two prove the
engine.** Team-building modes in particular are just turn-based/free-for-all/breakout
rulesets layered on Art + Kanban once those exist — no new core system required.

## 5. Suggested Tech Stack

- **Frontend**: Next.js (React) on Vercel — fast iteration, good fit for real-time UI.
- **Backend/DB**: Supabase (Postgres + auth + realtime channels + storage) — realtime
  subscriptions are a good fit for queue-state and kanban-card updates without
  building a custom WebSocket layer from scratch.
- **Auth**: Supabase Auth, with phone/SMS verification enabled from day one (anti
  multi-accounting, per 2.2).
- **Payments/credits**: Stripe for card-on-file and purchases; credits ledger as its
  own Postgres table (append-only transaction log, not just a balance column, so you
  can audit/markup/reconcile provider costs later).
- **Generation providers (MVP)**: one image API for the Art Room; Suno deferred until
  Music Room phase; Meshy deferred until 3D phase.
- **Moderation**: a hosted moderation/classifier API for pre- and post-generation
  filtering, plus a simple keyword blocklist as the cheap first line of defense.

## 6. Autonomous Build Instructions (for the executing model)

**Goal**: stand up the MVP (Art Prompt Room + Kanban Room) on the stack above, fully
autonomously, asking the human operator (Adam) only for credentials/approvals it
cannot obtain itself (API keys, payment provider account, DNS).

**Before writing any application code, complete infrastructure setup, in this order:**

1. **GitHub**: create a new repository (private) for the project. Set up a standard
   branch protection rule on `main` (no direct pushes, PRs required) even though
   Adam is the only human contributor — this keeps future contributors/agents honest.
2. **Vercel**: create a new Vercel project linked to the GitHub repo, with preview
   deployments enabled on every PR/branch and production deployment on `main`.
3. **Supabase**: create a new Supabase project. Set up the initial schema for: users,
   credits ledger, rooms, room_participants, room_mode, queue_submissions,
   kanban_cards, action_history, reports/moderation_flags, reputation_scores.
   Enable Row Level Security from the start (private rooms must be genuinely private
   at the DB layer, not just hidden in the UI).
4. **Relevant MCP connectors to request/set up** (so the executing model can operate
   with minimal human hand-holding going forward): GitHub MCP (repo/PR management),
   Supabase MCP (schema/migrations/queries — already available in this environment),
   Vercel deployment access, and a payments MCP or direct Stripe API access once that
   account exists.
5. Only after 1–4 are confirmed working (a deployed "hello world" on Vercel pulling a
   test row from Supabase), begin building the Queue Engine and Credit Ledger as the
   two foundational systems, before either room's UI.

**Build order after infra**: Queue Engine → Credit Ledger → Moderation Stack (basic
keyword + hosted classifier) → Art Prompt Room UI → Kanban Room UI (reusing
auth/credits) → Reputation/Downvote system → Fork/Snapshot for the Art Room.

**Explicitly out of scope for this build pass**: music/video/3D generation, live
CRDT-style simultaneous editing, enterprise/branded rooms, third-party tool routing
(Google Sheets etc.), and any multi-agent code collaboration work (see Section 3).
