-- Add invited_by column to challenge_participants for tracking who invited someone
-- Add challenge_id column to pending_invites for inviting non-users directly to challenges

-- Add invited_by to challenge_participants
ALTER TABLE challenge_participants ADD COLUMN invited_by UUID REFERENCES profiles(id);

-- Add challenge_id to pending_invites (nullable - only set when inviting to a specific challenge)
ALTER TABLE pending_invites ADD COLUMN challenge_id UUID REFERENCES challenges(id) ON DELETE CASCADE;

-- Update the process_pending_invites function to also add user to challenge
CREATE OR REPLACE FUNCTION public.process_pending_invites()
RETURNS TRIGGER AS $$
BEGIN
  -- Create friendships from pending invites
  INSERT INTO public.friendships (user_id, friend_id, status)
  SELECT pi.inviter_id, NEW.id, 'accepted'
  FROM public.pending_invites pi
  WHERE LOWER(pi.invited_email) = LOWER(NEW.email)
  ON CONFLICT (user_id, friend_id) DO NOTHING;

  -- Add user to any challenges they were invited to
  INSERT INTO public.challenge_participants (challenge_id, user_id, status, invited_by)
  SELECT pi.challenge_id, NEW.id, 'invited', pi.inviter_id
  FROM public.pending_invites pi
  WHERE LOWER(pi.invited_email) = LOWER(NEW.email)
  AND pi.challenge_id IS NOT NULL
  ON CONFLICT (challenge_id, user_id) DO NOTHING;

  -- Delete processed invites
  DELETE FROM public.pending_invites
  WHERE LOWER(invited_email) = LOWER(NEW.email);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Update RLS policy to allow accepted participants to invite others (not just creators)
DROP POLICY IF EXISTS "Creators can invite participants" ON challenge_participants;

CREATE POLICY "Participants can invite others" ON challenge_participants
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM challenges WHERE id = challenge_id AND creator_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM challenge_participants cp
      WHERE cp.challenge_id = challenge_participants.challenge_id
      AND cp.user_id = auth.uid()
      AND cp.status = 'accepted'
    )
  );

-- Update friendships RLS to allow auto-friending when accepting challenge invites
-- Users can create friendships where they are either user_id OR friend_id (for auto-accept)
DROP POLICY IF EXISTS "Users can send friend requests" ON friendships;

CREATE POLICY "Users can create friendships" ON friendships
  FOR INSERT WITH CHECK (
    auth.uid() = user_id OR auth.uid() = friend_id
  );
