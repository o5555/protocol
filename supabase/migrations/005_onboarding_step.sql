-- Add onboarding step tracking to profiles
ALTER TABLE profiles ADD COLUMN onboarding_step INT NOT NULL DEFAULT 0;

-- Existing users skip onboarding
UPDATE profiles SET onboarding_step = 4;

-- Recreate handle_new_user() to include onboarding_step = 0
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, onboarding_step)
  VALUES (NEW.id, NEW.email, 0);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
