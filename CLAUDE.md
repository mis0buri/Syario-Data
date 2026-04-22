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

## Seasonal Theme System

背景と配色が日付に応じて自動で切り替わる。`body[data-season="X"]` 属性で制御。

### 季節と期間

| 値 | 季節 | 期間 |
|----|------|------|
| `sakura` | 桜 | 3/15〜4/15 |
| `midori` | 新緑 | 4/16〜6/14 |
| `tsuyu` | 梅雨 | 6/15〜7/19 |
| `natsu` | 夏 | 7/20〜9/14 |
| `koyo` | 紅葉 | 9/15〜11/29 |
| `fuyu` | 冬 | 11/30〜3/14 |
| (default) | 通常 | — |

### 主要関数 (app.js)

- `setSeasonTheme()` — 今日の日付から季節を決定し `body.dataset.season` をセット、`_updateDecoParticles()` を呼ぶ
- `_updateDecoParticles(season)` — `.deco-leaf` 要素のSVG `innerHTML` を季節の粒子形状に差し替える
  - sakura: 楕円（花びら）/ tsuyu: 雨粒（rect）/ natsu: 星形 / koyo: もみじ / fuyu: 雪の結晶
- `setSeasonOverride(season)` — 管理者マイページからのプレビュー用、強制的に季節を変更

### 背景デコレーション (index.html + style.css)

`.sakura-deco` div（`#sec-top` 内、`z-index: -1`）に以下の子要素が含まれる：

| クラス | 内容 | 表示季節 |
|--------|------|----------|
| `.sakura-tree.s-left/right` | 桜の木（左右対称） | デフォルト・midori・koyo |
| `.fuyu-tree.f-left/right` | 冬枯れ木（雪付き） | fuyu |
| `.natsu-deco.n-left/right` | ヒマワリ群 | natsu |
| `.tsuyu-deco.t-left/right` | アジサイ群 | tsuyu |
| `.nature-birds` | 鳥（全幅SVG、上部） | 常時 |
| `.nature-grass` | 草むら（中央下部） | 常時 |
| `.nature-shrub` | 中央低木 | sakura・midori・koyo |
| `.deco-leaf` ×10 | 落下パーティクル | natsu以外（natsuは非表示） |
| `.firework` ×6 | 花火アニメーション | natsuのみ |

**SVG fillの色変更**: CSS `body[data-season="X"] .class circle { fill: #xxx !important; }` で制御。`!important` は SVG presentation attribute を上書きするために必須。

### アニメーション

- `@keyframes leaf-fall` — 左右スウェイしながら落下（tsuyu以外の粒子）
- `@keyframes rain-fall` — 真っ直ぐ高速落下（tsuyu用、1.4s固定）
- `@keyframes fw-rocket` — 花火の打ち上げ（下→上へ translateY）
- `@keyframes fw-explode` — 花火の爆発（`box-shadow` で8方向＋中間方向へ放射）

花火の各要素は CSS カスタムプロパティ `--c`（主色）、`--c2`（副色）、`--delay`、`--d`（周期）、`--h`（打ち上げ高さ、負のvh値）をインラインスタイルで指定。

### 管理者テーマ切り替え

`openMyPage()` → `#mypage-theme-section` に7ボタン表示（管理者のみ）。
各ボタンは `onclick="setSeasonOverride('X')"` を呼び、ページをリロードせずに即時切り替え。

## Member Stats 強化 (stats.js)

### calcStats() の追加フィールド

- `avgScore4`, `avgScore3` — 平均スコア
- `bestScore4`, `bestScore4`, `worstScore3`, `worstScore4` — 最高・最低スコア
- `playTime` — 総プレイ時間（gather の start/end から計算、分単位→時間:分）

### 新関数

- `calcRecentGames(memberName, gathers, n=10)` — 直近N局（チップ除く）を返す。各ゲームは `{date, score, rank, type}` を含む
- `calcH2H(memberName, gathers)` — 3局以上同卓した相手ごとに `{name, games, rate, score}` を返す（rateは連対率、scoreは同卓時の通算スコア差）

### renderMemberDetail() の追加表示

- 4麻/3麻ブロックに「平均」「最高」「最低」行を追加
- 総合ブロックに「プレイ時間」を追加（収支は非表示）
- 「直近N局」セクション: 色付きランクボックスで最近の対局を一覧
- 「同卓成績」セクション: 相手ごとに勝率バーと通算スコアを表示

## Debugging Tips

- Check browser console for Firebase errors (auth, network)
- Open DevTools → Network tab to verify data.json loads
- Firestore writes fail silently if `_isAdmin` is false; check firestore.rules
- iOS Safari viewport/zoom issues: check that viewport meta tag is correct and font-size ≥ 16px on inputs
- 季節テーマが切り替わらない場合: `body.dataset.season` の値をDevToolsで確認、`_updateDecoParticles()` が呼ばれているか確認
