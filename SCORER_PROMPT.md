# Gemini scoring prompt (copy-paste ready)

Canonical scoring rules live in [`promptlog/scorer.js`](promptlog/scorer.js) (`SYSTEM_PROMPT`) and Phase 2 of [`CURSOR_EXECUTION_PLAN.md`](CURSOR_EXECUTION_PLAN.md). Keep this file in sync.

## System prompt (summary)

- Inputs: fixed **`project_intent`** plus ordered **`prompts`**, each with **`seq`**, **`text`**, and precomputed **`influence_hints`** (keyword flags: actually, wait, nevermind, hmm, can we instead, forget, scrap, ignore that).
- **drift:** cumulative semantic distance from **`project_intent`** (not the first prompt; first prompt may be non-zero).
- **spec_coverage:** how much of **project_intent**’s key concepts are addressed so far across prompts.
- Output: JSON array only: `[{"seq", "type", "influence", "drift", "spec_coverage", "decision"}]`.

## User message format

`JSON.stringify({ project_intent, prompts })` where each item in `prompts` is `{ seq, text, influence_hints }[]`.
