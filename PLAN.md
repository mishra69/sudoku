# Sudoku App - Implementation Plan

A no-ads Sudoku PWA built for iPad, with cloud persistence, configurable difficulty, and a points-budget scoring system.

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | Vanilla HTML/CSS/JS (single-page PWA, no framework) |
| Hosting | Cloudflare Pages |
| Backend API | Cloudflare Workers |
| Database | Cloudflare D1 (SQLite at the edge) |
| Auth | Simple name + 4-digit PIN (no OAuth) |
| Puzzle Engine | [sudoku.js](https://github.com/robatron/sudoku.js/) (robatron) |
| Offline | Service worker caches app shell; syncs when online |

---

## Feature List

### 1. Puzzle Engine (using sudoku.js library)
- Use `sudoku.generate(difficulty)` to create puzzles
- Use `sudoku.solve(puzzle)` to get the solution (needed for mistake checking and hints)
- Difficulty mapping to sudoku.js levels:
  - Easy → "easy"
  - Medium → "medium"
  - Hard → "hard"
  - Expert → "very-hard" or "insane"
- No custom generator needed — the library handles generation, uniqueness, and difficulty calibration
- Install: include via CDN (`<script>` tag) or copy the single JS file into the project (no build step needed)

### 2. Game UI (iPad-Optimized)
- Large 9x9 grid, sized for comfortable touch on iPad
- Tap a cell to select it, then tap a number (1-9) from a number pad
- Number pad with large buttons below or beside the grid
- Display elements always visible:
  - Current score (points remaining)
  - Mistake counter (e.g., "Mistakes: 2/5" or "Mistakes: 2")
  - Hints used counter (e.g., "Hints: 1/5" or "Hints: 1")
  - Timer (MM:SS format, always shown for info even when timer pressure is off)
  - Difficulty badge
- Pre-filled cells are visually distinct (darker/bold) and non-editable
- Hint-revealed cells shown in a distinct color (blue)
- Undo button to step back through recent player moves
- No pencil/notes feature (intentionally excluded)

### 3. Pre-Game Configuration Screen
Before starting each game, the player selects:
- **Difficulty:** Easy / Medium / Hard / Expert
- **Mistakes:** Limited (choose 3, 5, or 10) OR Unlimited
- **Hints:** Limited (choose 3, 5, or 10) OR Unlimited
- **Timer Pressure:** On (points drain over time) OR Off (timer shows but no penalty)

Show a summary card with the selected config before confirming "Start Game".

### 4. Scoring System (Points Budget)

The player starts each game with a point budget. Actions cost points. Score cannot go below 0 — the player is never forced to restart.

#### Starting Points

| Difficulty | Starting Points |
|-----------|----------------|
| Easy | 500 |
| Medium | 1,000 |
| Hard | 2,500 |
| Expert | 5,000 |

#### Point Deductions

| Action | Limited Mode (flat cost) | Unlimited Mode (exponential) |
|--------|--------------------------|------------------------------|
| Mistake | 50 pts each | 1st: 50, 2nd: 100, 3rd: 200, 4th: 400... (50 * 2^(n-1)) |
| Hint | 75 pts each | 1st: 75, 2nd: 150, 3rd: 300, 4th: 600... (75 * 2^(n-1)) |
| Timer (when on) | 10 pts per minute | 10 pts per minute |

#### Point Bonuses

| Event | Bonus |
|-------|-------|
| Complete a row | +20 pts |
| Complete a column | +20 pts |
| Complete a 3x3 box | +20 pts |
| Puzzle completion | +100 pts |

#### Score Floor
Score cannot go below 0. If a deduction would bring it below 0, it clamps to 0. The game continues — the player just finishes with a score of 0. They are never forced to abandon a puzzle.

#### Limited Mode: Game Over on Limit Reached
When in limited mistakes mode: if the player reaches their mistake limit, the game ends (they cannot continue). Same for hints — once the limit is reached, the hint button is disabled but the game continues.

### 5. Timer with Idle Detection
- Timer counts up from 00:00
- When timer pressure is ON: deduct 10 points per minute of active play
- **Idle detection:** If no input (tap, scroll, any interaction) for 2 minutes, pause the timer automatically. Show a subtle "Paused" indicator. Resume on any interaction.
- This ensures the player isn't penalized for stepping away
- When timer pressure is OFF: timer still runs and displays for informational purposes, but no points are deducted. Idle detection still pauses the display timer.

### 6. Animations

#### Positive Animations
- **Number placed correctly:** Subtle pop/scale animation on the cell
- **Row completed:** Horizontal glow sweep across the row
- **Column completed:** Vertical glow sweep down the column
- **3x3 box completed:** Box border lights up with a pulse
- **Puzzle completed:** Full-screen confetti burst + score summary card with stats

#### Negative Animations
- **Mistake made:** Cell flashes red + shake animation. Mistake counter bumps up with emphasis.
- **Hint used:** Cell fills with answer in blue + points fly off the score with a "-75" floating text
- **Timer deduction (when pressure is on):** Subtle pulse on the timer every minute when points deduct, with "-10" floating text

### 7. Sound Effects

All sounds should be short, pleasant, and non-intrusive. Include a mute toggle accessible from the game screen.

#### Positive Sounds
- **Number placed correctly:** Soft click/tap
- **Row/column/box completed:** Bright chime (short melody, ~1 second)
- **Puzzle completed:** Victory fanfare (celebratory, ~2-3 seconds)

#### Negative Sounds
- **Mistake made:** Low-pitched buzz or soft "wrong" tone
- **Hint used:** Neutral swoosh/reveal sound

#### Ambient/Info Sounds
- **Timer deduction tick:** Very subtle tick (only when timer pressure is on, every minute)
- **Game start:** Soft "ready" chime
- **Button tap:** Light tap feedback sound

Sound implementation: Use the Web Audio API for generating simple tones programmatically (no external audio files needed). This keeps the PWA lightweight and avoids loading assets.

### 8. Cloud Persistence

#### Database Schema (Cloudflare D1)

```sql
CREATE TABLE players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL,
  difficulty TEXT NOT NULL,
  final_score INTEGER NOT NULL,
  time_seconds INTEGER NOT NULL,
  mistakes INTEGER NOT NULL,
  hints_used INTEGER NOT NULL,
  config_mistakes_mode TEXT NOT NULL,  -- 'limited:5' or 'unlimited'
  config_hints_mode TEXT NOT NULL,     -- 'limited:5' or 'unlimited'
  config_timer_pressure INTEGER NOT NULL, -- 0 or 1
  completed INTEGER NOT NULL DEFAULT 0,  -- 1 if puzzle was finished
  completed_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (player_id) REFERENCES players(id)
);

CREATE TABLE saved_games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  player_id INTEGER NOT NULL,
  puzzle_initial TEXT NOT NULL,       -- JSON: the starting puzzle grid
  puzzle_solution TEXT NOT NULL,      -- JSON: the complete solution
  puzzle_current TEXT NOT NULL,       -- JSON: current state of the grid
  move_history TEXT NOT NULL,         -- JSON: array of moves for undo
  config TEXT NOT NULL,               -- JSON: difficulty, mistakes mode, hints mode, timer setting
  score_remaining INTEGER NOT NULL,
  mistakes_count INTEGER NOT NULL,
  hints_count INTEGER NOT NULL,
  elapsed_seconds INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  updated_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (player_id) REFERENCES players(id)
);
```

#### API Endpoints (Cloudflare Workers)

```
POST   /api/auth/register     - Create player (name + PIN)
POST   /api/auth/login         - Login (name + PIN), returns player_id token
GET    /api/scores              - Get scoreboard (filterable by difficulty)
POST   /api/scores              - Save a completed game score
GET    /api/game/saved          - Load saved game (if any)
POST   /api/game/save           - Save current game state
DELETE /api/game/saved          - Delete saved game (on completion or abandon)
```

Auth: Hash the PIN with a simple hash (SHA-256 with a salt). Return a signed token (JWT or simple HMAC token) for subsequent requests. This is a family app — keep auth simple.

### 9. Auto-Save Strategy
- Auto-save the current game state to the cloud every **5 minutes** during active play (not while idle/paused)
- Also save on these events:
  - Tab/app losing focus (visibilitychange event)
  - Before page close (beforeunload event)
  - When idle detection pauses the game
- On app open: check for a saved game and offer "Resume Game?" or "New Game"
- Only one saved game per player at a time

### 10. PWA Setup
- `manifest.json` with app name "Sudoku", appropriate icons, `display: standalone`
- Service worker:
  - Cache the app shell (HTML, CSS, JS) for offline use
  - Queue API calls (score saves, game saves) when offline, sync when back online
- "Add to Home Screen" prompt/instructions for iPad Safari
- Full-screen experience when launched from home screen (no Safari chrome)

### 11. Screens / Navigation

1. **Login/Register Screen** — Name + PIN input, "Play" button
2. **Main Menu** — New Game, Resume Game (if saved), Scoreboard, Settings
3. **Game Config Screen** — Difficulty, mistakes, hints, timer options, "Start" button
4. **Game Screen** — The Sudoku grid, number pad, score, counters, timer, undo, hint button, mute toggle, pause/menu button
5. **Game Over / Victory Screen** — Score summary, stats, "New Game" / "Main Menu" buttons
6. **Scoreboard Screen** — Table of past games, sortable by date/score/difficulty
7. **Settings Screen** — Theme (light/dark), sound on/off, font size (small/medium/large)

### 12. Visual Design
- Clean, minimal design — no clutter
- Light and dark theme support
- Large, readable font — configurable size for accessibility
- High contrast between pre-filled and player-entered numbers
- iPad landscape and portrait support (responsive grid sizing)
- Color palette: calming blues and whites (light theme), dark grays and soft blues (dark theme)

---

## Implementation Phases

### Phase 1: Puzzle Engine (using sudoku.js)
- Include sudoku.js library (CDN or vendored file)
- Write a thin wrapper (`puzzle.js`) that calls `sudoku.generate()` and `sudoku.solve()`
- Map app difficulty levels to library difficulty strings
- Convert library's string format ("1..5..9..") to 2D array for the game grid
- Test: generate a puzzle at each difficulty, solve it, verify solution is valid

### Phase 2: Game UI
- HTML structure: grid, number pad, display elements
- CSS: iPad-optimized layout, responsive, large touch targets
- Cell selection and number input interaction
- Visual distinction for pre-filled vs player cells vs hint cells
- Light and dark themes

### Phase 3: Game Logic
- Mistake detection (compare input to solution)
- Hint system (reveal a random unsolved cell from the solution)
- Scoring engine (budget, deductions, bonuses, floor at 0)
- Configurable limits (limited vs unlimited modes)
- Undo (move history stack)
- Row/column/box completion detection
- Game over conditions (limited mistakes reached, or puzzle complete)

### Phase 4: Timer
- Count-up timer display
- Timer pressure mode (point deductions per minute)
- Idle detection: track last interaction timestamp, pause after 2 minutes of inactivity
- Resume on any interaction
- Pause indicator UI

### Phase 5: Animations & Sound
- CSS animations for all events listed in sections 6 and 7
- Web Audio API sound synthesis for all sound effects
- Mute toggle (persisted in settings)
- Confetti library or custom canvas animation for puzzle completion

### Phase 6: Cloud Backend
- Set up Cloudflare D1 database with schema
- Implement Workers API endpoints
- Player registration and login
- Score CRUD
- Game save/load/delete

### Phase 7: Persistence & Auto-Save
- Wire up frontend to API
- Auto-save logic (5-min interval + visibility/beforeunload events)
- Resume game flow on app open
- Offline queue with sync

### Phase 8: PWA & Polish
- manifest.json and service worker
- Offline caching strategy
- "Add to Home Screen" UX
- Scoreboard UI with sorting/filtering
- Settings screen (theme, sound, font size)
- Final iPad testing and layout tweaks

---

## File Structure

```
sudoku-app/
├── PLAN.md
├── frontend/
│   ├── index.html
│   ├── css/
│   │   └── styles.css
│   ├── js/
│   │   ├── app.js              -- Entry point, screen navigation
│   │   ├── puzzle.js           -- Generator, solver, difficulty
│   │   ├── game.js             -- Game logic, scoring, state
│   │   ├── timer.js            -- Timer, idle detection
│   │   ├── ui.js               -- DOM manipulation, grid rendering
│   │   ├── animations.js       -- CSS animation triggers
│   │   ├── sound.js            -- Web Audio API sound effects
│   │   ├── api.js              -- API client (auth, scores, saves)
│   │   ├── storage.js          -- LocalStorage fallback + offline queue
│   │   └── config.js           -- Constants (scores, thresholds, etc.)
│   ├── manifest.json
│   └── sw.js                   -- Service worker
├── worker/
│   ├── index.js                -- Cloudflare Worker entry point
│   ├── routes/
│   │   ├── auth.js
│   │   ├── scores.js
│   │   └── games.js
│   └── wrangler.toml           -- Cloudflare config
└── schema.sql                  -- D1 database schema
```

---

## Key Design Decisions

1. **No framework** — Vanilla JS keeps the app fast, small, and simple. No build step needed.
2. **Points budget, not points earned** — Start with points and spend them. More intuitive. Score floor at 0 means she's never punished into negative territory.
3. **Never forced to restart** — The old app's biggest frustration. In unlimited mode, she always finishes. In limited mode, reaching the mistake limit ends the game, but she chose that limit herself.
4. **Idle detection pauses timer** — Fair play. Stepping away shouldn't cost points.
5. **Web Audio API for sounds** — No audio file downloads. Keeps PWA lightweight.
6. **Cloudflare D1 for persistence** — Free tier is generous. Scoreboard persists across devices. Simple PIN auth is enough for a family app.
7. **Auto-save every 5 min + on blur/close** — Balances write frequency with data safety.
