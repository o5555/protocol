-- Fix two security issues:
-- 1. Migration 007 granted all authenticated users full SELECT on profiles,
--    exposing oura_token to any logged-in user.
-- 2. get_friends() accepted an arbitrary user_uuid parameter, letting any
--    caller enumerate another user's friend list.

-- ============================================================
-- Fix 1: Replace the overly broad profile SELECT policy with a
-- SECURITY DEFINER function that returns only safe columns.
-- ============================================================

-- Drop the dangerous blanket policy from migration 007
DROP POLICY IF EXISTS "Authenticated users can search profiles by email" ON profiles;

-- Create a safe search function that never exposes oura_token
CREATE OR REPLACE FUNCTION search_profiles_by_email(search_email TEXT)
RETURNS TABLE (
  id UUID,
  email TEXT,
  display_name TEXT
) AS $$
BEGIN
  -- Only allow authenticated users
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN QUERY
  SELECT p.id, p.email, p.display_name
  FROM profiles p
  WHERE p.email = lower(search_email)
    AND p.id <> auth.uid();  -- Don't return the caller's own profile
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Also allow the friendships join queries to read friend profiles.
-- This policy lets users see profiles of people they share a friendship with,
-- but only exposes rows where a friendship link exists.
CREATE POLICY "Users can view profiles of friends" ON profiles
  FOR SELECT TO authenticated
  USING (
    auth.uid() = id  -- own profile (preserves original policy behavior)
    OR id IN (
      SELECT CASE WHEN f.user_id = auth.uid() THEN f.friend_id ELSE f.user_id END
      FROM friendships f
      WHERE (f.user_id = auth.uid() OR f.friend_id = auth.uid())
        AND f.status IN ('accepted', 'pending')
    )
  );

-- Drop the original "view own profile" policy since the new one covers it
DROP POLICY IF EXISTS "Users can view own profile" ON profiles;

-- ============================================================
-- Fix 2: Replace get_friends() so it uses auth.uid() internally
-- instead of accepting an arbitrary user_uuid parameter.
-- ============================================================

CREATE OR REPLACE FUNCTION get_friends()
RETURNS TABLE (
  friendship_id UUID,
  friend_id UUID,
  friend_email TEXT,
  friend_display_name TEXT,
  status TEXT,
  created_at TIMESTAMP WITH TIME ZONE
) AS $$
DECLARE
  current_user_id UUID := auth.uid();
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN QUERY
  SELECT
    f.id AS friendship_id,
    CASE WHEN f.user_id = current_user_id THEN f.friend_id ELSE f.user_id END AS friend_id,
    p.email AS friend_email,
    p.display_name AS friend_display_name,
    f.status,
    f.created_at
  FROM friendships f
  JOIN profiles p ON p.id = CASE WHEN f.user_id = current_user_id THEN f.friend_id ELSE f.user_id END
  WHERE (f.user_id = current_user_id OR f.friend_id = current_user_id)
    AND f.status = 'accepted';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
