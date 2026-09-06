export type HistoryRow = {
  id: number;
  action: string;
  actor_id: string | null;
  payload: unknown;
  created_at: string;
  profiles?: { display_name: string | null } | null;
};

function describe(row: HistoryRow): string {
  const p = (row.payload ?? {}) as Record<string, unknown>;
  const who = row.profiles?.display_name ?? (row.actor_id ? "someone" : "system");
  switch (row.action) {
    case "submission.created":
      return `${who} queued “${p.prompt}” (${p.lane})`;
    case "submission.applied":
      return `${who}'s “${p.prompt}” was applied`;
    case "submission.reverted":
      return `a change was reverted (${p.reason})`;
    case "submission.failed":
      return `generation failed: ${p.error}`;
    case "user.penalised":
      return `a member received strike ${p.strikes}`;
    case "appeal.upheld":
      return `appeal upheld — brigading detected`;
    case "appeal.rejected":
      return `appeal rejected`;
    case "print.purchased":
      return `${who} bought a print`;
    case "snapshot.created":
      return `${who} took a snapshot`;
    case "room.created":
      return `${who} created the room`;
    case "participant.invited":
      return `${who} invited ${p.email}`;
    case "mode.suggested":
      return `system suggested ${p.to} mode (${p.participants} members)`;
    case "mode.changed":
      return `${who} switched mode ${p.from} → ${p.to}`;
    case "mode.suggestion_declined":
      return `${who} declined switching to ${p.to}`;
    case "card.created":
      return `${who} added “${p.title}”`;
    case "card.updated":
      return `${who} edited “${p.title}”`;
    case "card.moved":
      return `${who} moved a card`;
    case "card.locked":
      return `${who} locked a card`;
    case "card.unlocked":
      return `${who} unlocked a card`;
    case "card.deleted":
      return `${who} deleted a card`;
    default:
      return `${who}: ${row.action}`;
  }
}

export function HistoryList({ rows }: { rows: HistoryRow[] }) {
  return (
    <div className="rounded-xl border border-zinc-200 p-4 text-sm dark:border-zinc-800">
      <h3 className="mb-2 font-medium">History</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-zinc-500">Nothing yet.</p>
      ) : (
        <ol className="max-h-72 space-y-1 overflow-y-auto text-xs">
          {rows.map((r) => (
            <li key={r.id} className="flex justify-between gap-3">
              <span>{describe(r)}</span>
              <span className="shrink-0 text-zinc-400" suppressHydrationWarning>
                {new Date(r.created_at).toLocaleTimeString()}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
