#!/usr/bin/env node
/**
 * promptlog init — scaffold .cursor hooks, .promptlog/, intent file, optional git commit.
 * Run from your repo root: npx promptlog init (after npm install / linking this package).
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.join(__dirname, '..');

async function promptLines() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const q = (prompt) => new Promise((res) => rl.question(prompt, res));
  console.log(
    'No SPEC.md, PRD.md, README (first 500 chars), or .promptlog/intent.md produced intent text.'
  );
  const a = await q('Write two sentences describing this project (used as drift anchor):\n> ');
  const b = await q('Second sentence (optional, Enter to skip):\n> ');
  rl.close();
  return [a, b].filter((x) => String(x || '').trim()).join(' ').trim();
}

function copyFile(src, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  if (!fs.existsSync(src)) {
    console.warn('promptlog init: missing template', src);
    return;
  }
  fs.copyFileSync(src, dest);
}

async function main() {
  const [cmd] = process.argv.slice(2);
  if (cmd !== 'init') {
    console.log('Usage: promptlog init');
    process.exit(cmd ? 1 : 0);
  }

  const { resolveIntent } = await import('../promptlog/intent-resolve.js');

  const cwd = process.cwd();
  const cursorDir = path.join(cwd, '.cursor');
  const hooksDir = path.join(cursorDir, 'hooks');
  const srcHooks = path.join(pkgRoot, '.cursor', 'hooks');

  copyFile(path.join(pkgRoot, '.cursor', 'hooks.json'), path.join(cursorDir, 'hooks.json'));
  for (const f of ['on-prompt.js', 'on-stop.js', 'debug.mjs']) {
    copyFile(path.join(srcHooks, f), path.join(hooksDir, f));
  }

  const promptlogDir = path.join(cwd, '.promptlog');
  fs.mkdirSync(promptlogDir, { recursive: true });

  let intent = resolveIntent(cwd);
  if (!intent) {
    intent = await promptLines();
  }
  if (!intent) {
    console.warn('promptlog init: empty intent — add .promptlog/intent.md or SPEC.md later.');
  } else {
    const intentPath = path.join(promptlogDir, 'intent.md');
    fs.writeFileSync(intentPath, intent + '\n', 'utf8');
    console.log('Wrote', path.relative(cwd, intentPath));

    const gitDir = path.join(cwd, '.git');
    if (fs.existsSync(gitDir)) {
      let r = spawnSync('git', ['add', '.promptlog/intent.md'], { cwd, encoding: 'utf8' });
      if (r.status !== 0) {
        console.warn('git add failed:', r.stderr || r.stdout);
      } else {
        r = spawnSync(
          'git',
          ['commit', '-m', 'chore: add promptlog project intent'],
          { cwd, encoding: 'utf8' }
        );
        if (r.status !== 0) {
          console.warn('git commit skipped or failed:', r.stderr || r.stdout || '(nothing to commit?)');
        } else {
          console.log('Committed .promptlog/intent.md');
        }
      }
    }
  }

  console.log(
    'promptlog init done. Set SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and GEMINI_API_KEY in .env (optional GEMINI_MODEL).'
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
