# Challenge Wrap-Up Experience

**Date**: 2026-03-16
**Status**: Ready for planning

## What We're Building

When a 30-day challenge ends, the first time a user opens it they get a full-screen, swipeable card experience (like Instagram stories) that walks them through their results, celebrates achievements, and gives them a personalized bedtime routine to take forward.

After the first view, a "View Wrap-Up" button stays on the challenge detail page so they can revisit anytime.

## The Card Flow (4-5 swipeable full-screen cards)

### Card 1: Your Journey
Overview of the 30 days. Challenge name, dates, how many nights of data collected. Sets the stage.

### Card 2: Your Numbers
Before/after comparison for key sleep metrics:
- Sleep score (baseline avg vs challenge avg)
- Deep sleep minutes
- Resting HR
- Bedtime consistency

Show deltas with direction arrows (green = improved, red = declined). Clean, visual, glanceable.

### Card 3: Your Highlights
AI picks the top 3 most noteworthy achievements from their data. Different for everyone. Examples:
- "Your best deep sleep night was Mar 8 at 142 min — that's top 5% of your history"
- "You went to bed before 23:00 for 18 out of 30 nights"
- "Your resting HR dropped 3 bpm from baseline"

Presented as personalized "awards" — playful but backed by real numbers.

### Card 4: Your Routine
AI-generated personalized bedtime routine based on what worked during the challenge. Actionable and specific, e.g.:
- "Wind down by 22:30 — your data shows that's your sweet spot"
- "Your deep sleep peaks when you're asleep by 23:00"
- "Keep tracking HR — yours dropped steadily when you stuck to the routine"

### Card 5: What's Next
A compact "keep going" scorecard. 3-4 bullet points of what to remember. Maybe a "Start a new challenge" CTA.

## Key Decisions

- **Trigger**: Full-screen overlay on first visit to a completed challenge
- **Persistence**: "View Wrap-Up" button on detail page for revisiting
- **Personalization**: AI-generated (single API call with all 30 days of data)
- **Scorecard**: Sleep metrics before/after + AI-picked highlights (no fixed badge system)
- **UI**: Swipeable cards, dark theme, same design system
- **First-visit tracking**: localStorage flag per challenge ID

## AI Integration

One API call when the wrap-up is first opened. Send the full 30-day dataset (baseline + challenge) plus habit completions. The AI returns:
1. Top 3 highlights/achievements (for Card 3)
2. Personalized bedtime routine (for Card 4)
3. Key takeaways (for Card 5)

Cache the result in localStorage (keyed by challenge ID) so revisits don't re-call the API.

## Open Questions

- Should we add a "Share" button later? (User didn't pick it now, but could be a future add)
- Animation style for card transitions — simple slide or something more?
- Should the wrap-up auto-show only once, or every time until dismissed?
