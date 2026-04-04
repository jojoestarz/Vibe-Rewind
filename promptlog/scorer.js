import './load-dotenv.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

const INFLUENCE_HINT_PHRASES = [
  'actually',
  'wait',
  'nevermind',
  'hmm',
  'can we instead',
  'forget',
  'scrap',
  'ignore that',
];

function influenceHintsForText(text) {
  const s = String(text || '').toLowerCase();
  const flags = [];
  for (const phrase of INFLUENCE_HINT_PHRASES) {
    if (s.includes(phrase)) flags.push(phrase);
  }
  return flags;
}

const SYSTEM_PROMPT = `You are a session analyst for AI-assisted coding sessions. You receive a fixed project_intent string (the authoritative product/spec anchor for this repo) and an ordered list of prompts. Each prompt includes influence_hints: phrases detected in the text that often signal pivots or reversals — use them as weak priors when calibrating type and influence, not as hard rules.

For each prompt, score:

- type: one of [directive, refinement, pivot, reversal, scope_creep, detail]
  - directive: sets a new goal or intent
  - refinement: narrows or clarifies an existing goal
  - pivot: changes direction mid-session (often aligns with influence_hints like "actually", "wait", "hmm", "can we instead")
  - reversal: undoes a previous direction (often aligns with "nevermind", "ignore that", "forget", "scrap")
  - scope_creep: adds a new subsystem not present in the project_intent
  - detail: small implementation detail, low architectural impact

- influence: 0-100. How much did this prompt shift what was ultimately built?
- drift: 0-100 cumulative. Semantic distance from the fixed project_intent (not from the first prompt). The first prompt may have non-zero drift if it already diverges from project_intent. Generally drift should not decrease sharply except after a genuine reversal that realigns with project_intent.
- spec_coverage: 0-100 cumulative. How much of the key concepts and requirements implied by project_intent appear to be addressed or reflected across all prompts so far (not vague "product intent" — tie scores explicitly to project_intent). Generally increases as the session covers more of that intent.
- decision: one sentence. What architectural or product decision did this prompt lock in? Write "None" if it locked in nothing.

Return ONLY a valid JSON array. No markdown, no explanation, no preamble.
Format: [{"seq":1,"type":"...","influence":0,"drift":0,"spec_coverage":0,"decision":"..."}]`;

function mockScores(prompts, reason = 'api') {
  const decision =
    reason === 'no_key'
      ? 'Mock score — GEMINI_API_KEY missing; add it to .env in the repo root (same folder as promptlog/).'
      : 'Mock score — Gemini failed (see Hooks stderr for "Promptlog scorer:" lines: quota, model name, safety block, or bad JSON shape).';
  return prompts.map((p) => ({
    seq: p.seq,
    type: 'detail',
    influence: 50,
    drift: 20,
    spec_coverage: 30,
    decision,
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

const TYPES = new Set([
  'directive',
  'refinement',
  'pivot',
  'reversal',
  'scope_creep',
  'detail',
]);

function asFiniteNumber(v) {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return NaN;
}

function normalizedSeq(r) {
  const n = asFiniteNumber(r?.seq);
  return Number.isFinite(n) && Number.isInteger(n) && n >= 1 ? n : NaN;
}

function scoreRowLooksValid(r) {
  if (!r || !Number.isFinite(normalizedSeq(r))) return false;
  const typeKey = String(r.type || '')
    .trim()
    .toLowerCase();
  if (!TYPES.has(typeKey)) return false;
  for (const k of ['influence', 'drift', 'spec_coverage']) {
    if (!Number.isFinite(asFiniteNumber(r[k]))) return false;
  }
  if (r.decision == null || String(r.decision).trim() === '') return false;
  return true;
}

function normalizeScoreRow(r) {
  return {
    seq: normalizedSeq(r),
    type: String(r.type || '')
      .trim()
      .toLowerCase(),
    influence: asFiniteNumber(r.influence),
    drift: asFiniteNumber(r.drift),
    spec_coverage: asFiniteNumber(r.spec_coverage),
    decision: String(r.decision),
  };
}

function scoresCoverBatch(batch, arr) {
  if (!Array.isArray(arr)) return false;
  const bySeq = new Map(
    arr.map((r) => [normalizedSeq(r), r]).filter(([s]) => Number.isFinite(s))
  );
  return batch.every((p) => scoreRowLooksValid(bySeq.get(p.seq)));
}

/**
 * @param {{ seq: number, text: string }[]} prompts
 * @param {string} projectIntent fixed project/spec anchor (never empty — caller should fallback)
 */
export async function score(prompts, projectIntent) {
  if (!prompts?.length) return [];

  const batch = prompts.map((p) => ({
    seq: p.seq,
    text: p.text,
    influence_hints: influenceHintsForText(p.text),
  }));

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    console.error(
      'Promptlog scorer: GEMINI_API_KEY missing after loading repo .env — check .env in repo root (next to promptlog/).'
    );
    return mockScores(prompts, 'no_key');
  }

  const intent =
    projectIntent && String(projectIntent).trim() !== ''
      ? String(projectIntent).trim()
      : '(no project intent file — treat drift relative to an empty anchor and prefer conservative scores)';

  const modelId =
    process.env.GEMINI_MODEL?.trim() || DEFAULT_GEMINI_MODEL;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: modelId,
      systemInstruction: SYSTEM_PROMPT,
      generationConfig: {
        maxOutputTokens: 2000,
      },
    });

    const userPayload = JSON.stringify({
      project_intent: intent,
      prompts: batch,
    });

    const response = await model.generateContent(userPayload);
    const fb = response.response?.promptFeedback;
    if (fb?.blockReason) {
      console.error(
        'Promptlog scorer: prompt blocked:',
        fb.blockReason,
        fb.blockReasonMessage || ''
      );
      return mockScores(prompts, 'api');
    }

    let rawText;
    try {
      rawText = response.response.text();
    } catch (e) {
      console.error(
        'Promptlog scorer: no text in response:',
        e?.message || e
      );
      return mockScores(prompts, 'api');
    }

    if (!rawText || !String(rawText).trim()) {
      console.error('Promptlog scorer: empty model response text');
      return mockScores(prompts, 'api');
    }

    let arr;
    try {
      arr = parseScoresArray(rawText);
    } catch (e) {
      console.error('Promptlog scorer: JSON parse failed:', e?.message || e);
      return mockScores(prompts, 'api');
    }
    if (!scoresCoverBatch(prompts, arr)) {
      const expected = prompts.map((p) => p.seq).join(',');
      console.error(
        'Promptlog scorer: model JSON missing seqs or invalid fields (expected seq:',
        expected,
        '). First 400 chars:',
        String(rawText).slice(0, 400)
      );
      return mockScores(prompts, 'api');
    }
    return arr.map((r) => normalizeScoreRow(r));
  } catch (e) {
    const msg = e?.message || String(e);
    console.error(
      'Promptlog scorer: request error (model:',
      modelId,
      '):',
      msg
    );
    if (e?.status) console.error('Promptlog scorer: HTTP status', e.status);
    if (e?.errorDetails)
      console.error('Promptlog scorer: errorDetails', e.errorDetails);
    return mockScores(prompts, 'api');
  }
}
