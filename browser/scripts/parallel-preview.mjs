import { fileURLToPath } from 'node:url';
import { startParallelPreview } from '../dev/parallel-preview/server.mjs';
import { scopes } from '../dev/parallel-preview/scopes.mjs';

const args = process.argv.slice(2);
let root = fileURLToPath(new URL('../', import.meta.url));
let port = 5185;
const seen = new Set();
for (let index = 0; index < args.length; index += 2) {
  const flag = args[index];
  const value = args[index + 1];
  if (!value || !['--root', '--port'].includes(flag) || seen.has(flag)
    || (flag === '--port' && !/^\d+$/.test(value))) {
    throw new Error('Usage: npm run dev -- [--port PORT] [--root PROJECT_DIRECTORY]');
  }
  seen.add(flag);
  if (flag === '--root') root = value;
  else port = Number(value);
}
const preview = await startParallelPreview({ root, port, scopes, defaultRoute: '/' });
console.log(`a long table: ${preview.url}/#/\nSource: ${root}\nUpdates are held per tab by default. Applying or reloading resets unsaved runtime state.`);
const shutdown = () => {
  preview.close().catch(error => {
    console.error('[parallel preview] Could not shut down cleanly.', error);
    process.exitCode = 1;
  });
};
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
