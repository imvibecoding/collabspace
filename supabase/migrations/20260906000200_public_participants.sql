-- Participant lists are visible to anyone who can view the room (public rooms included).
drop policy "participants see co-participants" on room_participants;
create policy "participants visible in visible rooms" on room_participants for select using (can_view_room(room_id));
