# Promptlog — design spec
**Hackathon:** Cursor Hack London 2026  
**Track:** Review + QA (Checkpoints + Quality Gates — review loops, evidence-driven debugging, verification of the session reasoning chain)  
**Side quests:** Best Cursor-native Workflow · Best Developer Tool  
**Team:** tbd  
**Date:** 2026-04-02  

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
    on-prompt.js          ← beforeSubmitPrompt → append to SQLite
    on-stop.js            ← stop → score via Claude API → write DECISIONS.md → open browser

promptlog/
  db.js                   ← better-sqlite3 wrapper (2 tables)
  scorer.js               ← Claude API batch scoring call
  server.js               ← Express: 3 routes + static viewer
  viewer.html             ← self-contained scrubber UI
  sessions/               ← fallback JSON files if SQLite unavailable

DECISIONS.md              ← auto-written to repo root at session end
```

---

## Data flow

```
User types prompt in Cursor
  → beforeSubmitPrompt hook fires
  → on-prompt.js receives JSON via stdin:
      { conversation_id, prompt_text, timestamp, workspace_roots }
  → INSERT into prompts table (unscored row)
  → return { continue: true } immediately (non-blocking)

User ends session (Cursor stop event)
  → stop hook fires  
  → on-stop.js fetches all unscored prompts for conversation_id
  → calls scorer.js → single Claude API call (claude-sonnet-4-6)
  → Claude returns structured JSON array of scored prompts
  → UPDATE each prompt row with scores
  → INSERT/UPDATE sessions row with ended_at
  → write DECISIONS.md to workspace root
  → spawn: open http://localhost:3000 (or start server first if not running)
```

---

## SQLite schema

```sql
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,          -- conversation_id from Cursor
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  repo TEXT,                    -- workspace_roots[0]
  prompt_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS prompts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,         -- order within session (1-indexed)
  text TEXT NOT NULL,           -- the raw prompt
  timestamp INTEGER NOT NULL,
  -- scored fields (null until on-stop.js runs)
  type TEXT,                    -- directive|refinement|pivot|reversal|scope_creep|detail
  influence INTEGER,            -- 0–100
  drift INTEGER,                -- 0–100 cumulative from session start
  spec_coverage INTEGER,        -- 0–100
  decision TEXT,                -- one-sentence architectural decision
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);
```

**Escape hatch:** If `better-sqlite3` install fails, `db.js` switches to flat JSON files in `sessions/` — one file per `conversation_id`. All other files stay identical.

---

## Claude scoring call (scorer.js)

Single batch call at session end. Never called per-prompt.

**Model:** `claude-sonnet-4-6`  
**Max tokens:** 2000  

**System prompt:**
```
You are a session analyst for AI-assisted coding sessions. You receive an ordered list of prompts from a developer's Cursor session and return structured scoring for each one.

For each prompt, score:
- type: one of [directive, refinement, pivot, reversal, scope_creep, detail]
  - directive: sets a new goal or intent
  - refinement: narrows or clarifies an existing goal  
  - pivot: changes direction mid-session (often starts with "actually", "wait", "hmm")
  - reversal: undoes a previous direction ("nevermind", "ignore that")
  - scope_creep: adds a new subsystem not in the original intent
  - detail: small implementation detail, low impact
- influence: 0–100. How much did this prompt shift what was ultimately built?
- drift: 0–100. Cumulative distance from the FIRST prompt's intent. 0 = still aligned, 100 = unrecognisable.
- spec_coverage: 0–100. How much of the final product's intent is now documented across all prompts so far?
- decision: One sentence. What architectural or product decision did this prompt lock in? "None" if it locked in nothing.

Return ONLY a JSON array, no markdown, no preamble:
[{ "seq": 1, "type": "...", "influence": 0, "drift": 0, "spec_coverage": 0, "decision": "..." }, ...]
```

**User message:**
```json
{
  "session_intent": "<first prompt text>",
  "prompts": [
    { "seq": 1, "text": "..." },
    { "seq": 2, "text": "..." }
  ]
}
```

---

## Express server (server.js)

Three routes only:

```
GET /                         → serves viewer.html
GET /api/sessions             → [{ id, started_at, ended_at, repo, prompt_count }]
GET /api/session/:id          → { session, prompts: [...scored rows] }
```

Started automatically by `on-stop.js` if not already running (checks port 3000).  
Also accepts `node promptlog/server.js` manually.

---

## Viewer (viewer.html)

Self-contained HTML file. No build step, no bundler.

**Features:**
- Session picker dropdown (calls `GET /api/sessions`)
- Scrubber timeline with colour-coded pips per prompt type
- Per-prompt panel: text, type badge, influence bar, state card (direction / drift / spec coverage / pivot risk)
- Decision feed: all decisions unlocked at current scrubber position
- Three action buttons → `sendPrompt()` into Claude:
  - "most influential prompt ↗"
  - "generate DECISIONS.md ↗"  
  - "find drift point ↗"

**Demo mode fallback:** If `fetch('/api/sessions')` fails (no local server), loads hardcoded seed data so the hosted demo URL works for judges.

---

## DECISIONS.md output format

Written to workspace root on session end:

```markdown
# Decisions — <session_id> · <date>

**Session intent:** <first prompt>  
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
| 0:00–0:30 | Scaffold repo, `npm init`, install `better-sqlite3` + `express` + `@anthropic-ai/sdk`. Wire `hooks.json`. Confirm `beforeSubmitPrompt` fires and logs stdin to console. | — |
| 0:30–1:15 | `db.js` — create tables, `insertPrompt()`, `insertSession()`, `getSessionPrompts()`, `updatePromptScores()` | If install fails: flat JSON in `sessions/` folder |
| 1:15–2:00 | `scorer.js` — Claude API call, parse JSON response, return array | Hardcode mock scores for demo |
| 2:00–2:30 | `on-stop.js` — full pipeline: fetch unscored → score → update DB → write DECISIONS.md → open browser | — |
| 2:30–3:15 | `server.js` — 3 routes + static viewer serving | — |
| 3:15–4:30 | `viewer.html` — port scrubber widget, wire to `/api/session/:id`, session picker, demo fallback seed | — |
| 4:30–5:00 | Seed a real session via Cursor, verify DECISIONS.md, deploy viewer to Vercel for demo URL | — |

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
ANTHROPIC_API_KEY=sk-ant-...     # required for scorer.js
PROMPTLOG_DB=./promptlog.db      # optional, defaults to project root
PROMPTLOG_PORT=3000              # optional, defaults to 3000
```

---

## Non-goals (explicitly out of scope for 5 hours)

- Authentication or multi-user support
- Cursor extension / webview (plain HTML server is faster)
- Per-prompt scoring (too slow, too expensive)
- Response capture (hooks expose prompts, not model responses)
- Cloud sync
