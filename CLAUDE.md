# Promptlog — context for Cursor / Claude Code

You are building **Promptlog** for Cursor Hack London 2026. **Track: Review + QA.**

## Read first (in order)

1. [`SPEC.md`](SPEC.md) — product architecture and schema
2. [`FILE_TREE.md`](FILE_TREE.md) — files and exports
3. [`CURSOR_EXECUTION_PLAN.md`](CURSOR_EXECUTION_PLAN.md) — **phased build, human gates, hook import paths, scorer API, viewer spec**

If any of these are missing, ask the user to restore them before coding.

## Constraints

- Node.js + plain JS only. No TypeScript, no bundler, no framework beyond Express.
- **No per-prompt Gemini calls.** One batch call at session end (`on-stop.js` → `scorer.score`).
- `viewer.html`: one self-contained file, no imports, no build step.
- **`promptlog/db.js` only** talks to Supabase (`@supabase/supabase-js`); everyone else imports from it.
- **`on-prompt.js`** must stdout `{ "continue": true }` immediately; wrap in try/catch (async `await` for DB is OK).
- Hook scripts live in **`.cursor/hooks/`** — import app code with  
  `new URL('../../promptlog/<file>.js', import.meta.url)`  
  (two `..` to repo root, then `promptlog/...`).
- YAGNI: if it is not in `SPEC.md` or `CURSOR_EXECUTION_PLAN.md`, do not build it.
- Build order: **Phase 0 → 5** in `CURSOR_EXECUTION_PLAN.md`; do not skip ahead.

## Escape hatches

- Supabase env missing → `db.js` logs errors; hooks still return `{ continue: true }`.
- Gemini unavailable / bad JSON → mock scores in `scorer.js` (never throw).
- Viewer `fetch` fails → `SEED_SESSION` / `SEED_PROJECT` in `viewer.html` (execution plan).

## Local viewer in Cursor

**View → Simple Browser →** `http://localhost:3000` opens the replay UI in an editor panel (after `npm start`).
