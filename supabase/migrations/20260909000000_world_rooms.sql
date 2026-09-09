-- World rooms: a top-down 2D world stored as data (base map + entities).
alter type room_type add value if not exists 'world';

alter table rooms
  add column if not exists world jsonb,            -- current WorldState
  add column if not exists world_initial jsonb,    -- state before any prompt patches (timelapse origin)
  add column if not exists forked_from_snapshot uuid references snapshots(id) on delete set null;

-- Structured patch (+ inverse) produced by the planner for world submissions.
alter table queue_submissions add column if not exists patch jsonb;
