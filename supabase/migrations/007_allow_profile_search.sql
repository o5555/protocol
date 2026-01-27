-- Allow authenticated users to search profiles by email for friend requests.
-- Without this, RLS blocks any cross-user profile lookup.
CREATE POLICY "Authenticated users can search profiles by email" ON profiles
  FOR SELECT TO authenticated
  USING (true);
