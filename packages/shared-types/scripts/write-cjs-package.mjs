// The package is ESM by default ("type": "module"). The CommonJS build lives in
// dist/cjs and needs its own package.json so Node treats those files as CJS.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const target = join(here, '..', 'dist', 'cjs');

await mkdir(target, { recursive: true });
await writeFile(join(target, 'package.json'), `${JSON.stringify({ type: 'commonjs' }, null, 2)}\n`);
