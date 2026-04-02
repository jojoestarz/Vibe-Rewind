import fs from 'fs';
import { hookDebug } from './debug.mjs';

function respondContinue() {
  process.stdout.write(JSON.stringify({ continue: true }));
}

/** Cursor may use prompt_text, prompt, text, or content; never pass undefined to SQLite (NOT NULL). */
function resolvePromptText(payload) {
  const candidates = [
    ['prompt_text', payload.prompt_text],
    ['prompt', payload.prompt],
    ['text', payload.text],
    ['content', payload.content],
    ['message', payload.message],
  ];
  for (const [key, v] of candidates) {
    if (v == null) continue;
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    if (s.length > 0) return { text: s, key };
  }
  return { text: '[empty prompt]', key: 'fallback' };
}

// #region agent log
function debugLog(payload) {
  const body = {
    sessionId: '02a1b9',
    timestamp: Date.now(),
    ...payload,
  };
  const line = JSON.stringify(body);
  fetch('http://127.0.0.1:7781/ingest/2c6767ca-fab5-4d30-aecf-73e277b8b466', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Debug-Session-Id': '02a1b9',
    },
    body: line,
  }).catch(() => {});
  try {
    fs.appendFileSync(
      '/home/ethan/Projects/Vibe-Rewind/.cursor/debug-02a1b9.log',
      line + '\n'
    );
  } catch {
    /* ignore */
  }
}
// #endregion

try {
  const raw = fs.readFileSync(0, 'utf8');
  const payload = JSON.parse(raw);
  const roots = payload.workspace_roots;
  const workspaceRoot =
    Array.isArray(roots) && roots[0] ? roots[0] : process.cwd();
  process.env.PROMPTLOG_REPO = workspaceRoot;

  // #region agent log
  debugLog({
    location: 'on-prompt.js:entry',
    message: 'hook_start',
    hypothesisId: 'H1',
    data: {
      cwd: process.cwd(),
      PROMPTLOG_DB: process.env.PROMPTLOG_DB ?? null,
      workspace_root0: roots?.[0] ?? null,
      conversation_id: payload.conversation_id ?? null,
      hook_event: payload.hook_event_name ?? null,
      raw_timestamp: payload.timestamp ?? null,
    },
  });
  // #endregion

  const db = await import(new URL('../../promptlog/db.js', import.meta.url));
  const existing = db.getSessionPrompts(payload.conversation_id);
  const seq = existing.length + 1;
  const promptTs =
    typeof payload.timestamp === 'number' &&
    Number.isFinite(payload.timestamp) &&
    payload.timestamp > 0
      ? payload.timestamp
      : Date.now();
  const { text: promptText, key: promptKey } = resolvePromptText(payload);
  hookDebug('beforeSubmitPrompt', workspaceRoot, {
    conversation_id: payload.conversation_id,
    seq,
    textChars: promptText.length,
    promptKey,
  });
  db.insertPrompt(payload.conversation_id, seq, promptText, promptTs);

  // #region agent log
  debugLog({
    location: 'on-prompt.js:after_insert',
    message: 'insert_ok',
    hypothesisId: 'H4',
    data: {
      conversation_id: payload.conversation_id,
      seq,
      existing_count_before: existing.length,
      raw_timestamp: payload.timestamp ?? null,
      promptTs,
      promptKey,
      textLen: promptText.length,
    },
  });
  // #endregion

  respondContinue();
} catch (e) {
  // #region agent log
  debugLog({
    location: 'on-prompt.js:catch',
    message: 'insert_failed_silent_continue',
    hypothesisId: 'H4',
    data: {
      err: e instanceof Error ? e.message : String(e),
      cwd: process.cwd(),
    },
  });
  // #endregion
  respondContinue();
}
