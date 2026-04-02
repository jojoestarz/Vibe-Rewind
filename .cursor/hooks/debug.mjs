import fs from 'fs';
import path from 'path';

/**
 * Append one JSON line to <workspace>/.cursor/hook-debug.log (for verifying hooks run).
 */
export function hookDebug(hookName, workspaceRoot, fields = {}) {
  const root =
    workspaceRoot && String(workspaceRoot).trim()
      ? workspaceRoot
      : process.cwd();
  const logPath = path.join(root, '.cursor', 'hook-debug.log');
  const line = JSON.stringify({
    t: new Date().toISOString(),
    hook: hookName,
    cwd: process.cwd(),
    ...fields,
  });
  try {
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `${line}\n`, 'utf8');
  } catch {
    /* ignore */
  }
}
