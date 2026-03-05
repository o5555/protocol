-- Change bedtime_start from TIMESTAMPTZ to TEXT to preserve the original
-- Oura ISO 8601 string with timezone offset (e.g. "2026-02-14T23:00:00-06:00").
-- TIMESTAMPTZ converts to UTC on storage, losing the original local time —
-- which is wrong when the user travels (Costa Rica bedtime shows as 4am UTC).
-- Next cron sync will backfill correct ISO strings for the last 90 days.
ALTER TABLE sleep_data ALTER COLUMN bedtime_start TYPE TEXT;
