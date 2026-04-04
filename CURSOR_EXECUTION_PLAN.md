# Promptlog — Cursor execution plan

You are building Promptlog, a Cursor-native session replay tool for the Cursor Hack London 2026 hackathon. **Track: Review + QA.**

Read [`SPEC.md`](SPEC.md), [`CLAUDE.md`](CLAUDE.md), and [`FILE_TREE.md`](FILE_TREE.md) before writing any code. If any of those files are not present in the repo, ask the user to add them before continuing.

Do not write any code until you have confirmed your understanding of the build order and constraints. Summarise what you are going to build and wait for approval.

---

## Constraints (enforce throughout)

- Node.js + plain JS only. No TypeScript, no bundler, no framework beyond Express.
- Never call the Gemini API per-prompt. One batch call at session end in `on-stop.js` only.
- `viewer.html` must be a single self-contained file with no imports and no build step.
- `db.js` is the only file that talks to Supabase. All other files import from it.
- `on-prompt.js` must write `{ "continue": true }` to stdout after `insertPrompt` resolves (keep the hook fast; never throw unhandled).
- Resolve paths in hook scripts using `new URL('../../promptlog/<module>.js', import.meta.url)` (not bare relative imports). Hooks live under `.cursor/hooks/`; two `..` segments reach the repo root, then `promptlog/...`.
- YAGNI ruthlessly. If a feature is not in [`SPEC.md`](SPEC.md) or this execution plan, do not build it.
- Build in strict order: Phase 0 → 1 → 2 → 3 → 4 → 5. Do not skip ahead.

---

## Phase 0 — Repo hygiene

Do all of this before writing any application code.

1. Set `"type": "module"` in `package.json`.
2. Add `"start": "node promptlog/server.js"` to the `scripts` section of `package.json`.
3. Create `.gitignore` with these entries: `.env`, `node_modules/`, `DECISIONS.md`
4. Run: `npm install express @supabase/supabase-js @google/generative-ai`
5. Create a Supabase project, run SQL from `supabase/migrations/`, set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in `.env` (see `.env.example`).
6. Confirm installs succeeded before continuing.

---

## Phase 1 — Hooks and database

**Persistence:** Raw prompt rows are written to the store on every `beforeSubmitPrompt` (`on-prompt.js`); they do **not** wait for session end. If `stop` never runs, prompts remain queryable with `type`/scores still `null`.

Build these files in order. Do not move to Phase 2 until the human gate passes.

### File 1: `.cursor/hooks.json`

Register exactly two hooks:

- `beforeSubmitPrompt` → runs `node .cursor/hooks/on-prompt.js`
- `stop` → runs `node .cursor/hooks/on-stop.js`

Use the exact format from [`SPEC.md`](SPEC.md).

### File 2: `promptlog/db.js`

Export **exactly** these 5 functions and nothing else (all DB operations are **async** / Promise-returning):

- `ensureSchema()` — no-op (schema applied via Supabase migrations); kept for compatibility.
- `insertPrompt(sessionId, seq, text, ts)` — upsert `projects` by `PROMPTLOG_REPO`, upsert `sessions` with `project_id`, insert `prompts` row. Log and no-op if Supabase env missing (do not throw to hooks).
- `getSessionPrompts(sessionId)` — returns all prompts ordered by `seq` ascending (include bigint `id` as number for `updatePromptScores`).
- `updatePromptScores(id, scores)` — updates scored columns; if `process.env.PROMPTLOG_PROJECT_INTENT` is set, sync `projects.intent_text` once then clear env; when no prompts remain unscored for the session, set `sessions.ended_at` and `display_title`.
- `getAllSessions()` — sessions ordered by `started_at` descending, each row enriched with `project_intent`, `project_repo_path`, `first_prompt_text` (see [`SPEC.md`](SPEC.md)).

Schema: [`supabase/migrations/`](supabase/migrations/). Env: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

### File 3: `.cursor/hooks/on-prompt.js`

This file receives a JSON payload on stdin from Cursor when the user submits a prompt. It must:

1. Read stdin and parse JSON. The payload contains: `conversation_id`, `prompt_text`, `timestamp`, `hook_event_name`, `workspace_roots`.
2. `await getSessionPrompts(conversation_id)` for length, then `await insertPrompt(...)` with `seq = existing.length + 1`.
3. Write `{"continue":true}` to stdout after persisting (async DB is OK).
4. Never throw an unhandled error — wrap everything in try/catch and always write the continue response on failure paths.
5. Import `db.js` using: `new URL('../../promptlog/db.js', import.meta.url)`

### Human gate — do not continue until this passes

After creating these three files, tell the user:

> Phase 1 complete. Please do the following before I continue:
> 1. In Cursor agent mode, type any prompt (e.g. "say hello").
> 2. Then run this in the terminal:  
>    `node -e "import('./promptlog/db.js').then(m => m.getAllSessions().then(console.log))"`
> 3. Confirm a session row appears in the output.  
> Tell me when it works, or paste any error output and I will fix it.

Wait for the user's confirmation. Fix any issues before moving to Phase 2.

---

## Phase 2 — Scorer

Build this file only after Phase 1 gate has passed.

### File: `promptlog/scorer.js`

Export a single async function: `score(prompts, projectIntent)`

- `prompts` is an array of `{ seq, text }` objects (unscored batch).
- `projectIntent` is the fixed drift anchor string (from [`promptlog/intent-resolve.js`](promptlog/intent-resolve.js) or fallback).
- Before the API call, compute **`influence_hints`** per prompt (keyword flags: actually, wait, nevermind, hmm, can we instead, forget, scrap, ignore that).
- Makes one call to the Gemini API using `gemini-2.5-flash` by default (`GEMINI_MODEL` env override) with `maxOutputTokens` 2000.
- **System prompt and drift/spec rules:** copy verbatim from [`promptlog/scorer.js`](promptlog/scorer.js) `SYSTEM_PROMPT` (kept in sync with [`SCORER_PROMPT.md`](SCORER_PROMPT.md)).
- User message: `JSON.stringify({ project_intent, prompts: [{ seq, text, influence_hints }, ...] })`
- Parse the response text as JSON. If parsing fails, return mock scores (never throw).

Import via normal relative path from `promptlog/scorer.js` (this file is not under `.cursor/hooks/`).

### Human gate

Tell the user:

> Phase 2 complete. Please run this in the terminal to verify:  
> `node -e "import('./promptlog/scorer.js').then(m => m.score([{seq:1,text:'build a dashboard'},{seq:2,text:'actually make it a graph'}], 'build a dashboard for sessions').then(console.log))"`  
> Confirm a scored JSON array comes back. Tell me when it works or paste any errors.

Wait for confirmation before continuing.

---

## Phase 3 — Stop pipeline

Build this file only after Phase 2 gate has passed.

### File: `.cursor/hooks/on-stop.js`

**Scope of `stop`:** This hook only scores existing rows and writes `DECISIONS.md`; it does **not** create prompt log entries. Prompt text is already durable in the DB from `beforeSubmitPrompt`.

This file runs when a Cursor agent session ends. It must:

1. Read stdin and parse JSON. The payload contains: `conversation_id`, `hook_event_name`, `workspace_roots`.
2. `await getSessionPrompts(conversation_id)` to fetch all prompts for this session.
3. If there are no prompts, write `{"continue":true}` to stdout and exit.
4. Filter for prompts where `type` is null (unscored). If all are already scored, skip the API call.
5. Resolve **project intent** with `intent-resolve.js` (`workspace_roots[0]`). If null, use first prompt text. Set `process.env.PROMPTLOG_PROJECT_INTENT` so the first `updatePromptScores` syncs `projects.intent_text`.
6. `await scorer.score(unscoredBatch, projectIntent)` then `await updatePromptScores(promptRowId, { ... })` for each row.
7. Write `DECISIONS.md` to **`workspace_roots[0]`** (not `process.cwd()` if they differ). Format:

```markdown
# Decisions — <conversation_id> · <date>

**Project intent (drift anchor):** <resolved intent>
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
> 3. Run: `node -e "import('./promptlog/db.js').then(m => m.getAllSessions().then(console.log))"` and confirm scored rows in Supabase.  
> Tell me when `DECISIONS.md` appears and looks correct, or paste any errors.

Wait for confirmation before continuing.

---

## Phase 4 — Server and viewer

Build these files only after Phase 3 gate has passed.

### File: `promptlog/server.js` + `promptlog/routes.js`

- `routes.js` exports `attachPromptlogRoutes(app)` with `GET /api/health`, `/api/projects`, `/api/projects/:projectId/sessions`, `/api/sessions`, `/api/session/:id` (see [`SPEC.md`](SPEC.md)).
- `server.js` attaches routes, serves `GET /` → `viewer.html`, listens on `PROMPTLOG_PORT` or `3000`.

### File: `api/index.js` (Vercel)

Same Express app as local server for public demo: set `SUPABASE_*` in the Vercel project environment. [`vercel.json`](vercel.json) rewrites all paths to `/api/index`.

### File: `viewer.html`

Single self-contained file. **Project** picker → **session** picker; **intent** line in header; live badge via `/api/health`; constellation canvas (idle pulse, load comet on edges, edge colours from drift deltas, click burst, horizontal scroll ≥ `90 * max(n,8)` px wide, hover tooltip); two-column detail + tabs (**decisions** = influence ≥ 40); `SEED_PROJECT` + `SEED_SESSION` when API unavailable.

**Cursor Simple Browser:** **View → Simple Browser →** `http://localhost:3000` (after `npm start`).

### CLI: `bin/promptlog.mjs`

`node bin/promptlog.mjs init` (or `npx` from a linked/published package): copies `.cursor` hooks, creates `.promptlog/`, resolves or prompts for intent, writes `.promptlog/intent.md`, optional `git commit`.

### Human gate

Tell the user:

> Phase 4 complete. Please:
> 1. Run: `npm start`
> 2. Open `http://localhost:3000` (or Simple Browser in Cursor)
> 3. Confirm projects/sessions load and the constellation responds  
> Tell me when it works or paste any errors.

Wait for confirmation before continuing.

---

## Phase 5 — Hardening and submission prep

Do this only after Phase 4 gate has passed.

1. Test the mock fallback: temporarily set `GEMINI_API_KEY=invalid` in the environment, run a session end, confirm `DECISIONS.md` still writes with mock scores, then restore the real key.
2. With valid Supabase env, run `npm run verify:persistence` (or confirm manually in the Supabase dashboard).
3. Verify [`SPEC.md`](SPEC.md) track alignment says **Main road: Review + QA** (update if it does not).
4. Create `SUBMISSION.md` in the repo root with this content:

```markdown
# Promptlog

**Track:** Review + QA
**Side quests:** Best Cursor-native Workflow · Best Developer Tool

Promptlog is the quality gate vibe coding never had.

It captures every prompt from a Cursor session via Cursor Hooks v1.7, scores each one for influence, drift, and spec coverage using Gemini, then replays the full session as an interactive scrubber. DECISIONS.md is written to the repo automatically at session end so you always know how you got there.

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

## Per-session logging vs session end — verification

**Reminder:** `beforeSubmitPrompt` persists each prompt immediately; `stop` only scores and writes `DECISIONS.md`.

From the **repo root** (`workspace_roots[0]`):

1. **Persist without `stop`:** In Cursor agent mode, send a prompt but do not end the session. Then run `node -e "import('./promptlog/db.js').then(m => m.getAllSessions().then(console.log))"` and `getSessionPrompts('<conversation_id>')`. Expect rows with `type`/`influence` still null until `stop` runs.
2. **Survive UI close:** After (1), close the agent or lose `stop` if Cursor allows; query the DB again — rows inserted by `on-prompt.js` should still be on disk.
3. **Enrich on `stop`:** End the session so `stop` fires; re-query `getSessionPrompts` — score columns fill when scoring runs; check `DECISIONS.md` under the workspace root.
4. **Diagnostics:** Output panel → Hooks channel; validate `.cursor/hooks.json` and restart Cursor if hooks do not run.

You can also run `npm run verify:persistence` (or `node scripts/verify-persistence.mjs`) for an automated analogue of (1)–(3) using piped hook stdin.

---

## If something breaks

- Hook not firing: check `.cursor/hooks.json` is valid JSON, restart Cursor, check the Hooks output channel in Cursor's Output panel.
- Supabase errors: check `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` in `.env` (repo root) and hook stderr.
- Gemini API returns invalid JSON: `scorer.js` returns mock scores automatically.
- Server port taken: set `PROMPTLOG_PORT=3001` in `.env`.
- `viewer.html` fetch fails: it falls back to `SEED_SESSION` automatically.
