# Onboarding Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shorten onboarding to 3 steps (Name, Token, Done), detect pending challenge invites to show a contextual "Join" step, and update the dashboard welcome state with a single "Create a Challenge" CTA.

**Architecture:** Remove onboarding steps 2 (Challenge) and 3 (Friend) entirely. Add an async check after the Token step for pending `challenge_participants` rows. If found, insert a contextual "Join Challenge" step. Update dashboard welcome state to show "Create a Challenge" as the primary action. The invite detection uses existing DB triggers (`process_pending_invites`) — no schema changes needed.

**Tech Stack:** Vanilla JS, Supabase (Postgres), Playwright e2e tests

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `js/onboarding.js` | Modify | Remove steps 2+3, add invite detection, renumber steps |
| `js/dashboard.js` | Modify | Update welcome state CTAs |
| `js/auth.js` | Modify | Update `onboarding_step` threshold (5 → 3) |
| `tests/e2e/interactions.spec.js` | Modify | Update onboarding step tests |
| `tests/e2e/comprehensive-smoke.spec.js` | Modify | Update any onboarding step references |
| `sw.js` | Modify | Bump cache version |

---

## Task 1: Shorten onboarding to 3 steps

**Files:**
- Modify: `js/onboarding.js`
- Modify: `js/auth.js:230`

### What changes

The step mapping changes from:
```
OLD: 0=Name, 1=Token, 2=Challenge, 3=Friend, 4=Complete → onboarding_step=5 means done
NEW: 0=Name, 1=Token, 2=Complete → onboarding_step=3 means done
```

- [ ] **Step 1: Update `renderStep()` switch statement**

In `js/onboarding.js`, replace the switch in `renderStep()` (lines 27-46):

```javascript
switch (step) {
  case 0:
    this.renderNameStep(container);
    break;
  case 1:
    this.renderTokenStep(container);
    break;
  case 2:
    this.renderCompleteStep(container);
    break;
  default:
    this.handleComplete();
    return;
}
```

- [ ] **Step 2: Update progress bar**

In `js/onboarding.js`, change `renderProgressBar()` (line 60):

```javascript
const steps = ['Name', 'Token', 'Done'];
```

- [ ] **Step 3: Update `handleNameSave()` to advance to step 1**

No change needed — already calls `this.advanceStep(1)`.

- [ ] **Step 4: Update `handleTokenSave()` to advance to step 2**

In `js/onboarding.js`, change the `advanceStep` call in `handleTokenSave()` (line 444):

```javascript
await this.advanceStep(2);
```

No change needed — already advances to step 2, which is now the Complete step.

- [ ] **Step 5: Update skip button in token step to advance to step 2**

In `js/onboarding.js`, change the skip button onclick in `renderTokenStep()` (line 156):

```javascript
<button onclick="Onboarding.advanceStep(2)"
```

No change needed — already advances to step 2.

- [ ] **Step 6: Update `handleComplete()` to save step 3**

In `js/onboarding.js`, change `handleComplete()` (line 461):

```javascript
await Auth.updateProfile({ onboarding_step: 3 });
```

- [ ] **Step 7: Update `Auth.checkOnboarding()` threshold**

In `js/auth.js`, change the onboarding completion check (line 230):

```javascript
if (!profile || profile.onboarding_step < 3) {
```

- [ ] **Step 8: Delete `renderChallengeStep()` and `renderFriendStep()` methods**

Remove these methods and their helpers from `js/onboarding.js`:
- `renderChallengeStep()` (lines 162-217)
- `selectProtocol()` (lines 222-249)
- `handleCreateChallenge()` (lines 251-279)
- `selectedProtocolId` and `selectedProtocolName` properties (lines 219-220)
- `renderFriendStep()` (lines 282-327)
- `handleSendInvite()` (lines 329-379)

- [ ] **Step 9: Verify syntax**

Run: `node -c js/onboarding.js`
Expected: no output (success)

- [ ] **Step 10: Commit**

```bash
git add js/onboarding.js js/auth.js
git commit -m "refactor: shorten onboarding to 3 steps (Name, Token, Done)"
```

---

## Task 2: Add challenge invite detection to onboarding

**Files:**
- Modify: `js/onboarding.js`

### What changes

After the Token step (when user advances to step 2), check if the user has any pending challenge invites in `challenge_participants`. If found, render a "Join Challenge" step instead of the Complete step.

- [ ] **Step 1: Add `_pendingInvite` state property**

At the top of the Onboarding object (after `profile: null`):

```javascript
_pendingInvite: null, // { challenge, inviter } if detected during onboarding
```

- [ ] **Step 2: Add `checkPendingInvites()` method**

Add this method to the Onboarding object:

```javascript
async checkPendingInvites() {
  try {
    const currentUser = await SupabaseClient.getCurrentUser();
    if (!currentUser) return null;

    const client = SupabaseClient.client;

    // Check for pending challenge invitations
    const { data: invites } = await client
      .from('challenge_participants')
      .select('challenge_id, invited_by, challenges(id, name, start_date, protocol_id, protocols(name)), profiles!challenge_participants_invited_by_fkey(display_name, email)')
      .eq('user_id', currentUser.id)
      .eq('status', 'invited')
      .limit(1);

    if (invites && invites.length > 0) {
      const invite = invites[0];
      const challenge = invite.challenges;
      const inviter = invite.profiles;

      // Skip if challenge is already completed (ended more than 30 days ago)
      if (challenge) {
        const startDate = new Date(challenge.start_date);
        const endDate = new Date(startDate);
        endDate.setDate(endDate.getDate() + 30);
        if (endDate < new Date()) return null; // Challenge is over
      }

      return {
        participantId: invite.challenge_id ? `${invite.challenge_id}_${currentUser.id}` : null,
        challengeId: invite.challenge_id,
        challengeName: challenge?.name || 'Sleep Challenge',
        protocolName: challenge?.protocols?.name || '',
        inviterName: inviter?.display_name || inviter?.email?.split('@')[0] || 'A friend',
        startDate: challenge?.start_date
      };
    }
    return null;
  } catch (error) {
    console.warn('[Onboarding] Could not check pending invites:', error);
    return null;
  }
},
```

Note: The join query `profiles!challenge_participants_invited_by_fkey` references the `invited_by` foreign key. If this doesn't work due to Supabase join naming, fall back to a separate query for the inviter profile. Test this during implementation.

- [ ] **Step 3: Modify `renderStep()` to check for invites at step 2**

Update the step 2 case in `renderStep()`:

```javascript
case 2:
  // Check for pending challenge invites before showing Complete
  this.checkPendingInvites().then(invite => {
    if (invite) {
      this._pendingInvite = invite;
      container.innerHTML = '';
      container.className = 'onboarding-step-enter';
      this.renderJoinChallengeStep(container, invite);
      container.insertAdjacentHTML('afterbegin', this.renderProgressBar(step));
      requestAnimationFrame(() => {
        container.classList.remove('onboarding-step-enter');
        container.classList.add('onboarding-step-active');
      });
    } else {
      this.renderCompleteStep(container);
    }
  });
  // Show loading state while checking
  container.innerHTML += `
    <div class="text-center py-20 text-oura-muted text-sm">Checking for invitations...</div>
  `;
  return; // Don't add progress bar yet — the async callback will add it
```

- [ ] **Step 4: Add `renderJoinChallengeStep()` method**

```javascript
renderJoinChallengeStep(container, invite) {
  const dayNumber = invite.startDate ? Challenges.getDayNumber(invite.startDate) : null;
  const dayInfo = dayNumber ? `Day ${dayNumber} of 30` : '';

  container.innerHTML += `
    <div class="text-center mb-8">
      <svg class="w-12 h-12 mx-auto text-oura-accent mb-4" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M18 18.72a9.094 9.094 0 0 0 3.741-.479 3 3 0 0 0-4.682-2.72m.94 3.198.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0 1 12 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 0 1 6 18.719m12 0a5.971 5.971 0 0 0-.941-3.197m0 0A5.995 5.995 0 0 0 12 12.75a5.995 5.995 0 0 0-5.058 2.772m0 0a3 3 0 0 0-4.681 2.72 8.986 8.986 0 0 0 3.74.477m.94-3.197a5.971 5.971 0 0 0-.94 3.197M15 6.75a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm6 3a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Zm-13.5 0a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0Z" /></svg>
      <h2 class="text-2xl font-bold mb-2">You've Been Invited!</h2>
      <p class="text-oura-muted text-sm">${escapeHtml(invite.inviterName)} wants you to join their challenge.</p>
    </div>
    <div class="bg-oura-card rounded-2xl p-6 mb-6 border border-oura-accent/20">
      <h3 class="text-lg font-semibold mb-1">${escapeHtml(invite.challengeName)}</h3>
      ${invite.protocolName ? `<p class="text-sm text-oura-muted mb-2">${escapeHtml(invite.protocolName)}</p>` : ''}
      ${dayInfo ? `<p class="text-xs text-oura-muted">${dayInfo}</p>` : ''}
    </div>
    <button onclick="Onboarding.handleJoinChallenge()"
      class="w-full py-3.5 bg-gradient-to-br from-oura-accent to-oura-accent-dark text-black font-semibold rounded-xl hover:shadow-lg hover:shadow-oura-accent/30 transition-all mb-3">
      Join Challenge
    </button>
    <button onclick="Onboarding.renderStep(2); Onboarding._pendingInvite = null;"
      class="w-full py-3 text-oura-muted text-sm hover:text-white transition-colors">
      Maybe later
    </button>
  `;
},
```

- [ ] **Step 5: Add `handleJoinChallenge()` method**

```javascript
async handleJoinChallenge() {
  const invite = this._pendingInvite;
  if (!invite) {
    this.renderStep(2);
    return;
  }

  try {
    // Accept the challenge invitation
    const currentUser = await SupabaseClient.getCurrentUser();
    const { error } = await SupabaseClient.client
      .from('challenge_participants')
      .update({ status: 'accepted', joined_at: new Date().toISOString() })
      .eq('challenge_id', invite.challengeId)
      .eq('user_id', currentUser.id);

    if (error) throw error;

    this._pendingInvite = null;

    // Go to complete step
    this.renderCompleteStep(document.getElementById('onboarding-container'));
    const container = document.getElementById('onboarding-container');
    container.insertAdjacentHTML('afterbegin', this.renderProgressBar(2));
  } catch (error) {
    console.error('Error joining challenge:', error);
    App.showToast('Failed to join challenge: ' + error.message, 'error');
  }
},
```

- [ ] **Step 6: Verify syntax**

Run: `node -c js/onboarding.js`
Expected: no output (success)

- [ ] **Step 7: Commit**

```bash
git add js/onboarding.js
git commit -m "feat: detect pending challenge invites during onboarding"
```

---

## Task 3: Update dashboard welcome state

**Files:**
- Modify: `js/dashboard.js:924-975`

### What changes

The dashboard welcome state currently shows two CTAs: "Connect Your Oura Ring" and "Start a Challenge". Update to:

- **No token, no challenge:** Show "Connect Your Oura Ring" as primary, "Create a Challenge" as secondary
- **Has token, no challenge:** Show single "Create a Challenge" CTA (already implemented, just update copy)
- **Has token, has challenge:** Normal dashboard (unchanged)

- [ ] **Step 1: Update the welcome state copy**

In `js/dashboard.js`, change the "Start a Challenge" button text in the `isNewUser` block (line 950):

Change:
```javascript
<p class="font-semibold mb-0.5">Start a Challenge</p>
<p class="text-sm text-oura-muted">Pick a protocol and compete with friends</p>
```

To:
```javascript
<p class="font-semibold mb-0.5">Create a Challenge</p>
<p class="text-sm text-oura-muted">Pick a protocol and invite friends to compete</p>
```

- [ ] **Step 2: Update the "Start a Challenge" CTA for users with token but no challenge**

In `js/dashboard.js`, update the CTA copy in the `activeChallenges.length === 0` block (around line 1052):

Change:
```javascript
<p class="font-semibold text-sm">Start a Challenge</p>
<p class="text-xs text-oura-muted mt-0.5">Pick a protocol and compete with friends for 30 days</p>
```

To:
```javascript
<p class="font-semibold text-sm">Create a Challenge</p>
<p class="text-xs text-oura-muted mt-0.5">Pick a protocol and invite friends to compete</p>
```

- [ ] **Step 3: Update the welcome heading for token-connected users**

In `js/dashboard.js`, change the welcome heading text (line 929) to be more contextual:

```javascript
<p class="text-oura-muted text-sm">Get started by connecting your Oura Ring and joining a challenge.</p>
```

To:

```javascript
<p class="text-oura-muted text-sm">Connect your Oura Ring and create a challenge to get started.</p>
```

- [ ] **Step 4: Commit**

```bash
git add js/dashboard.js
git commit -m "fix: update dashboard welcome CTAs to say Create a Challenge"
```

---

## Task 4: Update tests

**Files:**
- Modify: `tests/e2e/interactions.spec.js`
- Modify: `tests/e2e/comprehensive-smoke.spec.js` (if onboarding steps referenced)

### What changes

Tests that reference old step numbers or removed steps need updating.

- [ ] **Step 1: Find all test references to old steps**

Run: `grep -n "Step 2.*Pick\|Step 3.*Add Friend\|step.*3\|step.*4\|onboarding_step.*4\|onboarding_step.*5\|showOnboardingStep.*2\|showOnboardingStep.*3\|showOnboardingStep.*4" tests/e2e/interactions.spec.js tests/e2e/comprehensive-smoke.spec.js tests/e2e/auth-flows.spec.js`

- [ ] **Step 2: Remove tests for deleted steps**

Delete the test `'Step 2 (Pick Challenge) — protocols container visible, cards render'` (interactions.spec.js ~line 830-852).

Delete the test `'Step 3 (Add Friend) — email input and invite button visible'` (interactions.spec.js ~line 854-869).

- [ ] **Step 3: Update Step 4 (Complete) test to Step 2**

Rename test from `'Step 4 (Complete) — shows "You\'re All Set!" and Go to Dashboard button'` to `'Step 2 (Complete) — shows "You\'re All Set!" and Go to Dashboard button'`.

Change `showOnboardingStep(page, 4)` to `showOnboardingStep(page, 2)`.

- [ ] **Step 4: Update any `onboarding_step` references**

Find all `onboarding_step: 4` and `onboarding_step: 5` in test files. Change:
- `onboarding_step: 4` → `onboarding_step: 2` (user at complete step)
- `onboarding_step: 5` → `onboarding_step: 3` (user who completed onboarding)

- [ ] **Step 5: Update `advanceStep` mock test**

The test `'Fill name in step 0 and click Continue — step advances'` (line 888) mocks `advanceStep` and checks it's called with `1`. This is still correct — Name advances to Token (step 1).

- [ ] **Step 6: Run tests**

Run: `npx playwright test tests/e2e/interactions.spec.js tests/e2e/comprehensive-smoke.spec.js tests/e2e/auth-flows.spec.js --reporter=line`
Expected: all pass

- [ ] **Step 7: Run full test suite**

Run: `npx playwright test --reporter=line`
Expected: 990+ pass, 0 fail

- [ ] **Step 8: Commit**

```bash
git add tests/
git commit -m "test: update onboarding tests for 3-step flow"
```

---

## Task 5: Handle backward compatibility for existing users

**Files:**
- Modify: `js/auth.js`

### What changes

Existing users in the database may have `onboarding_step` values of 2, 3, 4, or 5 from the old flow. The new threshold is 3. Users with old values of 3, 4, or 5 are already past completion — they should NOT be shown onboarding again.

- [ ] **Step 1: Verify the threshold logic**

In `js/auth.js`, the check is:
```javascript
if (!profile || profile.onboarding_step < 3) {
```

This means:
- `onboarding_step = 0, 1, 2` → show onboarding (correct — they haven't finished)
- `onboarding_step = 3, 4, 5` → skip onboarding (correct — old users who completed, plus new users)

This is already correct. No code change needed for backward compatibility.

- [ ] **Step 2: Verify with a check**

Confirm mentally:
- Old user with `onboarding_step = 5` (completed old flow): `5 < 3` is false → skips onboarding. Correct.
- Old user with `onboarding_step = 2` (was on Challenge step in old flow): `2 < 3` is true → shows onboarding at step 2, which is now Complete. They'll see "You're All Set!" and click through. Acceptable.
- New user with `onboarding_step = 0`: shows onboarding at step 0. Correct.

No changes needed.

---

## Task 6: Bump SW cache and final verification

**Files:**
- Modify: `sw.js`

- [ ] **Step 1: Bump cache version**

Change `CACHE_NAME` in `sw.js` line 1 to the next version.

- [ ] **Step 2: Run full test suite**

Run: `npx playwright test --reporter=line`
Expected: 990+ pass, 0 fail

- [ ] **Step 3: Browser test the full onboarding flow**

Test three scenarios:
1. Solo user: Name → Token (skip) → Done → Dashboard shows welcome with "Create a Challenge"
2. Solo user with token: Name → Token (enter real token) → Done → Dashboard shows data + "Create a Challenge" CTA
3. Invited user: Create a pending invite in DB first, then sign up → Name → Token → "You've Been Invited!" → Join → Done → Dashboard shows league table

- [ ] **Step 4: Commit**

```bash
git add sw.js
git commit -m "chore: bump SW cache for onboarding redesign"
```
