-- Fix: Invited users can't see the challenge they've been invited to.
-- Migration 016 restricted is_challenge_participant() to 'accepted' only,
-- but invited users need to see the challenge to accept or decline.
-- Without this, the challenges join returns null and invitations are invisible.

CREATE OR REPLACE FUNCTION public.is_challenge_participant(p_challenge_id UUID, p_user_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.challenge_participants
    WHERE challenge_id = p_challenge_id
    AND user_id = p_user_id
    AND status IN ('accepted', 'invited')
  );
$$ LANGUAGE sql SECURITY DEFINER;
