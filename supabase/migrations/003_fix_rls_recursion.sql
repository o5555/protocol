-- Fix infinite recursion in challenge_participants and challenges RLS policies
-- The original policies query challenge_participants within a SELECT policy
-- on challenge_participants itself, causing infinite recursion.
-- Fix: use a SECURITY DEFINER function that bypasses RLS.

CREATE OR REPLACE FUNCTION public.is_challenge_participant(p_challenge_id UUID, p_user_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.challenge_participants
    WHERE challenge_id = p_challenge_id AND user_id = p_user_id
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- Drop the problematic policies
DROP POLICY IF EXISTS "Users can view challenge participants" ON challenge_participants;
DROP POLICY IF EXISTS "Users can view their challenges" ON challenges;

-- Recreate without self-referencing subqueries
CREATE POLICY "Users can view challenge participants" ON challenge_participants
  FOR SELECT USING (
    user_id = auth.uid() OR
    public.is_challenge_participant(challenge_id, auth.uid())
  );

CREATE POLICY "Users can view their challenges" ON challenges
  FOR SELECT USING (
    creator_id = auth.uid() OR
    public.is_challenge_participant(id, auth.uid())
  );
