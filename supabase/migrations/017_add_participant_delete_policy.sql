-- Add missing DELETE policy for challenge_participants
-- Allows users to remove themselves from a challenge,
-- or challenge creators to remove any participant.

CREATE POLICY "Users or creators can delete participants" ON challenge_participants
  FOR DELETE USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM challenges
      WHERE id = challenge_participants.challenge_id
      AND creator_id = auth.uid()
    )
  );
