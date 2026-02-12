-- Allow challenge co-participants to see each other's profiles.
-- Without this, invited non-friends show as "Unknown" because the
-- profiles RLS policy only allows viewing friends' profiles.

-- Drop and recreate the combined policy to include challenge participants
DROP POLICY IF EXISTS "Users can view profiles of friends" ON profiles;

CREATE POLICY "Users can view profiles of friends and co-participants" ON profiles
  FOR SELECT TO authenticated
  USING (
    auth.uid() = id  -- own profile
    OR id IN (
      -- Friends
      SELECT CASE WHEN f.user_id = auth.uid() THEN f.friend_id ELSE f.user_id END
      FROM friendships f
      WHERE (f.user_id = auth.uid() OR f.friend_id = auth.uid())
        AND f.status IN ('accepted', 'pending')
    )
    OR id IN (
      -- Challenge co-participants: anyone in the same challenge as me
      SELECT cp2.user_id
      FROM challenge_participants cp1
      JOIN challenge_participants cp2 ON cp1.challenge_id = cp2.challenge_id
      WHERE cp1.user_id = auth.uid()
        AND cp2.user_id <> auth.uid()
    )
  );
