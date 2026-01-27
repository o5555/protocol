-- Add mode column to challenges (light = core 5 habits, pro = all habits)
ALTER TABLE challenges ADD COLUMN mode TEXT NOT NULL DEFAULT 'pro'
  CHECK (mode IN ('light', 'pro'));
