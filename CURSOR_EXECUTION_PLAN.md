# Promptlog — Cursor execution plan

You are building Promptlog, a Cursor-native session replay tool for the Cursor Hack London 2026 hackathon. **Track: Review + QA.**

Read [`SPEC.md`](SPEC.md), [`CLAUDE.md`](CLAUDE.md), and [`FILE_TREE.md`](FILE_TREE.md) before writing any code. If any of those files are not present in the repo, ask the user to add them before continuing.

Do not write any code until you have confirmed your understanding of the build order and constraints. Summarise what you are going to build and wait for approval.

---

## Constraints (enforce throughout)

- Node.js + plain JS only. No TypeScript, no bundler, no framework beyond Express.
- Never call the Claude API per-prompt. One batch call at session end in `on-stop.js` only.
- `viewer.html` must be a single self-contained file with no imports and no build step.
- `db.js` is the only file that knows about SQLite. All other files import from it.
- `on-prompt.js` must return `{ "continue": true }` to stdout immediately and never block Cursor.
- Resolve paths in hook scripts using `new URL('../../promptlog/<module>.js', import.meta.url)` (not bare relative imports). Hooks live under `.cursor/hooks/`; two `..` segments reach the repo root, then `promptlog/...`.
- YAGNI ruthlessly. If a feature is not in [`SPEC.md`](SPEC.md) or this execution plan, do not build it.
- Build in strict order: Phase 0 → 1 → 2 → 3 → 4 → 5. Do not skip ahead.

---

## Phase 0 — Repo hygiene

Do all of this before writing any application code.

1. Set `"type": "module"` in `package.json`.
2. Add `"start": "node promptlog/server.js"` to the `scripts` section of `package.json`.
3. Create `.gitignore` with these entries: `.env`, `node_modules/`, `promptlog.db`, `DECISIONS.md`, `sessions/*.json`
4. Run: `npm install express better-sqlite3 @anthropic-ai/sdk`
5. Confirm installs succeeded before continuing.

---

## Phase 1 — Hooks and database

Build these files in order. Do not move to Phase 2 until the human gate passes.

### File 1: `.cursor/hooks.json`

Register exactly two hooks:

- `beforeSubmitPrompt` → runs `node .cursor/hooks/on-prompt.js`
- `stop` → runs `node .cursor/hooks/on-stop.js`

Use the exact format from [`SPEC.md`](SPEC.md).

### File 2: `promptlog/db.js`

Export **exactly** these 5 functions and nothing else:

- `ensureSchema()` — creates `sessions` and `prompts` tables if they do not exist. **Sessions:** `id` (TEXT PRIMARY KEY), `started_at` (INTEGER NOT NULL), `ended_at` (INTEGER), `repo` (TEXT), `prompt_count` (INTEGER DEFAULT 0). **Prompts:** `id` (INTEGER PRIMARY KEY AUTOINCREMENT), `session_id` (TEXT), `seq` (INTEGER), `text` (TEXT), `timestamp` (INTEGER), `type` (TEXT), `influence` (INTEGER), `drift` (INTEGER), `spec_coverage` (INTEGER), `decision` (TEXT). Match foreign keys / semantics in [`SPEC.md`](SPEC.md).
- `insertPrompt(sessionId, seq, text, ts)` — inserts unscored prompt row. Also upserts the session row (insert if not exists, increment `prompt_count`).
- `getSessionPrompts(sessionId)` — returns all prompts for session ordered by `seq` ascending (include row `id` so `on-stop.js` can call `updatePromptScores`).
- `updatePromptScores(id, scores)` — updates `type`, `influence`, `drift`, `spec_coverage`, `decision` for the **prompt row** whose primary key is `id` (integer). `scores` is a single object `{ type, influence, drift, spec_coverage, decision }`. After scoring completes, `sessions.ended_at` (and any final `prompt_count` consistency) must be updated **inside `db.js`** without adding new exports (e.g. last update or internal helper).
- `getAllSessions()` — returns all sessions ordered by `started_at` descending.

If `better-sqlite3` fails to import, fall back to flat JSON files in a `sessions/` folder. This fallback logic lives only in `db.js`. All other files must work identically whether SQLite or JSON is used.

Call `ensureSchema()` at module load time.

### File 3: `.cursor/hooks/on-prompt.js`

This file receives a JSON payload on stdin from Cursor when the user submits a prompt. It must:

1. Read stdin and parse JSON. The payload contains: `conversation_id`, `prompt_text`, `timestamp`, `hook_event_name`, `workspace_roots`.
2. Call `insertPrompt` with `sessionId = conversation_id`, `seq = (existing prompt count + 1)`, `text = prompt_text`, `ts = timestamp`.
3. Write `{"continue":true}` to stdout immediately after persisting.
4. Never throw an unhandled error — wrap everything in try/catch and always write the continue response on failure paths.
5. Import `db.js` using: `new URL('../../promptlog/db.js', import.meta.url)`

### Human gate — do not continue until this passes

After creating these three files, tell the user:

> Phase 1 complete. Please do the following before I continue:
> 1. In Cursor agent mode, type any prompt (e.g. "say hello").
> 2. Then run this in the terminal:  
>    `node -e "import('./promptlog/db.js').then(m => console.log(m.getAllSessions()))"`
> 3. Confirm a session row appears in the output.  
> Tell me when it works, or paste any error output and I will fix it.

Wait for the user's confirmation. Fix any issues before moving to Phase 2.

---

## Phase 2 — Scorer

Build this file only after Phase 1 gate has passed.

### File: `promptlog/scorer.js`

Export a single function: `score(prompts, sessionIntent)`

- `prompts` is an array of `{ seq, text }` objects.
- `sessionIntent` is the text of the first prompt.
- Makes one call to the Claude API using `claude-sonnet-4-6` with `max_tokens` 2000.
- Uses this exact system prompt (copy verbatim):

```
You are a session analyst for AI-assisted coding sessions. You receive an ordered list of prompts from a developer's Cursor session and return structured scoring for each one.

For each prompt, score:

- type: one of [directive, refinement, pivot, reversal, scope_creep, detail]
  - directive: sets a new goal or intent
  - refinement: narrows or clarifies an existing goal
  - pivot: changes direction mid-session (often starts with "actually", "wait", "hmm", "can we")
  - reversal: undoes a previous direction ("nevermind", "ignore that", "forget the")
  - scope_creep: adds a new subsystem not present in the original intent
  - detail: small implementation detail, low architectural impact

- influence: 0-100. How much did this prompt shift what was ultimately built?
- drift: 0-100 cumulative. Distance from the first prompt's intent. Always >= previous prompt's drift unless a reversal corrects it. First prompt is always 0.
- spec_coverage: 0-100 cumulative. How much of the final product's intent is now captured across all prompts so far. Generally increases over time.
- decision: one sentence. What architectural or product decision did this prompt lock in? Write "None" if it locked in nothing.

Return ONLY a valid JSON array. No markdown, no explanation, no preamble.
Format: [{"seq":1,"type":"...","influence":0,"drift":0,"spec_coverage":0,"decision":"..."}]
```

- The user message is: `JSON.stringify({ session_intent: sessionIntent, prompts })`
- Parse the response text as JSON. If parsing fails, return a mock scored array where every prompt gets: `type` `"detail"`, `influence` 50, `drift` 20, `spec_coverage` 30, `decision` `"Mock score — API unavailable."`
- If the API call throws, also return the mock array. Never throw from this function.

Import via normal relative path from `promptlog/scorer.js` (this file is not under `.cursor/hooks/`).

### Human gate

Tell the user:

> Phase 2 complete. Please run this in the terminal to verify:  
> `node -e "import('./promptlog/scorer.js').then(m => m.score([{seq:1,text:'build a dashboard'},{seq:2,text:'actually make it a graph'}], 'build a dashboard').then(console.log))"`  
> Confirm a scored JSON array comes back. Tell me when it works or paste any errors.

Wait for confirmation before continuing.

---

## Phase 3 — Stop pipeline

Build this file only after Phase 2 gate has passed.

### File: `.cursor/hooks/on-stop.js`

This file runs when a Cursor agent session ends. It must:

1. Read stdin and parse JSON. The payload contains: `conversation_id`, `hook_event_name`, `workspace_roots`.
2. Call `getSessionPrompts(conversation_id)` to fetch all prompts for this session.
3. If there are no prompts, write `{"continue":true}` to stdout and exit.
4. Filter for prompts where `type` is null (unscored). If all are already scored, skip the API call.
5. Call `scorer.score()` with the unscored prompts (as `{ seq, text }`) and the text of `seq=1` as `sessionIntent`.
6. For each returned scored item, match by `seq` to the DB row and call `updatePromptScores(promptRowId, { type, influence, drift, spec_coverage, decision })`.
7. Write `DECISIONS.md` to **`workspace_roots[0]`** (not `process.cwd()` if they differ). Format:

```markdown
# Decisions — <conversation_id> · <date>

**Session intent:** <text of first prompt>
**Prompts:** <total count> · **Peak drift:** <max drift>% · **Spec coverage:** <final spec_coverage>%

## Decisions

### P<seq> · <type> · <influence>% influence
> "<prompt text>"

<decision text>

---
```

Only include prompts where `influence >= 40`. Order by `seq` ascending. If no prompts meet the threshold, write a single line: `No high-influence decisions recorded in this session.`

8. Write `{"continue":true}` to stdout.
9. Log to stderr: `Promptlog: session scored. Run npm start to view replay.`
10. Resolve paths using `import.meta.url` (`db.js` and `scorer.js` via `new URL('../../promptlog/...', import.meta.url)`). Never throw unhandled errors.

**Note:** `on-stop.js` does **not** auto-start the server or open a browser; the human runs `npm start` per step 9 message.

### Human gate

Tell the user:

> Phase 3 complete. Please do the following:
> 1. End your current Cursor agent session (close the agent panel or start a fresh one).
> 2. Check **under `workspace_roots[0]`** (your project root) for `DECISIONS.md` — it should contain your session's decisions.
> 3. Run: `node -e "import('./promptlog/db.js').then(m => console.log(m.getAllSessions()))"` and/or inspect `promptlog.db` to confirm scored rows.  
> Tell me when `DECISIONS.md` appears and looks correct, or paste any errors.

Wait for confirmation before continuing.

---

## Phase 4 — Server and viewer

Build these files only after Phase 3 gate has passed.

### File: `promptlog/server.js`

Express server with exactly 3 routes:

- `GET /` — serves `viewer.html` from the repo root using `res.sendFile`
- `GET /api/sessions` — returns JSON array from `getAllSessions()`
- `GET /api/session/:id` — returns JSON object `{ session, prompts }` where `session` is the matching session row and `prompts` is `getSessionPrompts(id)`

Listen on `process.env.PROMPTLOG_PORT` or `3000`. Log `Promptlog running at http://localhost:<port>` on start.

Import `db.js` with a normal relative path from `promptlog/server.js`.

### File: `viewer.html`

Single self-contained HTML file in the repo root. No external imports. No build step. Inline all CSS and JS.

The file must:

1. On load, fetch `GET /api/sessions`. If the fetch fails for any reason, load `SEED_SESSION` (hardcoded fallback below) and render that instead.
2. Populate a session picker dropdown from the sessions list. Auto-select the most recent session.
3. On session select, fetch `GET /api/session/:id` and render the scrubber.
4. Render a horizontal scrubber timeline with:
   - A coloured pip for each prompt positioned at equal intervals. Pip colour by type: `directive=#7F77DD`, `refinement=#1D9E75`, `pivot=#D85A30`, `reversal=#D85A30`, `scope_creep=#BA7517`, `detail=#888780`
   - A draggable playhead that can be dragged to any pip
   - A fill bar showing progress to the current position
5. Below the scrubber, render a prompt card showing: prompt text, type badge, timestamp, influence bar (0–100, coloured by value: >=80 purple, >=50 teal, >=30 amber, else grey), and influence percentage.
6. Beside the prompt card, render a state card showing: direction (type of current prompt), vibe drift (drift value + % + coloured red if >=60, amber if >=40, green otherwise), scope (narrow/expanding/broad based on type), spec coverage (`spec_coverage` value + %), pivot risk (high if drift>=60, medium if drift>=40, low otherwise).
7. Below both cards, render a decision feed: all decisions from prompts seq 1 through current, each as a coloured dot + decision text. Grey out decisions not yet reached.
8. Below the feed, render three buttons that call `sendPrompt()` if available, or copy text to clipboard if not:
   - "most influential prompt ↗" → `sendPrompt("what was the most influential prompt in this session and why?")`
   - "generate DECISIONS.md ↗" → `sendPrompt("generate a DECISIONS.md from this session replay")`
   - "find drift point ↗" → `sendPrompt("where did this session start to drift from the original spec?")`

Embed this seed data constant at the top of the script block for fallback use:

```js
const SEED_SESSION = {
  session: { id: "demo-session-a3f9", started_at: Date.now() - 2200000, ended_at: Date.now() - 100000, repo: "/projects/my-app", prompt_count: 8 },
  prompts: [
    { id:1, session_id:"demo-session-a3f9", seq:1, text:'"build me a dashboard for tracking cursor agent sessions"', timestamp: Date.now()-2200000, type:"directive", influence:91, drift:0, spec_coverage:18, decision:"Dashboard for agent sessions established as the top-level product goal." },
    { id:2, session_id:"demo-session-a3f9", seq:2, text:'"make it show the files that were changed"', timestamp: Date.now()-1900000, type:"refinement", influence:44, drift:15, spec_coverage:31, decision:"File diff view added as a core feature." },
    { id:3, session_id:"demo-session-a3f9", seq:3, text:'"actually can you add a graph like the one we saw earlier"', timestamp: Date.now()-1600000, type:"pivot", influence:78, drift:41, spec_coverage:29, decision:"Graph-based view replaces tabular layout; dashboard framing partially abandoned." },
    { id:4, session_id:"demo-session-a3f9", seq:4, text:'"make the nodes draggable"', timestamp: Date.now()-1400000, type:"detail", influence:29, drift:44, spec_coverage:33, decision:"None." },
    { id:5, session_id:"demo-session-a3f9", seq:5, text:'"add colour coding for different decision types"', timestamp: Date.now()-1100000, type:"refinement", influence:52, drift:47, spec_coverage:40, decision:"Type-based colour system introduced." },
    { id:6, session_id:"demo-session-a3f9", seq:6, text:'"hmm can we also track which cursorrules triggered each one"', timestamp: Date.now()-800000, type:"scope_creep", influence:83, drift:68, spec_coverage:38, decision:"Rules-tracing subsystem scoped in — new feature not in original intent." },
    { id:7, session_id:"demo-session-a3f9", seq:7, text:'"nevermind the rules thing, just show the prompt that caused each decision"', timestamp: Date.now()-500000, type:"reversal", influence:95, drift:55, spec_coverage:52, decision:"Rules-tracing killed. Prompt-to-decision linking introduced as the core concept." },
    { id:8, session_id:"demo-session-a3f9", seq:8, text:'"add a scrubber so we can replay the session from any point"', timestamp: Date.now()-200000, type:"directive", influence:71, drift:52, spec_coverage:74, decision:"Scrubber/replay metaphor established as the primary UX. Product identity crystallised." }
  ]
};
```

### Human gate

Tell the user:

> Phase 4 complete. Please:
> 1. Run: `npm start`
> 2. Open `http://localhost:3000` in your browser
> 3. Confirm the scrubber renders and you can drag through the prompts
> 4. Confirm the session picker shows your real sessions
> 5. If you only have one session, run another quick Cursor conversation (2–3 prompts) to get a second session for the demo  
> Tell me when it works or paste any errors.

Wait for confirmation before continuing.

---

## Phase 5 — Hardening and submission prep

Do this only after Phase 4 gate has passed.

1. Test the mock fallback: temporarily set `ANTHROPIC_API_KEY=invalid` in the environment, run a session end, confirm `DECISIONS.md` still writes with mock scores, then restore the real key.
2. Test the JSON fallback: rename `node_modules/better-sqlite3` temporarily, confirm the app still starts and sessions load from JSON files, then restore it.
3. Verify [`SPEC.md`](SPEC.md) track alignment says **Main road: Review + QA** (update if it does not).
4. Create `SUBMISSION.md` in the repo root with this content:

```markdown
# Promptlog

**Track:** Review + QA
**Side quests:** Best Cursor-native Workflow · Best Developer Tool

Promptlog is the quality gate vibe coding never had.

It captures every prompt from a Cursor session via Cursor Hooks v1.7, scores each one for influence, drift, and spec coverage using Claude, then replays the full session as an interactive scrubber. DECISIONS.md is written to the repo automatically at session end so you always know how you got there.

Built entirely on Cursor Hooks — two JS files and a hooks.json. No proxy, no extension manifest, no external scraping.
```

5. Tell the user: "Phase 5 complete. Final steps for you: `git add . && git commit -m 'feat: promptlog MVP' && git push`. Then submit on the bounty board with track = Review + QA. Good luck."

---

## Demo script (2 minutes)

If the user asks how to demo this, give them this script:

1. "Every vibe coding session produces working code and zero documentation of how you got there. Git records what changed — not why, not which prompt was the pivot."
2. Open `DECISIONS.md` in the repo. Show it was written automatically.
3. Open `localhost:3000`. Show the scrubber with a real session.
4. Drag to the highest-influence prompt. Show it was a reversal that killed a subsystem and defined the final product.
5. Show drift spiking at the scope creep prompt, then recovering after the reversal.
6. "This is built entirely on a Cursor Hook — two JS files and a hooks.json. Entirely Cursor-native."

---

## If something breaks

- Hook not firing: check `.cursor/hooks.json` is valid JSON, restart Cursor, check the Hooks output channel in Cursor's Output panel.
- `better-sqlite3` install fails: `db.js` falls back to JSON files in `sessions/` automatically.
- Claude API returns invalid JSON: `scorer.js` returns mock scores automatically.
- Server port taken: set `PROMPTLOG_PORT=3001` in `.env`.
- `viewer.html` fetch fails: it falls back to `SEED_SESSION` automatically.
