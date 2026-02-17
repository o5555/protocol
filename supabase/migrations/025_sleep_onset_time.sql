-- Add bedtime_start to track when the user fell asleep (sleep onset time)
ALTER TABLE sleep_data ADD COLUMN bedtime_start TIMESTAMPTZ;
