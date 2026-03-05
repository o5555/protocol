-- Add efficiency contributor score from Oura daily_sleep endpoint
-- This matches the "Efficiency" score shown in the Oura app (0-100),
-- as opposed to sleep_efficiency which is the raw % (time asleep / time in bed).
ALTER TABLE sleep_data ADD COLUMN IF NOT EXISTS sleep_efficiency_score INT;
