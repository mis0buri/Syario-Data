# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**シャリオ** — A Japanese mahjong (麻雀) club web app for tracking game records, standings, schedules, and various club features.

- **Tech Stack**: Vanilla HTML/CSS/JS, Firebase Auth (compat SDK v10.12.2), Firestore, Chart.js, flatpickr
- **Deployment**: Single HTML page (index.html) with separate CSS/JS modules; no build step
- **Data Source**: Two sources merged at runtime:
  1. **data.json** (static file) — historical game records, members list
  2. **Firestore** (Firebase) — real-time reservations, schedule overrides, admin data

## Development

Serve locally:
```
python -m http.server
```
Open `http://localhost:8000`. No automated tests. Test on iOS Safari for layout bugs; verify admin features with a user that has a doc in Firestore `/admins/{uid}`.

## Architecture

### Standalone Pages

`swarm-app.html` / `swarm-app.css` / `swarm-app.js` — a self-contained Swarm連携 page, fully decoupled from `index.html`'s SPA (no hash routing, no shared globals, no `firebase-auth-compat.js`). It reads the same `admin_config/swarm` Firestore doc (public read) for the shared Foursquare Client ID/proxy, and shares the unauthenticated-link `localStorage` key `swarm_local_account_main` with `swarm.js`'s `main` namespace so an anonymous link made on either page shows up on both. It does **not** sync with Firestore-backed accounts created by users logged into the main site. Edit `swarm.js` for the in-SPA Swarm tab; edit `swarm-app.js` for this standalone page — the two are intentionally independent and not kept in sync automatically.

`archive-upload/index.html` / `xarchive-add.css` / `xarchive-add.js` — a self-contained Xアーカイブ追加 (admin archive upload) page served at the clean URL `/archive-upload/` (the HTML lives in `archive-upload/`, referencing the root-level `xarchive-add.css`/`xarchive-add.js` via `../` paths), fully decoupled from `index.html`'s SPA. Loads only the Firebase app/storage compat SDKs and has **no login** — access control is deferred entirely to `storage.rules` (currently permitting unauthenticated uploads; if that changes, re-add auth to the page). Uploads to the **same** Storage layout as the in-SPA 追加 section (`archives/manifest.json` + `archives/{username}/{YYYY-MM}.json`), so archives added here appear in the SPA's アーカイブ閲覧. `_xaNormalizeTweet`/`xaUpload` are intentional copies of the versions in `xarchive.js` — when changing the parse/upload logic, keep both files in sync manually. The SPA's `#sec-admin-xarchive-add` links to this page.

`swarm/index.html` is a clean-URL mirror of `swarm-app.html` (served at `/swarm/` on GitHub Pages), referencing the same `swarm-app.css`/`swarm-app.js` via `../` paths. Since `connectAccount()` in `swarm-app.js` builds the Foursquare OAuth `redirect_uri` from `location.origin + location.pathname`, **the `/swarm/` path is a distinct redirect URI from `/swarm-app.html`** and must be separately registered in the Foursquare app's OAuth settings, or the "Swarmと連携する" button will fail with a redirect URI mismatch. When editing the Swarm checkin/account logic, keep both `swarm-app.html` and `swarm/index.html` in sync manually (they're plain copies, not templated).

### Script Load Order

Scripts load sequentially at bottom of `<body>` — **order matters**:

1. `schedule.js` — defines `SCHEDULE_DATA` global (must come before app.js)
2. `app.js` — captures `_SCHEDULE_ORIG = Object.assign({}, SCHEDULE_DATA)` at parse time
3. `stats.js`, `schedule-ui.js`, `board.js`, `vote.js`, `column.js`, `gallery.js`, `renban.js`, `boshu.js`, `stamp.js`, `admin.js`, `swarm.js`

### Module Organization

| File | Purpose |
|------|---------|
| **app.js** | Core init, Firebase auth, data loading, hash routing, shared utilities |
| **stats.js** | Rankings, member stats, rating calc, graphs (Chart.js) |
| **admin.js** | Admin CRUD: members, game records, scores, schedule overrides |
| **schedule-ui.js** | Calendar display, day-detail modal, reservation counts |
| **renban.js** | 連番募集 — series recruitment events with participants subcollection |
| **boshu.js** | 募集一覧 — combined view of renban events + reservations |
| **gallery.js** | じゃれ本 — story gallery with Firestore backend |
| **board.js** | 掲示板 — bulletin board comments |
| **vote.js** | 投票箱 — poll/voting boxes with options, answers, deadlines |
| **stamp.js** | Stamp card system |
| **column.js** | コラム — long-form articles with rich-text editor |
| **transit.js** | 乗換案内 — journey search via `api.transit.ls8h.com` (no auth, CORS-enabled). Sub-views inside `#sec-transit` (menu/search/dep/home/settings) with `#transit/{view}` deep links via `showTransitView()`. 最寄り駅 list stored in `/users/{uid}.transitStations` when logged in, else localStorage `transit_my_stations` (auto-migrated on login). API times are seconds from service-date midnight (may exceed 86400) — convert with `_trFmtTime()`. Buses are excluded by default (`avoidModes=bus` on every `plan` call); a persisted checkbox (`#transit-include-bus`, `_trIncludeBus`, localStorage `transit_include_bus`, default off) re-includes them and auto-re-searches if results are shown. Free search fans out extra parallel `plan` calls and merges/dedupes (`_trDedupJourneys`): when buses are included, a rail-bias `avoidModes=bus` call so rail routes still surface; plus (when no via, gated by `TRANSIT_HUB_FANOUT`) major hub stations (`TRANSIT_HUBS`, corridor-filtered by from/to coords via `_trDistKm`) auto-set as `via` (`_trResolveHubs`, hub ids+coords persisted in localStorage `transit_hub_cache`) to catch cross-operator routes the API omits from its top-N. Search is **two-phase/progressive** (`_trSearchToken` guards against stale async updates): phase 1 runs base(+rail-bias) and renders immediately (`_trApplyResults`); phase 2 runs the hub-via calls in the background and re-renders with the merged/deduped results when they arrive, so the user isn't blocked on the extra calls (base has no timeout, extras are capped). A background phase (`_trVerifyThrough`/`_trTryThroughFix`) then re-searches from each transfer station at the arrival time and, if an immediate (≤3min) same-headsign/through-pair continuation to the destination is found that reduces transfers, splices it in as a 直通 leg (fare kept only when it collapses to a single through leg, else nulled). Consecutive same-train legs the API split at operator boundaries are merged by `_trMergeThroughLegs` (tripId / same-platform / same-headsign / `TRANSIT_THROUGH_PAIRS` line-pair, all within a few minutes). Results are sorted rail-first (`_trHasBus`, leg `mode==='bus'`) then by time/fare, and capped at `TRANSIT_MAX_RESULTS`. `numItineraries` has an API cap of 6 (8 → "plan query is invalid"); `avoidModes`/`allowModes` are comma-separated mode filters |
| **swarm.js** | Swarm連携 — Foursquare/Swarm OAuth check-in linking + X share; namespaced (`main`/`admin`) to support two independent Client IDs; usable without login (account stored in `localStorage` key `swarm_local_account_{ns}`, migrated to Firestore on later login) |
| **xarchive.js** | Xアーカイブ閲覧（管理者専用） — admin sections `#sec-admin-xarchive`(閲覧)/`#sec-admin-xarchive-add`(追加), gated by `_isAdmin`. Stores parsed X archives in **Firebase Storage** (`_storage`, compat SDK): `archives/manifest.json` + `archives/{username}/{YYYY-MM}.json` (month chunks). Upload parses `tweets.js` in-browser (`_xaNormalizeTweet`), extracting only text/date/type/media-URL (DMs etc. never read). Viewer merges accounts into one chronological timeline with account/date filters + AND search, incremental render via IntersectionObserver, IndexedDB chunk cache (`xarchive` DB, invalidated by manifest `generated_at`). Media referenced by pbs.twimg.com URL (not stored). Storage access is admin-only via a **UID allowlist in `storage.rules`** (Storage rules can't read `/admins`; admin must add their UID and `firebase deploy --only storage`). The viewer reads chunks via `fetch()` of the download URL, so the bucket **needs a CORS policy** allowing the site origin (`https://mis0buri.github.io`) — without it, uploads succeed but the viewer shows "アーカイブがまだありません" (CORS-blocked fetch). Apply once with `gsutil cors set cors.json gs://syariodate.firebasestorage.app` (config kept in repo-root `cors.json`); bucket-level, no site redeploy needed. Media (`<img>`/`<video>` tags) is CORS-exempt |
| **schedule.js** | Static `SCHEDULE_DATA` object only |

### Global State (app.js)

All modules access these globals directly from app.js scope:

```javascript
let DATA = null;              // Loaded from data.json; Firestore admin_gathers merged in at runtime
let _db = null;              // Firestore instance
let _auth = null;            // Firebase Auth instance
let _currentUser = null;     // Firebase Auth user (null = not logged in)
let _isAdmin = false;        // /admins/{uid} doc exists
let _isManager = false;      // /managers/{uid} doc exists (lighter permissions than admin)
let _registeredName = null;  // Display name from /users/{uid}.displayName
let currentSection = 'top';
let filterStart, filterEnd;  // Date range filters shared across stats modules
let _firestoreSchedule = {}; // Firestore schedule overrides (merged into SCHEDULE_DATA)
const _SCHEDULE_ORIG = ...;  // Snapshot of SCHEDULE_DATA before Firestore overrides
```

### Data Flow

1. `DOMContentLoaded` → `initFirebase()` → sets up auth listener + hash routing + `_loadFirestoreSchedule()`
2. `loadData()` fetches data.json → `DATA` populated → `_mergeFirestoreGathers()` appends `admin_gathers` docs to `DATA.gathers`
3. **Stats are recalculated entirely client-side** via `calcStats()` / `calcRatings()` from raw gathers — the pre-computed fields in data.json `members[]` are not used at runtime
4. `refresh()` is called on every period filter change: recomputes stats → re-renders ranking, member buttons, history

### data.json Structure

```json
{
  "members": [{ "name": "..." }],
  "gathers": [{
    "date": "YYYY-MM-DD", "start": "HH:MM", "end": "HH:MM", "rate": 10,
    "members": ["名前A", "名前B"],
    "matches": [{ "mNo": 0, "isChip": false, "scores": [10, -10], "ranks": [1, 2] }]
  }]
}
```

Firestore `admin_gathers` documents share this same structure and are appended to `DATA.gathers` after load.

### Hash-Based Routing

`showSection(id)` handles all navigation. Mapping in `_HASH_TO_SECTION` / `_SECTION_TO_HASH`. Deep-link patterns: `#renban/{id}`, `#jare/{id}`, `#schedule/{YYYY-MM-DD}`, `#vote/{id}`, `#column/{id}`. Admin sections reflect as `#admin/{name}` (e.g. `admin-swarm` → `#admin/swarm`); on page load `_handleAdminHashRoute()` reopens them after auth resolves (only if `_isAdmin`, otherwise the hash is cleared). For init loads, `_routeHash` defers `#admin/...` handling to that post-auth handler; the `#swarm` deep link is similarly re-initialized after login resolves so account status renders correctly.

### Firestore Collections

| Collection | Write Access |
|-----------|-------------|
| `admin_config` (`/main`, `/schedule`, `/swarm`, `/swarm_admin`) | Admin only |
| `admin_gathers` | Admin only |
| `reservations` | Anyone (own) + Admin |
| `rsv_participants` | Anyone (own) + Admin |
| `board_comments` | Anyone; delete own or Admin |
| `vote_boxes` | Anyone create; update/delete own or Admin |
| `vote_answers` | Anyone create; update/delete own or Admin |
| `renban_events` + subcollection `participants` | Anyone; delete own or Admin |
| `jare_stories` | Admin only |
| `ai_discussions` | Admin only (read: anyone) |
| `admin_secrets` (`/api_keys`) | Admin only (read+write) — Gemini/Groq API keys + per-persona model config |
| `users` | Own UID only |
| `stamp_cards` | Own UID only |
| `swarm_accounts`, `swarm_accounts_admin` | Own UID only — Foursquare OAuth access tokens for the main-tab and admin-only Swarm integrations respectively |
| `admins`, `managers` | Server only (client read-only) |

### Rating System (stats.js `calcRatings`)

MSM方式: initial 1500, rank points `[+30, +10, -10, -30]` for 4-player non-chip matches only. Delta = `matchCorr × (rankPt + (tableAvg - playerRating) / 40)` where `matchCorr` decays linearly from 1.0→0.2 over first 400 matches.

### Schedule System

- `schedule.js` contains the static base `SCHEDULE_DATA` — edit here to set scheduled dates
- Marks: `◎`=終日, `〇`=半日以上(note必須), `△`=短時間(note必須), `×`=休み
- Firestore `admin_config/schedule.dates` stores admin overrides; merged via `Object.assign(SCHEDULE_DATA, overrides)`
- `_SCHEDULE_ORIG` is snapshotted at parse time to support rollback when admin deletes an override

## Seasonal Theme System

`body[data-season="X"]` controls background and colors, applied by `setSeasonTheme()` at load.

| Value | Season | Period |
|-------|--------|--------|
| `sakura` | 桜 | 3/15〜4/15 |
| `midori` | 新緑 | 4/16〜6/14 |
| `tsuyu` | 梅雨 | 6/15〜7/19 |
| `natsu` | 夏 | 7/20〜9/14 |
| `koyo` | 紅葉 | 9/15〜11/29 |
| `fuyu` | 冬 | 11/30〜3/14 |

**Night mode**: `setNightTheme()` auto-applies `body[data-night="true"]` from 20:00–05:00, overriding the seasonal theme. Admin can manually toggle via `setNightOverride()`.

`_updateDecoParticles(season)` injects SVG shapes into `.deco-leaf` elements; shapes are defined in `_SEASON_PARTICLES`. Particle animation uses `@keyframes leaf-fall` (most seasons) or `@keyframes rain-fall` (tsuyu). Fireworks (`@keyframes fw-rocket` / `fw-explode`) appear in natsu only.

SVG fill overrides require `!important` to beat SVG presentation attributes:
```css
body[data-season="X"] .my-class circle { fill: #xxx !important; }
```

Admin theme preview: `setSeasonOverride(season)` in マイページ; theme section is hidden from non-admins.

## Key Implementation Details

### HTML Escaping

Two escape helpers in app.js — use them for all user-provided strings:
- `_esc(s)` — escapes `&`, `<`, `>` — used for most inline rendering
- `_escHtml(str)` — also escapes `"` — use in attribute values
- `escHtml` is an alias for `_esc` used by renban.js and boshu.js

### External Integrations

- **Feedback form** → Discord webhook (`WEBHOOK_URL` hardcoded in app.js)
- **First-time login** → separate Discord webhook (deduplicated via localStorage key `syario_loggedin_{uid}`)
- **Login** (`loginWithGoogle` / `loginWithTwitter`, both via `_doLogin()`) — uses `signInWithPopup` in **all** environments (desktop, PWA, and plain mobile browsers). `signInWithRedirect` was dropped because the site (`github.io`) and Firebase auth handler (`firebaseapp.com`) are different domains, so Safari ITP / Chrome third-party-storage partitioning drops the session on return → "auth succeeds but login state never applies". Popups open fine from the login-button user gesture; `auth/popup-blocked` (mainly in-app browsers like LINE/Instagram) shows a "open in a normal browser" alert. `_auth.getRedirectResult()` in `initFirebase()` is now effectively a no-op kept only to drain any stale pending redirect.
- **X (Twitter) login** (`loginWithTwitter`) — re-enabled 2026-07 after moving to a paid X API tier (previously disabled 2026-06 when X's API tier changes broke Firebase's Twitter OAuth with `auth/invalid-credential`). Firebase's Twitter provider uses OAuth **1.0a** — the "API Key & Secret" (Consumer Keys), not the Bearer Token or OAuth2 client id. If `auth/invalid-credential` returns, check the X API tier/keys and the Firebase Twitter provider callback config (`https://<project>.firebaseapp.com/__/auth/handler`).

### Adding a New Admin Section

1. Add HTML section `#sec-admin-{name}` to index.html
2. Add button to `#subnav-admin`
3. Add section id to `_ADMIN` array in app.js and call `initAdmin{Name}()` from `showSection()`
4. Implement `initAdmin{Name}()` in admin.js, guarded with `if (!_isAdmin) return;`
5. Use `.admin-input`, `.admin-btn`, `.admin-form-group` CSS classes

### Mobile Layout Notes (style.css ~805–915)

- Date/time inputs: `-webkit-appearance: none` + `box-sizing: border-box` (iOS Safari layout bug)
- Font-size ≥ 16px on inputs at `@media (max-width: 640px)` to prevent iOS auto-zoom
- `min-height` on date inputs prevents collapse when empty
- `min-width: 0` on flex children prevents overflow

### Shared UI Components

- `.card` — main content container
- `.admin-{input,select,btn,form-group}` — admin form styling
- `.rank-badge` `.r1`/`.r2`/`.r3` — colored rank badges
- `.empty` — placeholder for empty states
- `.admin-status` `.ok`/`.error` — status message styling

## Debugging

- Firebase auth/Firestore errors appear in browser console
- DevTools Network tab to verify data.json load
- Admin writes silently fail if `_isAdmin` is false — check Firestore rules and `/admins/{uid}` doc
- Seasonal theme not switching: inspect `body.dataset.season` in DevTools; verify `_updateDecoParticles()` called
- iOS Safari zoom/layout: verify viewport meta tag and that input font-size ≥ 16px
