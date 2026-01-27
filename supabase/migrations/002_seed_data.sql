-- Seed data for protocols and habits
-- Run this after the migration

-- Huberman Sleep Protocol
INSERT INTO protocols (id, name, description, icon) VALUES
  ('11111111-1111-1111-1111-111111111111',
   'Huberman Sleep Protocol',
   'Dr. Andrew Huberman''s science-backed sleep optimization protocol focusing on light exposure, temperature, and timing.',
   '🧠');

INSERT INTO protocol_habits (protocol_id, title, description, sort_order) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Morning sunlight exposure', 'Get 10-30 minutes of sunlight within 30-60 minutes of waking', 1),
  ('11111111-1111-1111-1111-111111111111', 'No caffeine after 2pm', 'Avoid caffeine in the afternoon to prevent sleep disruption', 2),
  ('11111111-1111-1111-1111-111111111111', 'Afternoon sunlight', 'Get sunlight exposure in the late afternoon to signal approaching evening', 3),
  ('11111111-1111-1111-1111-111111111111', 'Dim lights after sunset', 'Reduce artificial light exposure 2-3 hours before bed', 4),
  ('11111111-1111-1111-1111-111111111111', 'Cool bedroom temperature', 'Keep bedroom at 65-68°F (18-20°C) for optimal sleep', 5),
  ('11111111-1111-1111-1111-111111111111', 'No screens 1 hour before bed', 'Avoid blue light from phones/computers before sleep', 6),
  ('11111111-1111-1111-1111-111111111111', 'Consistent wake time', 'Wake up at the same time every day, even weekends', 7),
  ('11111111-1111-1111-1111-111111111111', 'No food 2-3 hours before bed', 'Avoid eating close to bedtime for better sleep quality', 8),
  ('11111111-1111-1111-1111-111111111111', 'Limit alcohol', 'Avoid alcohol or limit to early evening only', 9),
  ('11111111-1111-1111-1111-111111111111', 'Practice NSDR or meditation', 'Do a Non-Sleep Deep Rest protocol or meditation if needed', 10);

-- Bryan Johnson Protocol (Blueprint)
INSERT INTO protocols (id, name, description, icon) VALUES
  ('22222222-2222-2222-2222-222222222222',
   'Bryan Johnson Blueprint',
   'Bryan Johnson''s comprehensive health optimization protocol with strict timing and measurements.',
   '🦾');

INSERT INTO protocol_habits (protocol_id, title, description, sort_order) VALUES
  ('22222222-2222-2222-2222-222222222222', 'Wake at 5am', 'Consistent early wake time for circadian optimization', 1),
  ('22222222-2222-2222-2222-222222222222', 'Morning light therapy', 'Use 10,000 lux light box for 10 minutes upon waking', 2),
  ('22222222-2222-2222-2222-222222222222', 'Morning workout', 'Complete daily exercise routine in the morning', 3),
  ('22222222-2222-2222-2222-222222222222', 'First meal by 6am', 'Eat super veggie meal early in the day', 4),
  ('22222222-2222-2222-2222-222222222222', 'Last meal by 11am', 'Complete all eating within early time window', 5),
  ('22222222-2222-2222-2222-222222222222', 'No caffeine', 'Avoid all caffeine for optimal sleep and HRV', 6),
  ('22222222-2222-2222-2222-222222222222', 'No alcohol', 'Complete abstinence from alcohol', 7),
  ('22222222-2222-2222-2222-222222222222', 'Wind down at 7pm', 'Begin evening relaxation routine', 8),
  ('22222222-2222-2222-2222-222222222222', 'Blue light blocking', 'Wear blue light blocking glasses after sunset', 9),
  ('22222222-2222-2222-2222-222222222222', 'Bedroom blackout', 'Ensure complete darkness in bedroom', 10),
  ('22222222-2222-2222-2222-222222222222', 'Sleep by 8:30pm', 'Strict bedtime for optimal recovery', 11),
  ('22222222-2222-2222-2222-222222222222', 'Track all metrics', 'Log sleep, HRV, and other health metrics daily', 12);
