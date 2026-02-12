-- Allow users to update their own pending invites (e.g. to change challenge_id when re-inviting)
CREATE POLICY "Users can update their invites" ON pending_invites
  FOR UPDATE USING (auth.uid() = inviter_id)
  WITH CHECK (auth.uid() = inviter_id);
