# Parked Idea: Simultaneous Multi-Agent/Multi-Dev Code Collaboration

**Status:** Parked — not in scope for the collaboration-platform MVP. Noted separately
because it may be a large idea in its own right if it can be solved well.

## The problem
Git (including worktrees) is a **linear, merge-based** model: parallel work happens on
independent copies, then gets reconciled after the fact by diffing text. This works
because code is text and text-diffing is a solved problem. It is not the same as
**simultaneous, non-linear** collaboration — multiple developers, or multiple AI
coding agents, editing the same codebase live and seeing each other's changes as they
happen, the way Google Docs or Figma allow for prose/design.

## Why it's harder than "CRDTs for code"
Real-time collaborative editing for prose or vector graphics (Google Docs, Figma) uses
CRDTs/operational transforms to merge simultaneous edits. Code is a much harder case
because a live edit in one function can silently break something another
developer/agent is mid-way through writing elsewhere, in ways that don't apply to
prose or design (a broken sentence doesn't crash a document; a broken function
signature can crash a build or a running dev server). Any real solution likely needs
to keep the codebase compilable/runnable in real time across concurrent edits, not
just merge text — that's the genuinely novel, unsolved part.

## Why it matters
- Most developers already use Git-based, linear AI-coding workflows (agents on
  separate branches/worktrees, merged sequentially).
- Most non-technical people have no idea how to use Git at all, which is a separate,
  more tractable problem — solved by the "vibe coding" room already scoped into the
  main platform (turn-based, simplified, chat-driven, one queue at a time). That part
  does NOT require solving this harder problem and should proceed independently.
- If genuine simultaneous multi-agent/multi-dev orchestration were solved well
  (agents or humans truly working in parallel on a live, always-runnable codebase),
  it could be a significant standalone product — worth revisiting once the core
  collaboration platform is validated and there's bandwidth for a harder R&D bet.

## Next steps (future, not now)
- Research existing attempts at real-time collaborative code editing with build/runtime
  safety guarantees (if any exist beyond pairing tools like VS Code Live Share, which
  don't solve the agent-orchestration angle).
- Scope as its own product exploration, independent of the collaboration-platform
  roadmap, once that platform's MVP is live and validated.
