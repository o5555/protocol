-- Feedback and bug reports table

CREATE TABLE feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles ON DELETE CASCADE,
  message TEXT NOT NULL,
  screen TEXT,
  device_info JSONB,
  error_log TEXT,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'seen', 'fixed', 'wont_fix')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can submit feedback" ON feedback
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own feedback" ON feedback
  FOR SELECT USING (auth.uid() = user_id);

CREATE INDEX idx_feedback_user_id ON feedback(user_id);
CREATE INDEX idx_feedback_status ON feedback(status);
CREATE INDEX idx_feedback_created_at ON feedback(created_at DESC);
