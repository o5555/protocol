-- Social Challenge Feature Schema
-- Run this migration in Supabase SQL Editor

-- Enable pgcrypto for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Profiles (extends Supabase auth.users)
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users ON DELETE CASCADE,
  email TEXT NOT NULL,
  display_name TEXT,
  oura_token TEXT,  -- Consider using Supabase Vault for production
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS on profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view own profile" ON profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON profiles
  FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

-- Protocols (predefined health protocols)
CREATE TABLE protocols (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT,  -- Emoji or icon class
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Protocols are public read-only
ALTER TABLE protocols ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view protocols" ON protocols
  FOR SELECT USING (true);

-- Protocol habits (daily checklist items)
CREATE TABLE protocol_habits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_id UUID NOT NULL REFERENCES protocols ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Habits are public read-only
ALTER TABLE protocol_habits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view protocol habits" ON protocol_habits
  FOR SELECT USING (true);

-- Friendships (bidirectional)
CREATE TABLE friendships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles ON DELETE CASCADE,
  friend_id UUID NOT NULL REFERENCES profiles ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, friend_id)
);

-- Enable RLS on friendships
ALTER TABLE friendships ENABLE ROW LEVEL SECURITY;

-- Users can see friendships they're part of
CREATE POLICY "Users can view own friendships" ON friendships
  FOR SELECT USING (auth.uid() = user_id OR auth.uid() = friend_id);

-- Users can create friend requests
CREATE POLICY "Users can send friend requests" ON friendships
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update friendships they received (to accept/decline)
CREATE POLICY "Users can respond to friend requests" ON friendships
  FOR UPDATE USING (auth.uid() = friend_id);

-- Users can delete their own friendships
CREATE POLICY "Users can remove friendships" ON friendships
  FOR DELETE USING (auth.uid() = user_id OR auth.uid() = friend_id);

-- Challenges
CREATE TABLE challenges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_id UUID NOT NULL REFERENCES protocols ON DELETE CASCADE,
  name TEXT NOT NULL,
  creator_id UUID NOT NULL REFERENCES profiles ON DELETE CASCADE,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS on challenges
ALTER TABLE challenges ENABLE ROW LEVEL SECURITY;

-- Challenge participants
CREATE TABLE challenge_participants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id UUID NOT NULL REFERENCES challenges ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'accepted', 'declined')),
  joined_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(challenge_id, user_id)
);

-- Enable RLS on challenge_participants
ALTER TABLE challenge_participants ENABLE ROW LEVEL SECURITY;

-- Users can view challenges they're participating in
CREATE POLICY "Users can view their challenges" ON challenges
  FOR SELECT USING (
    creator_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM challenge_participants
      WHERE challenge_id = challenges.id AND user_id = auth.uid()
    )
  );

-- Users can create challenges
CREATE POLICY "Users can create challenges" ON challenges
  FOR INSERT WITH CHECK (auth.uid() = creator_id);

-- Creators can update their challenges
CREATE POLICY "Creators can update challenges" ON challenges
  FOR UPDATE USING (auth.uid() = creator_id);

-- Creators can delete their challenges
CREATE POLICY "Creators can delete challenges" ON challenges
  FOR DELETE USING (auth.uid() = creator_id);

-- Participant policies
CREATE POLICY "Users can view challenge participants" ON challenge_participants
  FOR SELECT USING (
    user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM challenge_participants cp
      WHERE cp.challenge_id = challenge_participants.challenge_id AND cp.user_id = auth.uid()
    )
  );

-- Challenge creators can invite participants
CREATE POLICY "Creators can invite participants" ON challenge_participants
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM challenges WHERE id = challenge_id AND creator_id = auth.uid()
    )
  );

-- Users can update their own participation status
CREATE POLICY "Users can respond to invites" ON challenge_participants
  FOR UPDATE USING (auth.uid() = user_id);

-- Daily habit completions
CREATE TABLE habit_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles ON DELETE CASCADE,
  challenge_id UUID NOT NULL REFERENCES challenges ON DELETE CASCADE,
  habit_id UUID NOT NULL REFERENCES protocol_habits ON DELETE CASCADE,
  completed_date DATE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, challenge_id, habit_id, completed_date)
);

-- Enable RLS on habit_completions
ALTER TABLE habit_completions ENABLE ROW LEVEL SECURITY;

-- Users can view completions in their challenges
CREATE POLICY "Users can view challenge habit completions" ON habit_completions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM challenge_participants
      WHERE challenge_id = habit_completions.challenge_id
      AND user_id = auth.uid()
      AND status = 'accepted'
    )
  );

-- Users can mark their own habits complete
CREATE POLICY "Users can complete their habits" ON habit_completions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can delete their own completions
CREATE POLICY "Users can uncomplete their habits" ON habit_completions
  FOR DELETE USING (auth.uid() = user_id);

-- Daily sleep data (synced from Oura)
CREATE TABLE sleep_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles ON DELETE CASCADE,
  date DATE NOT NULL,
  pre_sleep_hr INT,
  avg_hr INT,
  total_sleep_minutes INT,
  deep_sleep_minutes INT,
  rem_sleep_minutes INT,
  light_sleep_minutes INT,
  sleep_score INT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, date)
);

-- Enable RLS on sleep_data
ALTER TABLE sleep_data ENABLE ROW LEVEL SECURITY;

-- Users can view their own sleep data
CREATE POLICY "Users can view own sleep data" ON sleep_data
  FOR SELECT USING (auth.uid() = user_id);

-- Users can view sleep data of challenge participants (shared data)
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
      AND sleep_data.date BETWEEN c.start_date AND c.end_date
    )
  );

-- Users can insert their own sleep data
CREATE POLICY "Users can insert own sleep data" ON sleep_data
  FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Users can update their own sleep data
CREATE POLICY "Users can update own sleep data" ON sleep_data
  FOR UPDATE USING (auth.uid() = user_id);

-- Create indexes for performance
CREATE INDEX idx_friendships_user_id ON friendships(user_id);
CREATE INDEX idx_friendships_friend_id ON friendships(friend_id);
CREATE INDEX idx_challenges_creator_id ON challenges(creator_id);
CREATE INDEX idx_challenges_dates ON challenges(start_date, end_date);
CREATE INDEX idx_challenge_participants_challenge_id ON challenge_participants(challenge_id);
CREATE INDEX idx_challenge_participants_user_id ON challenge_participants(user_id);
CREATE INDEX idx_habit_completions_user_challenge ON habit_completions(user_id, challenge_id);
CREATE INDEX idx_habit_completions_date ON habit_completions(completed_date);
CREATE INDEX idx_sleep_data_user_date ON sleep_data(user_id, date);
CREATE INDEX idx_protocol_habits_protocol_id ON protocol_habits(protocol_id);

-- Function to auto-create profile on user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (NEW.id, NEW.email);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger to create profile on auth.users insert
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Function to get friends list for a user
CREATE OR REPLACE FUNCTION get_friends(user_uuid UUID)
RETURNS TABLE (
  friendship_id UUID,
  friend_id UUID,
  friend_email TEXT,
  friend_display_name TEXT,
  status TEXT,
  created_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    f.id as friendship_id,
    CASE WHEN f.user_id = user_uuid THEN f.friend_id ELSE f.user_id END as friend_id,
    p.email as friend_email,
    p.display_name as friend_display_name,
    f.status,
    f.created_at
  FROM friendships f
  JOIN profiles p ON p.id = CASE WHEN f.user_id = user_uuid THEN f.friend_id ELSE f.user_id END
  WHERE (f.user_id = user_uuid OR f.friend_id = user_uuid)
  AND f.status = 'accepted';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
