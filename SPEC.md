# Promptlog — design spec
**Hackathon:** Cursor Hack London 2026  
**Track:** Review + QA (Checkpoints + Quality Gates — review loops, evidence-driven debugging, verification of the session reasoning chain)  
**Side quests:** Best Cursor-native Workflow · Best Developer Tool  
**Team:** tbd  
**Date:** 2026-04-02  

**Agent execution:** The step-by-step build for Cursor (phases, human gates, hook `import.meta.url` rules, scorer API, viewer pixel spec, `SUBMISSION.md`) is normative in [`CURSOR_EXECUTION_PLAN.md`](CURSOR_EXECUTION_PLAN.md). Implement that document when coding; this file is the product/architecture source of truth.

---

## Problem

Every AI coding session starts with a vague intention and ends with working code and zero documentation of how you got there. The spec lives in the prompt history, which nobody reads, and eventually disappears. Git records *what* changed — not *why*, not which prompt was the pivot, not when the session drifted off course.

Developers enter "vibe hell": shipping code without knowing which prompt caused the architectural decision, what the most influential moment was, or how far the session wandered from the original intent.

## Solution

**Promptlog** is a Cursor-native **session review and QA** tool:

1. **Captures** every prompt via Cursor Hooks (`beforeSubmitPrompt`, `stop`) — see non-goals for response capture
2. **Scores** each prompt at session end via a single Claude API call — influence, drift, type, decision
3. **Replays** the session as an interactive scrubber showing the full decision graph
4. **Writes** a structured `DECISIONS.md` to the repo automatically (evidence in-tree)
5. **Persists** sessions to SQLite for multi-session history

It supports the **Review + QA** track by providing a **review loop** on the prompt → decision trace, **evidence-driven debugging** of how intent drifted, and **alignment signals** (drift, spec coverage) at a **session-end checkpoint** — not general agent orchestration. It does **not** replace unit tests or static analysis; it inspects the **quality of the session narrative** and the decisions it locked in.

---

## Architecture

```
.cursor/
  hooks.json              ← registers hooks with Cursor
  hooks/
    on-prompt.js          ← beforeSubmitPrompt → append row via Supabase (db.js)
    on-stop.js            ← stop → resolve project intent → score via Claude → sync intent → DECISIONS.md

promptlog/
  db.js                   ← Supabase only (projects, sessions, prompts)
  intent-resolve.js       ← SPEC.md → PRD.md → README (500 chars) → .promptlog/intent.md
  scorer.js               ← Claude API batch scoring (project_intent + influence_hints)
  routes.js               ← Express route table (shared with Vercel api/index.js)
  server.js               ← local Express + static viewer
  load-dotenv.js

api/index.js              ← Vercel serverless entry (same routes + viewer.html)

viewer.html               ← self-contained UI (project → session, constellation, seed fallback)
supabase/migrations/      ← Postgres schema

DECISIONS.md              ← auto-written under workspace_roots[0] at session end (see execution plan)
```

---

## Data flow

```
User types prompt in Cursor
  → beforeSubmitPrompt hook fires
  → on-prompt.js receives JSON via stdin:
      { conversation_id, prompt_text, timestamp, workspace_roots }
  → INSERT into `prompts` (unscored row) under a `sessions` row linked to a `projects` row for `workspace_roots[0]`
  → return { continue: true } immediately (non-blocking)

User ends session (Cursor stop event)
  → stop hook fires  
  → on-stop.js fetches all unscored prompts for conversation_id
  → resolves **project intent** (SPEC → PRD → README → `.promptlog/intent.md`, else first prompt) and syncs to `projects.intent_text`
  → calls scorer.js → single Claude API call (claude-sonnet-4-6) with `project_intent` and per-prompt `influence_hints`
  → Claude returns structured JSON array of scored prompts
  → UPDATE each prompt row with scores
  → UPDATE sessions row with `ended_at` and `display_title` when all prompts scored
  → write DECISIONS.md under workspace_roots[0]
  → log to stderr: run `npm start` to open the replay UI (no auto-launch in MVP)
```

---

## Supabase / Postgres schema

See [`supabase/migrations/20260403120000_promptlog.sql`](supabase/migrations/20260403120000_promptlog.sql).

- **`projects`:** `id` (uuid), `repo_path` (unique, normalized workspace root), `intent_text`, optional `display_name`, `created_at`.
- **`sessions`:** `id` (text, Cursor `conversation_id`), `project_id` (fk), `started_at` / `ended_at` (epoch ms), `repo`, `prompt_count`, `display_title` (human-readable after scoring).
- **`prompts`:** `id` (bigserial), `session_id`, `seq`, `text`, `timestamp`, scored columns (`type`, `influence`, `drift`, `spec_coverage`, `decision`) null until `stop`.

**Persistence:** `promptlog/db.js` uses `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` from `.env` (repo root). There is no local SQLite or JSON fallback.

---

## Claude scoring call (scorer.js)

Single batch call at session end. Never called per-prompt.

**Export:** `score(prompts, projectIntent)` where `prompts` is `{ seq, text }[]` and `projectIntent` is the fixed repo anchor string. The implementation attaches **`influence_hints`** per prompt before the API call (see [`promptlog/scorer.js`](promptlog/scorer.js)).

**Model:** `claude-sonnet-4-6`  
**Max tokens:** 2000  

**System prompt:** Copy **verbatim** from [`CURSOR_EXECUTION_PLAN.md`](CURSOR_EXECUTION_PLAN.md) Phase 2 (kept in sync in [`SCORER_PROMPT.md`](SCORER_PROMPT.md)). Do not paraphrase in `scorer.js`.

**User message:**
```json
{
  "project_intent": "<resolved intent string>",
  "prompts": [
    { "seq": 1, "text": "...", "influence_hints": ["actually"] },
    { "seq": 2, "text": "...", "influence_hints": [] }
  ]
}
```

---

## Express server (`promptlog/server.js` + `promptlog/routes.js`)

```
GET /                         → serves viewer.html
GET /api/health               → { ok, sessionCount }
GET /api/projects             → [{ id, repo_path, intent_text, session_count, last_started_at }]
GET /api/projects/:projectId/sessions → session rows for that project
GET /api/sessions             → all sessions (joined project fields for viewer)
GET /api/session/:id          → { session, prompts, project }
```

Start manually: `npm start` or `node promptlog/server.js` (see [`CURSOR_EXECUTION_PLAN.md`](CURSOR_EXECUTION_PLAN.md)).

---

## Viewer (viewer.html)

Self-contained HTML file. No build step, no bundler.

**Features (summary):**
- **Project** picker → **session** picker; project **intent** always visible in header; live vs demo badge (`/api/health`).
- Constellation graph: idle pulse, path “comet” on session load, **edge colours** from drift deltas, click particle burst, horizontal scroll, hover tooltip.
- Two-column detail panel + tabs (**decisions** = influence ≥ 40, **all prompts**); three action buttons (`sendPrompt` or clipboard fallback).
- **`SEED_PROJECT` + `SEED_SESSION`** embedded for offline demo.

**Demo mode fallback:** If `/api/health` or `/api/projects` fails, use seed data.

**Cursor:** **View → Simple Browser →** `http://localhost:3000` (with `npm start`).

---

## DECISIONS.md output format

Written under **`workspace_roots[0]`** on session end (the Cursor workspace root for that session):

```markdown
# Decisions — <session_id> · <date>

**Project intent (drift anchor):** <resolved intent>  
**Prompts:** N · **Peak drift:** X% · **Spec coverage:** Y%

## Decisions

### P3 · pivot · 78% influence
> "actually can you add a graph like the one we saw earlier"

Changed direction from tabular dashboard to graph-based view. Original dashboard spec partially abandoned.

---

### P7 · reversal · 95% influence  
> "nevermind the rules thing, just show the prompt that caused each decision"

Killed rules-tracing subsystem. Introduced prompt-to-decision linking as the core product concept.

---
```

Only prompts with `influence >= 40` are written. Low-influence detail prompts are omitted.

---

## Hooks configuration (.cursor/hooks.json)

```json
{
  "version": 1,
  "hooks": {
    "beforeSubmitPrompt": [
      {
        "command": "node .cursor/hooks/on-prompt.js"
      }
    ],
    "stop": [
      {
        "command": "node .cursor/hooks/on-stop.js"
      }
    ]
  }
}
```

---

## Five-hour build order

| Time | Task | Escape hatch |
|---|---|---|
| 0:00–0:30 | Scaffold repo, `npm init`, install `@supabase/supabase-js` + `express` + `@anthropic-ai/sdk`. Apply Supabase migration. Wire `hooks.json`. | — |
| 0:30–1:15 | `db.js` — Supabase client, `ensureSchema` noop, five async exports | Set `SUPABASE_*` in `.env` |
| 1:15–2:00 | `scorer.js` — Claude API call, parse JSON response, return array | Hardcode mock scores for demo |
| 2:00–2:30 | `on-stop.js` — full pipeline: fetch unscored → score → update DB → write DECISIONS.md → stderr hint to run server | — |
| 2:30–3:15 | `server.js` — 3 routes + static viewer serving | — |
| 3:15–4:30 | `viewer.html` — port scrubber widget, wire to `/api/session/:id`, session picker, demo fallback seed | — |
| 4:30–5:00 | Seed a real session via Cursor, verify DECISIONS.md, `vercel deploy` (see `vercel.json` + `api/index.js`) | — |

---

## Track alignment

**Main road: Review + QA**  
Promptlog is a **checkpoint** at session end: it produces structured **evidence** (scores + `DECISIONS.md`), supports **review** of high-influence prompts and pivots, and surfaces **verification-style signals** (drift from original intent, spec coverage). It is **evidence-driven debugging** for vibe sessions — which prompt caused which decision, and how far did we drift?

**Secondary framing (related):** The same hooks-and-runtime shape also fits “tools that observe agents,” but **judging and pitch** should emphasize Review + QA as above.

**Side quest: Best Cursor-native Workflow**  
Entirely built on Cursor Hooks v1.7. The hook architecture is the story. No proxy, no extension manifest, no external scraping — just `hooks.json` and two Node scripts.

**Side quest: Best Developer Tool**  
Solves a real daily pain: "how did I get here?" after a vibe coding session.

**Stretch side quest: Best Use of AI Safety (White Circle)**  
Scan each captured prompt for injection patterns using White Circle's API. Surface as a warning node in the scrubber. ~30 min addition if time permits.

---

## Environment variables

```
SUPABASE_URL=https://....supabase.co
SUPABASE_SERVICE_ROLE_KEY=...    # server + Cursor hooks (keep secret)
ANTHROPIC_API_KEY=sk-ant-...     # required for real scores in scorer.js
PROMPTLOG_PORT=3000              # optional, defaults to 3000
```

Copy [`.env.example`](.env.example) to `.env` in the repo root.

---

## Non-goals (explicitly out of scope for 5 hours)

- Authentication or multi-user support
- Cursor extension / webview (plain HTML server is faster)
- Per-prompt scoring (too slow, too expensive)
- Response capture (hooks expose prompts, not model responses)
- Productized multi-tenant cloud accounts (Supabase is persistence only, not auth/onboarding UX)
