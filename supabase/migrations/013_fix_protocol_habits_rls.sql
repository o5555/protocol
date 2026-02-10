-- Fix RLS policies for protocol_habits and protocols
--
-- Bug 1: INSERT into protocol_habits fails because the WITH CHECK subquery
-- hits the protocols table which has its own RLS, causing the check to fail.
-- Fix: use a SECURITY DEFINER function (same pattern as is_challenge_participant
-- from migration 003) to bypass RLS on the cross-table lookup.
--
-- Bug 2: Challenge participants can't see custom protocols (or their habits)
-- created by other users. If User A creates a custom protocol challenge and
-- invites User B, User B can't view the protocol or habits.
-- Fix: extend SELECT policies to allow challenge participants to view
-- protocols and habits used in their challenges.

-- Helper function: check if a user owns a protocol (bypasses RLS)
CREATE OR REPLACE FUNCTION public.is_protocol_owner(p_protocol_id UUID, p_user_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.protocols
    WHERE id = p_protocol_id AND user_id = p_user_id
  );
$$ LANGUAGE sql SECURITY DEFINER;

-- Helper function: check if a user is in any challenge using a protocol (bypasses RLS)
CREATE OR REPLACE FUNCTION public.is_challenge_protocol_participant(p_protocol_id UUID, p_user_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.challenges c
    JOIN public.challenge_participants cp ON cp.challenge_id = c.id
    WHERE c.protocol_id = p_protocol_id
    AND cp.user_id = p_user_id
    AND cp.status = 'accepted'
  );
$$ LANGUAGE sql SECURITY DEFINER;

----------------------------------------------------------------------
-- Fix protocols SELECT: allow challenge participants to see custom protocols
----------------------------------------------------------------------
DROP POLICY IF EXISTS "View system and own protocols" ON protocols;
DROP POLICY IF EXISTS "Anyone can view protocols" ON protocols;

CREATE POLICY "View system and own protocols" ON protocols
  FOR SELECT USING (
    user_id IS NULL
    OR user_id = auth.uid()
    OR public.is_challenge_protocol_participant(id, auth.uid())
  );

----------------------------------------------------------------------
-- Fix protocol_habits policies
----------------------------------------------------------------------

-- SELECT: allow challenge participants to see habits
DROP POLICY IF EXISTS "View system and own protocol habits" ON protocol_habits;
DROP POLICY IF EXISTS "Anyone can view protocol habits" ON protocol_habits;

CREATE POLICY "View system and own protocol habits" ON protocol_habits
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.protocols p
      WHERE p.id = protocol_id
      AND (p.user_id IS NULL OR p.user_id = auth.uid())
    )
    OR public.is_challenge_protocol_participant(protocol_id, auth.uid())
  );

-- INSERT: use SECURITY DEFINER to avoid cross-table RLS issue
DROP POLICY IF EXISTS "Users can create protocol habits" ON protocol_habits;

CREATE POLICY "Users can create protocol habits" ON protocol_habits
  FOR INSERT WITH CHECK (
    public.is_protocol_owner(protocol_id, auth.uid())
  );

-- UPDATE: use SECURITY DEFINER for consistency
DROP POLICY IF EXISTS "Users can update own protocol habits" ON protocol_habits;

CREATE POLICY "Users can update own protocol habits" ON protocol_habits
  FOR UPDATE USING (
    public.is_protocol_owner(protocol_id, auth.uid())
  );

-- DELETE: use SECURITY DEFINER for consistency
DROP POLICY IF EXISTS "Users can delete own protocol habits" ON protocol_habits;

CREATE POLICY "Users can delete own protocol habits" ON protocol_habits
  FOR DELETE USING (
    public.is_protocol_owner(protocol_id, auth.uid())
  );

----------------------------------------------------------------------
-- Bug 3: challenge_participants INSERT policy has self-referential
-- subquery (same class of bug fixed in migration 003 for SELECT).
-- Fix: use existing is_challenge_participant() SECURITY DEFINER function.
----------------------------------------------------------------------
DROP POLICY IF EXISTS "Participants can invite others" ON challenge_participants;
DROP POLICY IF EXISTS "Creators can invite participants" ON challenge_participants;

CREATE POLICY "Participants can invite others" ON challenge_participants
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM challenges WHERE id = challenge_id AND creator_id = auth.uid()
    )
    OR
    public.is_challenge_participant(challenge_id, auth.uid())
  );

----------------------------------------------------------------------
-- Bug 4: Friendship INSERT policy allows any user to forge friendships
-- by inserting a row where they are friend_id with status 'accepted'.
-- Fix: restrict so only the user_id side can create the friendship row,
-- and auto-friending from challenge acceptance is handled by the
-- SECURITY DEFINER trigger (process_pending_invites), not client-side.
----------------------------------------------------------------------
DROP POLICY IF EXISTS "Users can create friendships" ON friendships;
DROP POLICY IF EXISTS "Users can send friend requests" ON friendships;

CREATE POLICY "Users can send friend requests" ON friendships
  FOR INSERT WITH CHECK (auth.uid() = user_id);
