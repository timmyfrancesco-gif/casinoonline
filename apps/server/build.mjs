// Bundles src/index.ts -> dist/index.js. The @casino/* workspace packages (TypeScript sources)
// and their own dependencies are bundled; the server's npm dependencies stay external and are
// resolved from apps/server/node_modules at runtime. Migrations are copied to dist/migrations.
import { build } from 'esbuild';
import { cpSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const external = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter(
  (name) => !name.startsWith('@casino/'),
);
const outdir = join(root, 'dist');

rmSync(outdir, { recursive: true, force: true });

await build({
  entryPoints: [join(root, 'src/index.ts')],
  outfile: join(outdir, 'index.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  external,
  logLevel: 'info',
  legalComments: 'none',
});

cpSync(join(root, 'migrations'), join(outdir, 'migrations'), { recursive: true });
