# Promptlog — file tree

Every file that needs to be created, in build order.

```
promptlog/                        ← root of the project (git repo)
│
├── package.json                  ← { "type": "module" }, deps: express, better-sqlite3, @anthropic-ai/sdk
├── .env                          ← ANTHROPIC_API_KEY (gitignored)
├── .gitignore                    ← node_modules, .env, promptlog.db
│
├── .cursor/
│   ├── hooks.json                ← registers beforeSubmitPrompt + stop hooks
│   └── hooks/
│       ├── on-prompt.js          ← STEP 1: receives prompt via stdin, inserts to DB, returns {continue:true}
│       └── on-stop.js            ← STEP 4: fetches prompts → scores → updates DB → writes DECISIONS.md → stderr: npm start
│
├── promptlog/
│   ├── db.js                     ← STEP 2: SQLite wrapper (5 exported functions)
│   ├── scorer.js                 ← STEP 3: export score(prompts, sessionIntent) — one Claude batch, see execution plan
│   └── server.js                 ← STEP 5: Express, 3 routes, serves viewer.html
│
├── viewer.html                   ← STEP 6: self-contained scrubber UI (see CURSOR_EXECUTION_PLAN.md Phase 4)
│
├── CURSOR_EXECUTION_PLAN.md      ← normative phased build + human gates for Cursor agent
├── SUBMISSION.md                 ← created in Phase 5 (execution plan)
└── DECISIONS.md                  ← auto-written under workspace root (gitignored per project choice)
```

## db.js exports (exactly these 5 functions)

```js
export function ensureSchema()                          // create tables if not exists
export function insertPrompt(sessionId, seq, text, ts)  // insert unscored row, upsert session
export function getSessionPrompts(sessionId)            // returns all prompts for session, ordered by seq
export function updatePromptScores(id, scores)          // id = prompts.id (row PK); scores = one object { type, influence, drift, spec_coverage, decision }; call once per scored prompt
export function getAllSessions()                        // returns sessions ordered by started_at DESC
```

## on-prompt.js stdin payload (from Cursor)

```json
{
  "conversation_id": "uuid",
  "prompt_text": "the user's prompt",
  "timestamp": 1234567890,
  "hook_event_name": "beforeSubmitPrompt",
  "workspace_roots": ["/path/to/project"]
}
```

## on-stop.js stdin payload (from Cursor)

```json
{
  "conversation_id": "uuid",
  "hook_event_name": "stop",
  "workspace_roots": ["/path/to/project"]
}
```

## server.js routes

```
GET /                         → res.sendFile('viewer.html')
GET /api/sessions             → db.getAllSessions()
GET /api/session/:id          → { session, prompts: db.getSessionPrompts(id) }
```

## viewer.html structure (all in one file, no imports)

```html
<style>   ← scrubber, cards, timeline styles
<body>    ← session picker, scrubber, prompt card, state card, decision feed, action buttons
<script>  ← fetch /api/sessions on load, render, scrubber drag logic, sendPrompt() calls
```

Seed data object embedded in script for demo fallback:
```js
const SEED_SESSION = { session: {...}, prompts: [...8 scored prompts] }
```
