# Protocol Circle — CLAUDE.md

> Source of truth for building Protocol Circle. Read fully before making any changes.

## Project Overview

Protocol Circle is a sleep-tracking challenge app — think Oura Ring meets social fitness. Users track sleep via Oura API, compete in challenges with friends, and follow health protocols. It runs as a **PWA installed on the home screen**, primarily on iPhone.

The user of this codebase is a solo PM-builder. Keep things simple. Don't abstract when inline works. Don't add libraries when vanilla JS does the job.

## Tech Stack

- **Frontend**: Vanilla JS (no framework, no build step, no bundler)
- **Styling**: Tailwind CSS via CDN with custom config in `index.html`
- **Charts**: Chart.js via CDN
- **Backend**: Node.js HTTP server (`server.js`) — serves static files + API routes
- **Database/Auth**: Supabase (Postgres, Auth with OTP email codes, Realtime)
- **Push Notifications**: Web Push with VAPID keys (`web-push` npm package)
- **Testing**: Playwright (e2e tests in `tests/e2e/`)
- **PWA**: Service Worker (`sw.js`) with versioned cache, deep-link support

There is **no build step**. You edit files, push to git, and it deploys. Do not introduce bundlers, transpilers, or compile steps.

## File Structure

```
index.html              # SPA entry — all HTML structure, App router, inline Tailwind config
sw.js                   # Service Worker (cache, push, deep-link handoff)
server.js               # Node HTTP server + API routes (Oura proxy, push, cron)
manifest.json           # PWA manifest
css/
  mobile.css            # Safe-area insets, animations, pull-to-refresh
js/
  supabase.js           # Supabase client init
  auth.js               # Auth (OTP flow, profile, token management)
  onboarding.js         # New user onboarding wizard
  dashboard.js          # Home page — sleep scores, charts
  protocols.js          # Health protocol library
  challenges.js         # Challenge list + detail (leaderboard, sleep comparison)
  friends.js            # Friend management, invitations
  comparison.js         # Sleep data comparison views
  account.js            # Account/settings page
  notifications.js      # Push notification subscription
  cache.js              # Client-side data caching
  pull-to-refresh.js    # Native-feel pull-to-refresh
  dateutils.js          # Date formatting helpers
icons/                  # PWA icons and splash screens
tests/e2e/              # Playwright test files
```

## App Architecture

### SPA Routing
- Single `index.html` with page `<div>`s toggled via `App.navigateTo(page, detailId)`
- Pages: `dashboard`, `protocols`, `protocol-detail`, `challenges`, `challenge-detail`, `friends`, `account`
- State saved to `localStorage` and `history.pushState()` for back/forward navigation
- Page transitions use CSS opacity fade (respects `prefers-reduced-motion`)

### Auth Flow
- `Auth.init()` → `updateUI(user, navigate=false)` → `checkOnboarding()` (async, NOT awaited)
- On `SIGNED_IN` event: `updateUI(user, navigate=true)` → navigates to dashboard
- The `navigate` flag prevents `checkOnboarding()` from overriding deep-link navigation on initial load

### Service Worker
- Cache versioned as `pc-vN` — **bump on every deploy that changes JS/HTML**
- Network-first for JS/HTML, cache-first for static assets, network-only for API calls
- Deep-link via Cache API handoff (see below)
- Push notification handler with `storeDeepLink()` before `openWindow()`

### iOS PWA Deep-Link Pattern
`clients.openWindow(url)` on iOS Safari PWAs **silently drops URL query parameters**. We use the **Cache API handoff** pattern:
1. SW writes nav target to `caches.open('pc-deeplink')` before `openWindow('/')`
2. `App.init()` reads from cache on startup, deletes after reading (one-time use, 30s expiry)
3. URL params kept as fallback for Android/desktop
4. The `activate` handler must preserve the `pc-deeplink` cache

---

## Design System

The app has a dark, native feel inspired by the Oura Ring app. It should feel like a **native iOS app**, not a website.

### Color Palette

Defined in the Tailwind config inside `index.html`. Use these class names everywhere — never raw hex codes in new code.

| Token              | Value       | Tailwind Class        | Usage                              |
|--------------------|-------------|-----------------------|------------------------------------|
| Background         | `#0a0a12`   | `bg-oura-bg`         | Page/app background                |
| Card               | `#0f0f1a`   | `bg-oura-card`       | Cards, modals, panels              |
| Border             | `#2a2a4e`   | `border-oura-border` | Card borders, dividers, inputs     |
| Accent (teal)      | `#00c8a0`   | `text-oura-accent`   | Active states, buttons, highlights |
| Accent dark        | `#00a080`   | `oura-accent-dark`   | Gradient endpoints, pressed state  |
| Muted              | `#6b7280`   | `text-oura-muted`    | Secondary text, placeholders       |
| Subtle             | `#1a1a2e`   | `bg-oura-subtle`     | Hover states, subtle backgrounds   |
| Text               | `#ffffff`   | `text-white`         | Primary text                       |

**Rules:**
- Dark background everywhere. Never use white or light backgrounds.
- Accent teal (`#00c8a0`) is the signature color. Use it for CTAs, active nav, progress indicators.
- Buttons use gradient: `bg-gradient-to-br from-oura-accent to-oura-accent-dark` with `text-black`.
- Borders are subtle — `border-oura-border` or `border-oura-border/50` with backdrop blur.
- Never introduce new colors without adding them to the Tailwind config and this file.

### Typography

System font stack for native feel:
```
font-[-apple-system,BlinkMacSystemFont,'SF_Pro_Display','Segoe_UI',Roboto,sans-serif]
```

| Element         | Classes                              |
|-----------------|--------------------------------------|
| Page title      | `text-2xl font-semibold`             |
| Page subtitle   | `text-oura-muted text-sm`           |
| Card title      | `text-lg font-semibold` or `font-bold` |
| Body text       | `text-sm` or `text-base`            |
| Labels          | `text-sm text-oura-muted`           |
| Small/caption   | `text-xs text-oura-muted`           |
| Nav labels      | `text-[11px] font-medium`           |

**Rules:**
- Never go below `text-[11px]` (nav labels only). Body content minimum is `text-xs` (12px).
- Font size `16px` (`text-base`) on inputs to prevent iOS auto-zoom.
- Headings are `font-semibold` or `font-bold`. Never use `font-light` or `font-thin`.

### Spacing & Layout

- Page content: `px-4` horizontal padding, `sm:max-w-4xl sm:mx-auto` for wider screens
- Card padding: `p-4` to `p-6` depending on content density
- Section heading + subtitle: `mb-6` after the heading block
- Gap between cards: `space-y-3` or `space-y-4`
- Bottom nav clearance: handled by `app-main` class in `mobile.css`
- Safe areas (notch, Dynamic Island): handled by CSS env() in `mobile.css`

### Components

**Cards:**
```html
<div class="bg-oura-card rounded-2xl p-4 border border-oura-border/30">
```

**Primary buttons:**
```html
<button class="w-full py-3 bg-gradient-to-br from-oura-accent to-oura-accent-dark text-black font-semibold rounded-xl hover:shadow-lg hover:shadow-oura-accent/30 transition-all">
```

**Secondary/ghost buttons:**
```html
<button class="text-oura-muted text-sm py-2">
```

**Inputs:**
```html
<input class="w-full px-4 py-3 bg-oura-bg border border-oura-border rounded-xl text-white placeholder-neutral-600 focus:outline-none focus:border-oura-accent">
```

**Bottom nav tab:**
- Inactive: `text-oura-muted`
- Active: `text-oura-accent bg-oura-accent/10`
- Icons: inline SVG, `w-7 h-7`, stroke-based (Heroicons style)

### Icons

- Use inline SVGs throughout (Heroicons outline style, `stroke-width="1.5"`)
- Do not add an icon library. Copy SVG paths directly.
- Icon sizes: `w-4 h-4` (small/inline), `w-5 h-5` (buttons), `w-7 h-7` (nav)
- Never use emoji as UI elements. Use SVGs or text.

### Animations

Defined in `css/mobile.css`. Keep animations subtle and fast.

- Page transitions: 150ms opacity fade
- Onboarding steps: 300ms fade + translateY
- Pull-to-refresh: custom spinner with ring animation
- Sync indicator: Oura-style spinning ring with glow
- Respect `prefers-reduced-motion` — check before animating

### App-like Feel Checklist

When building new screens or components, verify:
- [ ] Dark background (`bg-oura-bg`), no white flashes
- [ ] Safe-area padding (top for notch, bottom for tab bar)
- [ ] Touch targets at least 44px (ideally 48px+)
- [ ] No hover-only interactions (everything works on tap)
- [ ] Inputs are `text-base` (16px) to prevent iOS zoom
- [ ] Bottom nav stays visible and active tab is highlighted
- [ ] Pull-to-refresh works if the page has refreshable data
- [ ] Loading states use muted text, not spinners (match existing pattern)
- [ ] Backdrop blur on overlapping elements (`backdrop-blur-xl`)

---

## Commands

```bash
# Run locally
node server.js                    # Start server on port 3000

# Testing
npm test                          # Run all Playwright e2e tests
npx playwright test --ui          # Open Playwright UI
npx playwright test tests/e2e/auth  # Run specific test file

# Deploy
git push origin main              # Push to production

# Supabase
npx supabase db push              # Push migrations
```

## Git Conventions

- Commit messages: `feat:`, `fix:`, `refactor:`, `test:`, `chore:`
- Service worker changes: always bump `CACHE_NAME` in `sw.js` (e.g., `pc-v13` → `pc-v14`)
- Test after every change: `npm test` should pass 825+ tests with 0 failures

## Absolute Rules

1. **No frameworks.** Vanilla JS, no React, no Vue, no build step.
2. **No emoji** in UI. Use SVG icons or text.
3. **Dark theme only.** Never use white/light backgrounds.
4. **Bump SW cache version** on every deploy that changes JS or HTML.
5. **Mobile-first.** Design for 375px iPhone screen, then scale up.
6. **System fonts.** No external font imports.
7. **No new npm dependencies** without discussion. The frontend has zero npm deps.
8. **Test everything.** 0 failures before pushing.
9. **Keep it simple.** If vanilla JS can do it in 20 lines, don't add a library.
10. **Tailwind classes only.** No inline `style=""` attributes in new code (existing ones are OK to leave).
