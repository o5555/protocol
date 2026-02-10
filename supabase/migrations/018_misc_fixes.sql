-- 018_misc_fixes.sql
-- Three targeted fixes for issues discovered in earlier migrations.

------------------------------------------------------------------------
-- Fix 1: Missing index on pending_invites.invited_email
--
-- The process_pending_invites() trigger (004, updated in 010) filters
-- with  WHERE LOWER(pi.invited_email) = LOWER(NEW.email)
-- but no index exists to support this lookup.  On a large pending_invites
-- table this becomes a sequential scan on every new profile insert.
------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_pending_invites_email
  ON pending_invites (LOWER(invited_email));

------------------------------------------------------------------------
-- Fix 2: NUMERIC without precision on heart-rate columns
--
-- Migration 006 changed avg_hr and pre_sleep_hr from INTEGER to NUMERIC
-- without specifying precision or scale.  Unbounded NUMERIC can store
-- arbitrarily large values and uses variable-length storage, which hurts
-- aggregation performance and allows nonsensical data (e.g. 99999.99999).
-- Constrain to NUMERIC(6,2) — supports values up to 9999.99, which is
-- more than sufficient for heart-rate BPM.
------------------------------------------------------------------------
ALTER TABLE sleep_data ALTER COLUMN avg_hr TYPE NUMERIC(6,2);
ALTER TABLE sleep_data ALTER COLUMN pre_sleep_hr TYPE NUMERIC(6,2);

------------------------------------------------------------------------
-- Fix 3: Missing ON DELETE behavior on challenge_participants.invited_by
--
-- Migration 010 added:
--   ALTER TABLE challenge_participants
--     ADD COLUMN invited_by UUID REFERENCES profiles(id);
--
-- The implicit default is ON DELETE NO ACTION, which means deleting the
-- inviting user's profile is blocked by the FK constraint.  The correct
-- behaviour is ON DELETE SET NULL — the participant row should survive
-- with invited_by cleared.
------------------------------------------------------------------------
ALTER TABLE challenge_participants
  DROP CONSTRAINT challenge_participants_invited_by_fkey;

ALTER TABLE challenge_participants
  ADD CONSTRAINT challenge_participants_invited_by_fkey
  FOREIGN KEY (invited_by) REFERENCES profiles(id) ON DELETE SET NULL;
