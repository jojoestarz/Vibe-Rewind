# Promptlog — file tree

Every primary file, in rough dependency order.

```
promptlog/                        ← git repo root
│
├── package.json                  ← { "type": "module" }, bin: promptlog, deps: express, @supabase/supabase-js, @anthropic-ai/sdk
├── .env                          ← SUPABASE_*, ANTHROPIC_API_KEY (gitignored); see .env.example
├── .env.example
├── .gitignore                    ← node_modules, .env, DECISIONS.md
├── vercel.json                   ← rewrites to /api/index for deployed viewer + API
│
├── .cursor/
│   ├── hooks.json
│   └── hooks/
│       ├── on-prompt.js          ← beforeSubmitPrompt → db.insertPrompt (async)
│       └── on-stop.js            ← stop → intent-resolve → scorer → db → DECISIONS.md
│
├── api/
│   └── index.js                  ← Vercel: Express app (routes + viewer.html)
│
├── bin/
│   └── promptlog.mjs             ← `promptlog init` — hooks + .promptlog/intent.md
│
├── supabase/migrations/
│   └── *.sql                     ← Postgres schema
│
├── promptlog/
│   ├── load-dotenv.js
│   ├── db.js                     ← Supabase: 5 async exports
│   ├── intent-resolve.js         ← SPEC → PRD → README (500) → .promptlog/intent.md
│   ├── scorer.js                 ← score(prompts, projectIntent)
│   ├── routes.js                 ← attachPromptlogRoutes(app)
│   └── server.js                 ← local dev server
│
├── scripts/
│   └── verify-persistence.mjs    ← optional; requires Supabase env
│
├── viewer.html                   ← self-contained UI
│
├── CURSOR_EXECUTION_PLAN.md
├── SPEC.md
├── CLAUDE.md
├── SCORER_PROMPT.md
└── DECISIONS.md                  ← gitignored (generated)
```

## db.js exports (exactly these 5 functions)

All return Promises (async).

```js
export function ensureSchema()
export async function insertPrompt(sessionId, seq, text, ts)
export async function getSessionPrompts(sessionId)
export async function updatePromptScores(id, scores)
export async function getAllSessions()
```

`getAllSessions()` rows include: `project_id`, `project_intent`, `project_repo_path`, `first_prompt_text`, `display_title` (when scored).

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

## server routes (routes.js)

See [`SPEC.md`](SPEC.md) — `/api/health`, `/api/projects`, `/api/projects/:id/sessions`, `/api/sessions`, `/api/session/:id`, plus `GET /` for `viewer.html` in `server.js` / `api/index.js`.
