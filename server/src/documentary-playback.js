import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let allowed;
export function exportedDocumentaryId(id) {
  if (!allowed) {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const manifest = path.join(root, 'client/dist/data/stream-ids.json');
    try { allowed = new Set(JSON.parse(fs.readFileSync(manifest, 'utf8'))); }
    catch { return false; }
  }
  return allowed.has(id);
}
