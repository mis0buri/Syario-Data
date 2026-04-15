# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**シャリオ** — A Japanese mahjong (麻雀) club web app for tracking game records, standings, schedules, and various club features.

- **Tech Stack**: Vanilla HTML/CSS/JS, Firebase Auth (compat SDK v10.12.2), Firestore, Chart.js, flatpickr
- **Deployment**: Single HTML page (index.html) loaded with separate CSS/JS modules
- **Data Source**: Two sources merged:
  1. **data.json** (static file) — core historical game records, members, gathers
  2. **Firestore** (Firebase) — real-time reservations, schedule, admin data

## Architecture

### Module Organization

The application is split into functional modules loaded sequentially in index.html:

| File | Purpose | Key Exports |
|------|---------|-------------|
| **app.js** | Core init, Firebase auth, DATA loading, routing, shared utilities | `DATA`, `_db`, `_isAdmin`, `_currentUser`, `showSection()`, date utilities |
| **admin.js** | Admin-only features (members, gathers, schedules, scoring) | Admin UI render functions, Firestore write operations |
| **stats.js** | Ranking tables, member stats, graphs | Render functions for stats displays |
| **schedule-ui.js** | Schedule display and filtering | Render functions for schedule cards |
| **renban.js** | 連番募集 (rotation/series recruitment) | Event management |
| **boshu.js** | 募集 (general recruitment/reservations) | Reservation UI |
| **gallery.js** | じゃれ本 (game story gallery) | Story rendering and modal |
| **stamp.js** | Stamp card system | Stamp UI |
| **board.js** | 掲示板 (bulletin board) | Comments and posting |
| **schedule.js** | Schedule data helpers (small helper module) | Schedule state management |
| **style.css** | All styling (60KB+) | CSS variables (--accent, --text, --surface, --border, etc.) |

### Data Flow

1. **Initialization** (app.js):
   - Load data.json → populate `DATA` object
   - Initialize Firebase → set `_db`, authenticate, load `_isAdmin` flag
   - Render top page or hash-routed section

2. **Sections** (hash-based routing):
   - User clicks nav button → `showSection('sectionName')` called
   - DOM element `#sec-{sectionName}` displayed
   - Corresponding JS module renders its UI via Firestore reads where needed

3. **Admin Operations** (admin.js):
   - Admin can CRUD: members, gathers (game records), schedules
   - Writes to Firestore collections: `admin_gathers`, `admin_config`, `admin_schedule`
   - Non-admin reads fallback to data.json via `DATA` object

### Global State Variables

Set in app.js around line 490+:

```javascript
let DATA = null;              // Loaded from data.json
let _db = null;              // Firestore instance
let _currentUser = null;     // Firebase Auth user
let _isAdmin = false;        // Admin flag from Firestore /admins/{uid}
let _auth = null;            // Firebase Auth instance
let currentSection = 'top';  // Current page
let filterStart, filterEnd;  // Date range filters (shared across modules)
```

**Important**: Modules reference these directly. Changing initialization order or removing declarations will break dependent modules.

### Firestore Collections

(See firestore.rules for access rules)

| Collection | Purpose | Read By | Write By |
|-----------|---------|---------|----------|
| `admin_config` | Member list, schedule data | App JS | Admin |
| `admin_gathers` | Game records | Admin section | Admin |
| `admin_schedule` | Scheduled events | Schedule display | Admin |
| `reservations` | User event RSVPs | boshu, schedule | Users + Admin |
| `board_comments` | Bulletin board posts | board.js | Anyone |
| `renban_events` | Series/rotation events | renban.js | Anyone |
| `jare_stories` | Gallery stories | gallery.js | Admin |
| `users` | User preferences/data | Any user | Own UID |
| `stamp_cards` | Stamp card state | stamp.js | Own UID |
| `admins`, `managers` | Access control | Auth check | (Server only) |

## Mobile Layout Notes

The app includes mobile optimizations, particularly for iOS Safari:

- **CSS Box-sizing**: date/time inputs use `-webkit-appearance: none` + `box-sizing: border-box` to prevent native styling from breaking layout (iOS Safari bug)
- **Font-size Prevention**: iOS Safari auto-zoom when input font-size < 16px; mobile breakpoint (@media ≤640px) sets font-size: 16px
- **Input Height**: `min-height` explicitly set to prevent date inputs from collapsing when empty
- **Flex Constraints**: `min-width: 0` used throughout flex containers to prevent overflow
- **Viewport**: Correct meta tag set for responsive design

See style.css lines 805-915 for mobile-specific rules.

## Common Modification Patterns

### Adding a New Admin Section

1. Add HTML section to index.html with id `sec-admin-{name}`
2. Add button to `#subnav-admin`
3. Create `initAdmin{Name}()` and `_renderAdmin{Name}()` in admin.js
4. Add CSS classes `.admin-input`, `.admin-form-group`, `.admin-btn` for consistent styling
5. For Firestore writes, reference collection via `_db.collection('{collectionName}')`
6. Check `_isAdmin` before exposing UI

### Updating Data Display

1. Check if data comes from `DATA` (static) or Firestore (dynamic):
   - Static: Use data.json → loaded into `DATA` object in app.js
   - Dynamic: Firestore collection → requires Firestore read in module
2. Render function typically: fetch → validate → `document.getElementById('{id}').innerHTML = render(...)`
3. Apply date filters: most modules check `filterStart` and `filterEnd` globals

### Styling New Elements

- Use CSS variables: `var(--accent)`, `var(--text)`, `var(--surface)`, `var(--border)`, `var(--dim)`, `var(--red)`, `var(--green)`
- Mobile breakpoints: `@media (max-width: 640px)` and `@media (max-width: 480px)`
- Flexbox base layout; grid for multi-column sections
- Avoid fixed widths; use flex/grid with max-width constraints

## Testing

There is no automated test setup. Changes should be tested by:
1. Opening index.html in a browser (serve locally, e.g., `python -m http.server`)
2. Testing on mobile (iOS Safari preferred due to historical layout bugs)
3. Verifying admin features require login with admin role in Firestore /admins/{uid}
4. Checking date/time pickers work across browsers (Chrome, Safari, Firefox)

## Key Implementation Details

### Date/Time Input Handling

- Inputs use native HTML5 types: `<input type="date">`, `<input type="time">`
- flatpickr library is loaded but NOT used on admin inputs (kept native for simplicity)
- Mobile: font-size 16px, -webkit-appearance none, explicit min-height prevent iOS bugs

### Escape Function

- Defined in app.js as `_esc()` for HTML escaping; use when rendering user-provided data
- Prevents XSS in strings like member names, comments

### Shared UI Components

- `.card` — Main content container with padding, border, rounded corners
- `.admin-{input, select, btn, form-group}` — Admin section form styling
- `.rank-badge` — Colored badges for 1st/2nd/3rd place
- `.empty` — Placeholder text for empty states

## Debugging Tips

- Check browser console for Firebase errors (auth, network)
- Open DevTools → Network tab to verify data.json loads
- Firestore writes fail silently if `_isAdmin` is false; check firestore.rules
- iOS Safari viewport/zoom issues: check that viewport meta tag is correct and font-size ≥ 16px on inputs
