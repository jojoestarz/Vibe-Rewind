import fs from 'fs';
import path from 'path';
import { hookDebug } from './debug.mjs';

function respondContinue() {
  process.stdout.write(JSON.stringify({ continue: true }));
}

try {
  const raw = fs.readFileSync(0, 'utf8');
  const payload = JSON.parse(raw);
  const roots = payload.workspace_roots;
  const workspaceRoot =
    Array.isArray(roots) && roots[0] ? roots[0] : process.cwd();
  const cid = payload.conversation_id;

  hookDebug('stop', workspaceRoot, {
    conversation_id: cid,
  });

  const db = await import(new URL('../../promptlog/db.js', import.meta.url));
  const scorer = await import(new URL('../../promptlog/scorer.js', import.meta.url));
  const { resolveIntent } = await import(
    new URL('../../promptlog/intent-resolve.js', import.meta.url)
  );

  let prompts = await db.getSessionPrompts(cid);
  if (!prompts.length) {
    respondContinue();
  } else {
    prompts.sort((a, b) => a.seq - b.seq);
    let projectIntent = resolveIntent(workspaceRoot);
    if (projectIntent == null || projectIntent.trim() === '') {
      const first = prompts.find((p) => p.seq === 1) ?? prompts[0];
      projectIntent = first?.text ?? '';
    }
    process.env.PROMPTLOG_PROJECT_INTENT = projectIntent;

    const unscored = prompts.filter((p) => p.type == null);
    if (unscored.length > 0) {
      const batch = unscored.map((p) => ({ seq: p.seq, text: p.text }));
      const scored = await scorer.score(batch, projectIntent);
      const bySeq = new Map(scored.map((r) => [r.seq, r]));
      for (const p of unscored) {
        const r = bySeq.get(p.seq);
        if (!r) continue;
        await db.updatePromptScores(p.id, {
          type: r.type,
          influence: r.influence,
          drift: r.drift,
          spec_coverage: r.spec_coverage,
          decision: r.decision,
        });
      }
    }

    prompts = await db.getSessionPrompts(cid);
    prompts.sort((a, b) => a.seq - b.seq);

    const peakDrift = prompts.reduce((m, p) => Math.max(m, p.drift ?? 0), 0);
    const last = prompts[prompts.length - 1];
    const finalSpec = last?.spec_coverage ?? 0;

    const influential = prompts.filter((p) => (p.influence ?? 0) >= 40);
    let markdown;
    if (influential.length === 0) {
      markdown = 'No high-influence decisions recorded in this session.';
    } else {
      const lines = [];
      lines.push(`# Decisions — ${cid} · ${new Date().toISOString().slice(0, 10)}`);
      lines.push('');
      lines.push(`**Project intent (drift anchor):** ${projectIntent}`);
      lines.push(
        `**Prompts:** ${prompts.length} · **Peak drift:** ${peakDrift}% · **Spec coverage:** ${finalSpec}%`
      );
      lines.push('');
      lines.push('## Decisions');
      lines.push('');
      for (const p of influential) {
        lines.push(`### P${p.seq} · ${p.type} · ${p.influence}% influence`);
        lines.push(`> "${String(p.text).replace(/"/g, '\\"')}"`);
        lines.push('');
        lines.push(String(p.decision ?? ''));
        lines.push('');
        lines.push('---');
        lines.push('');
      }
      markdown = lines.join('\n');
    }

    const outPath = path.join(workspaceRoot, 'DECISIONS.md');
    fs.writeFileSync(outPath, markdown, 'utf8');

    console.error('Promptlog: session scored. Run npm start to view replay.');
    respondContinue();
  }
} catch (e) {
  console.error(e);
  respondContinue();
}
