-- Add Fresh Start feature to challenges
-- Allows challenge creator to reset the timeline once during the first 3 days

-- Track whether fresh start has been used and when
ALTER TABLE challenges ADD COLUMN fresh_start_used BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE challenges ADD COLUMN fresh_start_at TIMESTAMPTZ DEFAULT NULL;

-- Allow challenge creators to delete all habit_completions for their challenge
-- (existing policy only allows users to delete their own completions)
CREATE POLICY "Creators can delete challenge habit completions" ON habit_completions
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM challenges
      WHERE challenges.id = habit_completions.challenge_id
      AND challenges.creator_id = auth.uid()
    )
  );
