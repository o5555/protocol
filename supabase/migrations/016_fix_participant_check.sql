-- Fix is_challenge_participant() to only consider accepted participants.
--
-- The original function (migration 003) checks whether a row exists in
-- challenge_participants without filtering on status. This means users
-- with a 'pending' or 'declined' invitation can pass the check and view
-- challenge data they should not have access to.
--
-- The newer is_challenge_protocol_participant() (migration 013) already
-- includes the status = 'accepted' filter; this migration brings the
-- original function in line with that pattern.

CREATE OR REPLACE FUNCTION public.is_challenge_participant(p_challenge_id UUID, p_user_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.challenge_participants
    WHERE challenge_id = p_challenge_id
    AND user_id = p_user_id
    AND status = 'accepted'
  );
$$ LANGUAGE sql SECURITY DEFINER;
