import fs from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';

function loadEnvFromDotenv() {
  try {
    const envPath = path.join(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) return;
    const text = fs.readFileSync(envPath, 'utf8');
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      const key = t.slice(0, eq).trim();
      let val = t.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (key && process.env[key] === undefined) process.env[key] = val;
    }
  } catch {
    /* ignore */
  }
}

loadEnvFromDotenv();

const SYSTEM_PROMPT = `You are a session analyst for AI-assisted coding sessions. You receive an ordered list of prompts from a developer's Cursor session and return structured scoring for each one.

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
Format: [{"seq":1,"type":"...","influence":0,"drift":0,"spec_coverage":0,"decision":"..."}]`;

function mockScores(prompts) {
  return prompts.map((p) => ({
    seq: p.seq,
    type: 'detail',
    influence: 50,
    drift: 20,
    spec_coverage: 30,
    decision: 'Mock score — API unavailable.',
  }));
}

function parseScoresArray(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf('[');
    const end = trimmed.lastIndexOf(']');
    if (start !== -1 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error('no json array');
  }
}

/**
 * @param {{ seq: number, text: string }[]} prompts
 * @param {string} sessionIntent
 */
export async function score(prompts, sessionIntent) {
  if (!prompts?.length) return [];

  try {
    const client = new Anthropic();
    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: JSON.stringify({
            session_intent: sessionIntent,
            prompts,
          }),
        },
      ],
    });

    const block = response.content[0];
    if (block.type !== 'text') return mockScores(prompts);
    const arr = parseScoresArray(block.text);
    if (!Array.isArray(arr)) return mockScores(prompts);
    return arr;
  } catch {
    return mockScores(prompts);
  }
}
