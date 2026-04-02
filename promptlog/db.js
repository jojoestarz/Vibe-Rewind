import fs from 'fs';
import path from 'path';

const cwd = process.cwd();
const dbFilePath = process.env.PROMPTLOG_DB ?? path.join(cwd, 'promptlog.db');
const sessionsDir = path.join(cwd, 'sessions');

let sqlite = false;
/** @type {import('better-sqlite3').Database | null} */
let db = null;

try {
  const { default: Database } = await import('better-sqlite3');
  db = new Database(dbFilePath);
  sqlite = true;
} catch {
  sqlite = false;
  if (!fs.existsSync(sessionsDir)) {
    fs.mkdirSync(sessionsDir, { recursive: true });
  }
}

function execSchemaSqlite() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      repo TEXT,
      prompt_count INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS prompts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      text TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      type TEXT,
      influence INTEGER,
      drift INTEGER,
      spec_coverage INTEGER,
      decision TEXT,
      FOREIGN KEY (session_id) REFERENCES sessions(id)
    );
  `);
}

if (sqlite) {
  execSchemaSqlite();
}

export function ensureSchema() {
  if (sqlite) {
    execSchemaSqlite();
  } else if (!fs.existsSync(sessionsDir)) {
    fs.mkdirSync(sessionsDir, { recursive: true });
  }
}

function maybeFinalizeSession(sessionId) {
  const pending = db
    .prepare(
      `SELECT COUNT(*) AS c FROM prompts WHERE session_id = ? AND type IS NULL`
    )
    .get(sessionId);
  if (pending.c === 0) {
    db.prepare(`UPDATE sessions SET ended_at = ? WHERE id = ?`).run(Date.now(), sessionId);
  }
}

function sessionJsonPath(sessionId) {
  return path.join(sessionsDir, `${encodeURIComponent(sessionId)}.json`);
}

function readJsonStore(sessionId) {
  const p = sessionJsonPath(sessionId);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeJsonStore(sessionId, data) {
  if (!fs.existsSync(sessionsDir)) {
    fs.mkdirSync(sessionsDir, { recursive: true });
  }
  fs.writeFileSync(sessionJsonPath(sessionId), JSON.stringify(data, null, 2), 'utf8');
}

function findJsonByPromptRowId(rowId) {
  if (!fs.existsSync(sessionsDir)) return null;
  for (const f of fs.readdirSync(sessionsDir)) {
    if (!f.endsWith('.json')) continue;
    const full = path.join(sessionsDir, f);
    const data = JSON.parse(fs.readFileSync(full, 'utf8'));
    const pr = data.prompts?.find((p) => p.id === rowId);
    if (pr) return { data, sessionId: data.session.id };
  }
  return null;
}

export function insertPrompt(sessionId, seq, text, ts) {
  const repo = process.env.PROMPTLOG_REPO || null;
  if (sqlite) {
    db.prepare(
      `
      INSERT INTO sessions (id, started_at, ended_at, repo, prompt_count)
      VALUES (?, ?, NULL, ?, 1)
      ON CONFLICT(id) DO UPDATE SET
        prompt_count = sessions.prompt_count + 1,
        repo = COALESCE(excluded.repo, sessions.repo)
    `
    ).run(sessionId, ts, repo);
    db.prepare(
      `INSERT INTO prompts (session_id, seq, text, timestamp) VALUES (?, ?, ?, ?)`
    ).run(sessionId, seq, text, ts);
    return;
  }

  let data = readJsonStore(sessionId);
  if (!data) {
    data = {
      session: {
        id: sessionId,
        started_at: ts,
        ended_at: null,
        repo,
        prompt_count: 0,
      },
      prompts: [],
      nextPromptId: 1,
    };
  }
  data.session.prompt_count = (data.session.prompt_count || 0) + 1;
  if (repo) data.session.repo = repo;
  const id = data.nextPromptId++;
  data.prompts.push({
    id,
    session_id: sessionId,
    seq,
    text,
    timestamp: ts,
    type: null,
    influence: null,
    drift: null,
    spec_coverage: null,
    decision: null,
  });
  writeJsonStore(sessionId, data);
}

export function getSessionPrompts(sessionId) {
  if (sqlite) {
    return db
      .prepare(
        `SELECT id, session_id, seq, text, timestamp, type, influence, drift, spec_coverage, decision
         FROM prompts WHERE session_id = ? ORDER BY seq ASC`
      )
      .all(sessionId);
  }
  const data = readJsonStore(sessionId);
  if (!data) return [];
  return [...data.prompts].sort((a, b) => a.seq - b.seq);
}

export function updatePromptScores(id, scores) {
  if (sqlite) {
    db.prepare(
      `UPDATE prompts SET type = ?, influence = ?, drift = ?, spec_coverage = ?, decision = ?
       WHERE id = ?`
    ).run(
      scores.type,
      scores.influence,
      scores.drift,
      scores.spec_coverage,
      scores.decision,
      id
    );
    const row = db.prepare(`SELECT session_id FROM prompts WHERE id = ?`).get(id);
    if (row) maybeFinalizeSession(row.session_id);
    return;
  }

  const found = findJsonByPromptRowId(id);
  if (!found) return;
  const { data, sessionId } = found;
  const p = data.prompts.find((x) => x.id === id);
  if (!p) return;
  p.type = scores.type;
  p.influence = scores.influence;
  p.drift = scores.drift;
  p.spec_coverage = scores.spec_coverage;
  p.decision = scores.decision;
  const allScored = data.prompts.every((x) => x.type != null);
  if (allScored) {
    data.session.ended_at = Date.now();
  }
  writeJsonStore(sessionId, data);
}

export function getAllSessions() {
  if (sqlite) {
    return db
      .prepare(
        `SELECT id, started_at, ended_at, repo, prompt_count FROM sessions ORDER BY started_at DESC`
      )
      .all();
  }
  if (!fs.existsSync(sessionsDir)) return [];
  const out = [];
  for (const f of fs.readdirSync(sessionsDir)) {
    if (!f.endsWith('.json')) continue;
    const data = JSON.parse(fs.readFileSync(path.join(sessionsDir, f), 'utf8'));
    if (data.session) out.push(data.session);
  }
  out.sort((a, b) => b.started_at - a.started_at);
  return out;
}
