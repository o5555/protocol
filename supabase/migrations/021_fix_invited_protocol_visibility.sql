-- Fix: Invited users can't see challenge protocols.
-- is_challenge_protocol_participant() only checked for 'accepted' status,
-- but invited users also need to see the protocol to understand the invitation.

CREATE OR REPLACE FUNCTION public.is_challenge_protocol_participant(p_protocol_id UUID, p_user_id UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.challenges c
    JOIN public.challenge_participants cp ON cp.challenge_id = c.id
    WHERE c.protocol_id = p_protocol_id
    AND cp.user_id = p_user_id
    AND cp.status IN ('accepted', 'invited')
  );
$$ LANGUAGE sql SECURITY DEFINER;
