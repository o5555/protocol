-- Pending invites for users who haven't signed up yet
CREATE TABLE pending_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inviter_id UUID NOT NULL REFERENCES profiles ON DELETE CASCADE,
  invited_email TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(inviter_id, invited_email)
);

ALTER TABLE pending_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their sent invites" ON pending_invites
  FOR SELECT USING (auth.uid() = inviter_id);

CREATE POLICY "Users can create invites" ON pending_invites
  FOR INSERT WITH CHECK (auth.uid() = inviter_id);

CREATE POLICY "Users can delete their invites" ON pending_invites
  FOR DELETE USING (auth.uid() = inviter_id);

-- When a new user signs up, auto-create friendships from pending invites
CREATE OR REPLACE FUNCTION public.process_pending_invites()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.friendships (user_id, friend_id, status)
  SELECT pi.inviter_id, NEW.id, 'accepted'
  FROM public.pending_invites pi
  WHERE LOWER(pi.invited_email) = LOWER(NEW.email)
  ON CONFLICT (user_id, friend_id) DO NOTHING;

  DELETE FROM public.pending_invites
  WHERE LOWER(invited_email) = LOWER(NEW.email);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_profile_created_process_invites
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.process_pending_invites();
