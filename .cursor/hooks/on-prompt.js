import fs from 'fs';

function respondContinue() {
  process.stdout.write(JSON.stringify({ continue: true }));
}

try {
  const raw = fs.readFileSync(0, 'utf8');
  const payload = JSON.parse(raw);
  const roots = payload.workspace_roots;
  process.env.PROMPTLOG_REPO = Array.isArray(roots) && roots[0] ? roots[0] : '';

  const db = await import(new URL('../../promptlog/db.js', import.meta.url));
  const existing = db.getSessionPrompts(payload.conversation_id);
  const seq = existing.length + 1;
  db.insertPrompt(payload.conversation_id, seq, payload.prompt_text, payload.timestamp);
  respondContinue();
} catch {
  respondContinue();
}
