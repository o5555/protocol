-- Fix heart rate columns to support decimal values (e.g. 47.375 bpm from Oura API)
ALTER TABLE sleep_data ALTER COLUMN avg_hr TYPE NUMERIC;
ALTER TABLE sleep_data ALTER COLUMN pre_sleep_hr TYPE NUMERIC;
