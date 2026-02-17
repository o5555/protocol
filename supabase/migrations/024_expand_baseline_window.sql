-- Expand sleep data sharing to 90 days before challenge start for baseline
-- This handles participants who had gaps (e.g. lost ring) in the 30-day window
-- by looking further back for available data

DROP POLICY IF EXISTS "Challenge participants can view shared sleep data" ON sleep_data;

CREATE POLICY "Challenge participants can view shared sleep data" ON sleep_data
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM challenge_participants cp1
      JOIN challenge_participants cp2 ON cp1.challenge_id = cp2.challenge_id
      JOIN challenges c ON c.id = cp1.challenge_id
      WHERE cp1.user_id = auth.uid()
      AND cp1.status = 'accepted'
      AND cp2.user_id = sleep_data.user_id
      AND cp2.status = 'accepted'
      AND sleep_data.date BETWEEN (c.start_date - INTERVAL '90 days')::date AND c.end_date
    )
  );
