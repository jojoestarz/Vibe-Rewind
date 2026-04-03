import './load-dotenv.js';
import { createClient } from '@supabase/supabase-js';
import path from 'path';

const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'can',
  'you',
  'please',
  'just',
  'i',
  'we',
  'to',
  'for',
  'and',
  'or',
  'is',
  'it',
  'in',
  'on',
  'at',
  'me',
  'my',
  'this',
  'that',
  'if',
  'of',
]);

function normalizeRepoPath(repo) {
  if (!repo || typeof repo !== 'string') return path.resolve(process.cwd());
  return path.resolve(repo);
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[\s.,;:!?'"()[\]{}–—-]+/)
    .filter(Boolean);
}

function twoMeaningfulWords(firstPromptText) {
  const words = tokenize(firstPromptText).filter((w) => !STOP_WORDS.has(w));
  if (words.length === 0) return 'session';
  if (words.length === 1) return words[0];
  return `${words[0]} ${words[1]}`;
}

function buildDisplayTitle(firstPromptText, startedAtMs, promptCount) {
  const w = twoMeaningfulWords(firstPromptText);
  const d = new Date(startedAtMs);
  const day = d.getDate();
  const mon = d.toLocaleString('en-GB', { month: 'short' });
  const hm = d.toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return `${w} · ${day} ${mon} · ${hm} · ${promptCount} prompts`;
}

function getSupabase() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    return null;
  }
  return createClient(url, key);
}

function numId(row) {
  const id = row?.id;
  if (typeof id === 'bigint') return Number(id);
  if (typeof id === 'string' && /^\d+$/.test(id)) return Number(id);
  return id;
}

function mapPromptRow(row) {
  if (!row) return row;
  return {
    ...row,
    id: numId(row),
    timestamp: row.timestamp != null ? Number(row.timestamp) : row.timestamp,
    seq: Number(row.seq),
    influence: row.influence != null ? Number(row.influence) : row.influence,
    drift: row.drift != null ? Number(row.drift) : row.drift,
    spec_coverage:
      row.spec_coverage != null ? Number(row.spec_coverage) : row.spec_coverage,
  };
}

/** @type {ReturnType<createClient> | null} */
let _client = null;

function clientOrNull() {
  if (_client) return _client;
  _client = getSupabase();
  return _client;
}

export function ensureSchema() {
  /* Schema lives in Supabase migrations; optional noop for API compatibility. */
}

/**
 * @param {string} sessionId
 * @param {number} seq
 * @param {string} text
 * @param {number} ts
 */
export async function insertPrompt(sessionId, seq, text, ts) {
  const supabase = clientOrNull();
  const tsSafe =
    typeof ts === 'number' && Number.isFinite(ts) && ts > 0 ? ts : Date.now();
  const repoPath = normalizeRepoPath(process.env.PROMPTLOG_REPO);

  if (!supabase) {
    console.error(
      'Promptlog db: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing — prompt not persisted.'
    );
    return;
  }

  try {
    let { data: proj, error: pe } = await supabase
      .from('projects')
      .select('id')
      .eq('repo_path', repoPath)
      .maybeSingle();
    if (pe) throw pe;
    if (!proj) {
      const ins = await supabase
        .from('projects')
        .insert({ repo_path: repoPath, intent_text: '' })
        .select('id')
        .single();
      if (ins.error) throw ins.error;
      proj = ins.data;
    }

    const { data: existing, error: se } = await supabase
      .from('sessions')
      .select('prompt_count, project_id')
      .eq('id', sessionId)
      .maybeSingle();
    if (se) throw se;

    if (!existing) {
      const { error: ie } = await supabase.from('sessions').insert({
        id: sessionId,
        project_id: proj.id,
        started_at: tsSafe,
        ended_at: null,
        repo: repoPath,
        prompt_count: 1,
      });
      if (ie) throw ie;
    } else {
      const next = (existing.prompt_count ?? 0) + 1;
      const { error: ue } = await supabase
        .from('sessions')
        .update({ prompt_count: next, repo: repoPath })
        .eq('id', sessionId);
      if (ue) throw ue;
    }

    const { error: perr } = await supabase.from('prompts').insert({
      session_id: sessionId,
      seq,
      text,
      timestamp: tsSafe,
    });
    if (perr) throw perr;
  } catch (e) {
    console.error('Promptlog db insertPrompt:', e?.message || e);
  }
}

/**
 * @param {string} sessionId
 */
export async function getSessionPrompts(sessionId) {
  const supabase = clientOrNull();
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from('prompts')
      .select(
        'id, session_id, seq, text, timestamp, type, influence, drift, spec_coverage, decision'
      )
      .eq('session_id', sessionId)
      .order('seq', { ascending: true });
    if (error) throw error;
    return (data || []).map(mapPromptRow);
  } catch (e) {
    console.error('Promptlog db getSessionPrompts:', e?.message || e);
    return [];
  }
}

async function syncProjectIntentFromEnv(supabase, sessionId) {
  const intent = process.env.PROMPTLOG_PROJECT_INTENT;
  if (intent == null || String(intent).trim() === '') return;

  const { data: row, error } = await supabase
    .from('sessions')
    .select('project_id')
    .eq('id', sessionId)
    .maybeSingle();
  if (error || !row?.project_id) return;

  await supabase
    .from('projects')
    .update({ intent_text: String(intent).trim() })
    .eq('id', row.project_id);

  delete process.env.PROMPTLOG_PROJECT_INTENT;
}

async function maybeFinalizeSession(supabase, sessionId) {
  const { data: pending, error: e1 } = await supabase
    .from('prompts')
    .select('id')
    .eq('session_id', sessionId)
    .is('type', null)
    .limit(1);
  if (e1 || (pending && pending.length > 0)) return;

  const { data: prompts, error: e2 } = await supabase
    .from('prompts')
    .select('text, seq')
    .eq('session_id', sessionId)
    .order('seq', { ascending: true });
  if (e2 || !prompts?.length) {
    await supabase
      .from('sessions')
      .update({ ended_at: Date.now() })
      .eq('id', sessionId);
    return;
  }

  const first = prompts[0];
  const { data: sess, error: e3 } = await supabase
    .from('sessions')
    .select('started_at, prompt_count')
    .eq('id', sessionId)
    .maybeSingle();
  if (e3 || !sess) return;

  const title = buildDisplayTitle(
    first.text,
    Number(sess.started_at),
    sess.prompt_count ?? prompts.length
  );

  await supabase
    .from('sessions')
    .update({ ended_at: Date.now(), display_title: title })
    .eq('id', sessionId);
}

/**
 * @param {number} id prompt row id
 * @param {{ type: string, influence: number, drift: number, spec_coverage: number, decision: string }} scores
 */
export async function updatePromptScores(id, scores) {
  const supabase = clientOrNull();
  if (!supabase) return;

  try {
    const { data: prow, error: fe } = await supabase
      .from('prompts')
      .select('session_id')
      .eq('id', id)
      .maybeSingle();
    if (fe || !prow) return;

    await syncProjectIntentFromEnv(supabase, prow.session_id);

    const { error: ue } = await supabase
      .from('prompts')
      .update({
        type: scores.type,
        influence: scores.influence,
        drift: scores.drift,
        spec_coverage: scores.spec_coverage,
        decision: scores.decision,
      })
      .eq('id', id);
    if (ue) throw ue;

    await maybeFinalizeSession(supabase, prow.session_id);
  } catch (e) {
    console.error('Promptlog db updatePromptScores:', e?.message || e);
  }
}

export async function getAllSessions() {
  const supabase = clientOrNull();
  if (!supabase) return [];
  try {
    const { data: sessions, error: se } = await supabase
      .from('sessions')
      .select(
        'id, project_id, started_at, ended_at, repo, prompt_count, display_title'
      )
      .order('started_at', { ascending: false });
    if (se) throw se;
    if (!sessions?.length) return [];

    const projectIds = [...new Set(sessions.map((s) => s.project_id).filter(Boolean))];
    const { data: projects, error: pe } = await supabase
      .from('projects')
      .select('id, intent_text, repo_path')
      .in('id', projectIds);
    if (pe) throw pe;
    const pmap = Object.fromEntries((projects || []).map((p) => [p.id, p]));

    const sessionIds = sessions.map((s) => s.id);
    const { data: allPrompts, error: qe } = await supabase
      .from('prompts')
      .select('session_id, seq, text')
      .in('session_id', sessionIds);
    if (qe) throw qe;

    const firstBySession = new Map();
    for (const p of allPrompts || []) {
      const sid = p.session_id;
      const prev = firstBySession.get(sid);
      const seq = Number(p.seq);
      if (!prev || seq < prev.seq) {
        firstBySession.set(sid, { seq, text: p.text });
      }
    }

    return sessions.map((s) => {
      const proj = pmap[s.project_id];
      const first = firstBySession.get(s.id);
      return {
        ...s,
        started_at: s.started_at != null ? Number(s.started_at) : s.started_at,
        ended_at: s.ended_at != null ? Number(s.ended_at) : s.ended_at,
        prompt_count:
          s.prompt_count != null ? Number(s.prompt_count) : s.prompt_count,
        project_intent: proj?.intent_text ?? '',
        project_repo_path: proj?.repo_path ?? s.repo ?? '',
        first_prompt_text: first?.text ?? null,
      };
    });
  } catch (e) {
    console.error('Promptlog db getAllSessions:', e?.message || e);
    return [];
  }
}
