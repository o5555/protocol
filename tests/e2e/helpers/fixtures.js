// @ts-check
/**
 * Test fixtures for E2E tests
 * Contains mock data for users, sleep data, friends, challenges, etc.
 */

// Mock user for authenticated tests
const MOCK_USER = {
  id: 'test-user-123',
  email: 'testuser@example.com',
  created_at: '2024-01-01T00:00:00.000Z'
};

// Second mock user for friend/challenge tests
const MOCK_USER_2 = {
  id: 'test-user-456',
  email: 'friend@example.com',
  created_at: '2024-01-01T00:00:00.000Z'
};

// Mock Supabase session
const MOCK_SESSION = {
  access_token: 'mock-access-token-xyz',
  refresh_token: 'mock-refresh-token-abc',
  expires_at: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
  expires_in: 3600
};

// Mock user profile
const MOCK_PROFILE = {
  id: MOCK_USER.id,
  email: MOCK_USER.email,
  display_name: 'Test User',
  oura_token: 'mock-oura-token',
  onboarding_step: 4, // Completed onboarding
  created_at: MOCK_USER.created_at
};

// Mock sleep data for dashboard tests
const MOCK_SLEEP_DATA = [
  {
    id: 'sleep-1',
    user_id: MOCK_USER.id,
    date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    sleep_score: 85,
    pre_sleep_hr: 58,
    total_sleep_minutes: 450,
    deep_sleep_minutes: 90,
    rem_sleep_minutes: 120,
    light_sleep_minutes: 240
  },
  {
    id: 'sleep-2',
    user_id: MOCK_USER.id,
    date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    sleep_score: 82,
    pre_sleep_hr: 60,
    total_sleep_minutes: 420,
    deep_sleep_minutes: 85,
    rem_sleep_minutes: 110,
    light_sleep_minutes: 225
  },
  {
    id: 'sleep-3',
    user_id: MOCK_USER.id,
    date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    sleep_score: 78,
    pre_sleep_hr: 62,
    total_sleep_minutes: 400,
    deep_sleep_minutes: 75,
    rem_sleep_minutes: 100,
    light_sleep_minutes: 225
  }
];

// Generate mock sleep data for baseline (30 days)
function generateBaselineSleepData(userId = MOCK_USER.id, days = 30) {
  const data = [];
  for (let i = 0; i < days; i++) {
    const date = new Date(Date.now() - (31 + i) * 24 * 60 * 60 * 1000);
    data.push({
      id: `baseline-sleep-${i}`,
      user_id: userId,
      date: date.toISOString().split('T')[0],
      sleep_score: 75 + Math.floor(Math.random() * 15), // 75-90
      pre_sleep_hr: 55 + Math.floor(Math.random() * 10), // 55-65
      total_sleep_minutes: 390 + Math.floor(Math.random() * 60), // 6.5-7.5 hrs
      deep_sleep_minutes: 70 + Math.floor(Math.random() * 30),
      rem_sleep_minutes: 90 + Math.floor(Math.random() * 40),
      light_sleep_minutes: 200 + Math.floor(Math.random() * 50)
    });
  }
  return data;
}

// Mock friends list
const MOCK_FRIENDS = [
  {
    id: 'friend-1',
    user_id: MOCK_USER.id,
    friend_id: MOCK_USER_2.id,
    status: 'accepted',
    created_at: '2024-01-15T00:00:00.000Z',
    friend_profile: {
      id: MOCK_USER_2.id,
      email: MOCK_USER_2.email,
      display_name: 'Friend User'
    }
  }
];

// Mock pending friend requests
const MOCK_FRIEND_REQUESTS = [
  {
    id: 'request-1',
    user_id: 'requester-123',
    friend_id: MOCK_USER.id,
    status: 'pending',
    created_at: '2024-01-20T00:00:00.000Z',
    requester_profile: {
      id: 'requester-123',
      email: 'requester@example.com',
      display_name: 'Request User'
    }
  }
];

// Mock challenge
const MOCK_CHALLENGE = {
  id: 'challenge-1',
  name: 'Better Sleep January',
  description: 'Improve your sleep score over 30 days',
  metric: 'sleep_score',
  duration_days: 30,
  start_date: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  end_date: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  created_by: MOCK_USER.id,
  created_at: '2024-01-01T00:00:00.000Z',
  status: 'active'
};

// Mock challenge participants
const MOCK_CHALLENGE_PARTICIPANTS = [
  {
    id: 'participant-1',
    challenge_id: MOCK_CHALLENGE.id,
    user_id: MOCK_USER.id,
    joined_at: MOCK_CHALLENGE.created_at,
    baseline_value: 78,
    current_value: 85,
    profile: {
      id: MOCK_USER.id,
      email: MOCK_USER.email,
      display_name: 'Test User'
    }
  },
  {
    id: 'participant-2',
    challenge_id: MOCK_CHALLENGE.id,
    user_id: MOCK_USER_2.id,
    joined_at: MOCK_CHALLENGE.created_at,
    baseline_value: 80,
    current_value: 82,
    profile: {
      id: MOCK_USER_2.id,
      email: MOCK_USER_2.email,
      display_name: 'Friend User'
    }
  }
];

// Mock challenge invitations
const MOCK_CHALLENGE_INVITATIONS = [
  {
    id: 'invite-1',
    challenge_id: 'challenge-2',
    inviter_id: MOCK_USER_2.id,
    invitee_id: MOCK_USER.id,
    status: 'pending',
    created_at: '2024-01-25T00:00:00.000Z',
    challenge: {
      id: 'challenge-2',
      name: 'Heart Rate Challenge',
      metric: 'pre_sleep_hr'
    },
    inviter_profile: {
      id: MOCK_USER_2.id,
      email: MOCK_USER_2.email,
      display_name: 'Friend User'
    }
  }
];

module.exports = {
  // Users
  MOCK_USER,
  MOCK_USER_2,

  // Auth
  MOCK_SESSION,
  MOCK_PROFILE,

  // Sleep data
  MOCK_SLEEP_DATA,
  generateBaselineSleepData,

  // Friends
  MOCK_FRIENDS,
  MOCK_FRIEND_REQUESTS,

  // Challenges
  MOCK_CHALLENGE,
  MOCK_CHALLENGE_PARTICIPANTS,
  MOCK_CHALLENGE_INVITATIONS
};
