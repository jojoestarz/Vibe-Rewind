import fs from 'fs';
import path from 'path';

/**
 * Resolution order: SPEC.md → PRD.md → README.md (first 500 chars) → .promptlog/intent.md → null
 * @param {string} workspaceRoot
 * @returns {string | null}
 */
export function resolveIntent(workspaceRoot) {
  const root = path.resolve(workspaceRoot);

  function readFile(relParts) {
    const p = path.join(root, ...relParts);
    try {
      if (!fs.existsSync(p) || !fs.statSync(p).isFile()) return null;
      return fs.readFileSync(p, 'utf8');
    } catch {
      return null;
    }
  }

  const spec = readFile(['SPEC.md']);
  if (spec?.trim()) return spec.trim();

  const prd = readFile(['PRD.md']);
  if (prd?.trim()) return prd.trim();

  const readme = readFile(['README.md']);
  if (readme?.trim()) {
    const t = readme.trim();
    return t.length <= 500 ? t : t.slice(0, 500);
  }

  const intentMd = readFile(['.promptlog', 'intent.md']);
  if (intentMd?.trim()) return intentMd.trim();

  return null;
}
