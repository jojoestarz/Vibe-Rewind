#!/usr/bin/env node
/**
 * Automated check: prompts persist on beforeSubmitPrompt (simulated) before stop;
 * data remains queryable; stop enriches scores and writes DECISIONS.md.
 * Run from repo root: node scripts/verify-persistence.mjs
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);

const sessionId = `verify-persist-${Date.now()}`;
const workspaceRoot = root;
const payloadSubmit = (text, ts) =>
  JSON.stringify({
    conversation_id: sessionId,
    prompt_text: text,
    timestamp: ts,
    hook_event_name: 'beforeSubmitPrompt',
    workspace_roots: [workspaceRoot],
  });

function runHook(relScript, stdinStr) {
  const r = spawnSync(process.execPath, [relScript], {
    input: stdinStr,
    encoding: 'utf8',
    cwd: root,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

async function main() {
  const db = await import('../promptlog/db.js');

  // --- Todo 1: submit without stop ---
  const t1 = Date.now();
  const r1 = runHook(
    '.cursor/hooks/on-prompt.js',
    payloadSubmit('verify step 1 — before stop', t1)
  );
  if (r1.status !== 0) {
    console.error('on-prompt exit', r1.status, r1.stderr);
    process.exit(1);
  }
  if (!r1.stdout.includes('"continue"') && !r1.stdout.includes('true')) {
    console.error('on-prompt stdout missing continue:', r1.stdout);
    process.exit(1);
  }

  const sessions = db.getAllSessions();
  const sess = sessions.find((s) => s.id === sessionId);
  if (!sess) {
    console.error('Expected session row after on-prompt, got:', sessions);
    process.exit(1);
  }

  let prompts = db.getSessionPrompts(sessionId);
  if (prompts.length !== 1 || prompts[0].text !== 'verify step 1 — before stop') {
    console.error('Expected one unscored prompt, got:', prompts);
    process.exit(1);
  }
  if (prompts[0].type != null) {
    console.error('Expected type null before stop, got', prompts[0].type);
    process.exit(1);
  }
  console.log('verify-submit: OK (row persisted before stop, scores null)');

  // --- Todo 2: data on disk without running stop again ---
  const dbPath = process.env.PROMPTLOG_DB ?? path.join(root, 'promptlog.db');
  if (fs.existsSync(dbPath)) {
    const st = fs.statSync(dbPath);
    if (!st.size) {
      console.error('promptlog.db empty');
      process.exit(1);
    }
  }
  const again = db.getSessionPrompts(sessionId);
  if (again.length !== 1) {
    console.error('verify-survive: expected row still present');
    process.exit(1);
  }
  console.log('verify-survive: OK (prompt still queryable on disk)');

  // --- Todo 3: stop enriches ---
  const stopPayload = JSON.stringify({
    conversation_id: sessionId,
    hook_event_name: 'stop',
    workspace_roots: [workspaceRoot],
  });
  const r2 = runHook('.cursor/hooks/on-stop.js', stopPayload);
  if (r2.status !== 0) {
    console.error('on-stop exit', r2.status, r2.stderr);
    process.exit(1);
  }
  if (!r2.stderr.includes('Promptlog: session scored')) {
    console.warn('on-stop stderr (expected log line):', r2.stderr);
  }

  prompts = db.getSessionPrompts(sessionId);
  if (!prompts.length || prompts[0].type == null) {
    console.error('Expected scored prompt after stop, got:', prompts);
    process.exit(1);
  }

  const decisionsPath = path.join(workspaceRoot, 'DECISIONS.md');
  if (!fs.existsSync(decisionsPath)) {
    console.error('Missing DECISIONS.md after stop');
    process.exit(1);
  }
  const dec = fs.readFileSync(decisionsPath, 'utf8');
  if (!dec.includes(sessionId) && !dec.includes('verify step 1')) {
    console.warn('DECISIONS.md may be from another session; check manually');
  }
  console.log('verify-stop: OK (scores written, DECISIONS.md present)');
  console.log('All persistence checks passed.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
