-- Push notification subscriptions for Web Push API
CREATE TABLE push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, endpoint)
);

ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Users can manage their own subscriptions
CREATE POLICY "Users can view own subscriptions" ON push_subscriptions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own subscriptions" ON push_subscriptions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own subscriptions" ON push_subscriptions
  FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX idx_push_subscriptions_user_id ON push_subscriptions(user_id);

-- Notification log to prevent duplicate sends
CREATE TABLE notification_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  challenge_id UUID NOT NULL REFERENCES challenges ON DELETE CASCADE,
  notification_type TEXT NOT NULL,
  sleep_date DATE NOT NULL,
  sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(challenge_id, notification_type, sleep_date)
);

ALTER TABLE notification_log ENABLE ROW LEVEL SECURITY;

-- Only service role accesses this table (no user-facing policies needed)
CREATE INDEX idx_notification_log_lookup ON notification_log(challenge_id, notification_type, sleep_date);
