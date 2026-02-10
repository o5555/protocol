-- Migration to support user-created custom protocols
-- Add user_id to protocols (nullable = system protocol, set = user-created)

ALTER TABLE protocols ADD COLUMN user_id UUID REFERENCES profiles ON DELETE CASCADE;

-- Index for user's custom protocols
CREATE INDEX idx_protocols_user_id ON protocols(user_id);

-- Update RLS policies for protocols
DROP POLICY IF EXISTS "Anyone can view protocols" ON protocols;

-- Anyone can view system protocols (user_id IS NULL) and their own custom protocols
CREATE POLICY "View system and own protocols" ON protocols
  FOR SELECT USING (user_id IS NULL OR user_id = auth.uid());

-- Users can create their own protocols
CREATE POLICY "Users can create protocols" ON protocols
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update their own protocols
CREATE POLICY "Users can update own protocols" ON protocols
  FOR UPDATE USING (auth.uid() = user_id);

-- Users can delete their own protocols
CREATE POLICY "Users can delete own protocols" ON protocols
  FOR DELETE USING (auth.uid() = user_id);

-- Update RLS policies for protocol_habits
DROP POLICY IF EXISTS "Anyone can view protocol habits" ON protocol_habits;

-- Anyone can view habits for system protocols and their own custom protocols
CREATE POLICY "View system and own protocol habits" ON protocol_habits
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM protocols p
      WHERE p.id = protocol_id
      AND (p.user_id IS NULL OR p.user_id = auth.uid())
    )
  );

-- Users can create habits for their own protocols
CREATE POLICY "Users can create protocol habits" ON protocol_habits
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM protocols p
      WHERE p.id = protocol_id AND p.user_id = auth.uid()
    )
  );

-- Users can update habits for their own protocols
CREATE POLICY "Users can update own protocol habits" ON protocol_habits
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM protocols p
      WHERE p.id = protocol_id AND p.user_id = auth.uid()
    )
  );

-- Users can delete habits from their own protocols
CREATE POLICY "Users can delete own protocol habits" ON protocol_habits
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM protocols p
      WHERE p.id = protocol_id AND p.user_id = auth.uid()
    )
  );
