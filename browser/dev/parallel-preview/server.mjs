import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, readdir, realpath } from 'node:fs/promises';
import { extname, join, relative, resolve } from 'node:path';
import { build, normalizePath } from 'vite';

const endpoint = '/__parallel_preview';
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export function affectedRoutes(files, scopes) {
  if (!files.length) return null;
  const routes = new Set();
  for (const file of files) {
    const matches = scopes.filter(candidate => candidate.files.some(pattern =>
      pattern.endsWith('/**') ? file.startsWith(pattern.slice(0, -2)) : pattern === file));
    if (!matches.length) return null;
    for (const scope of matches) {
      for (const route of scope.routes) routes.add(route);
    }
  }
  return [...routes];
}

async function publicAssets(directory, addWatchFile) {
  const assets = new Map();
  async function visit(folder) {
    addWatchFile(folder);
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        addWatchFile(path);
        assets.set(normalizePath(relative(directory, path)), await readFile(path));
      }
    }
  }
  await visit(directory);
  return assets;
}

/**
 * Watched builds deliberately have no Vite HMR client. Tabs keep their loaded
 * code, including across server reconnects, until their own controller reloads.
 */
export async function startParallelPreview({
  root,
  port = 5190,
  scopes = [],
  routeMode = 'hash',
  defaultRoute,
  configFile,
}) {
  root = await realpath(resolve(root));
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Preview port must be between 0 and 65535.');
  if (!['hash', 'pathname'].includes(routeMode)) throw new Error('Route mode must be hash or pathname.');
  if (defaultRoute !== undefined && (routeMode !== 'hash' || typeof defaultRoute !== 'string' || !defaultRoute.startsWith('/'))) {
    throw new Error('A default preview route must be an absolute hash route.');
  }
  for (const scope of scopes) {
    if (!scope.files.length || !scope.routes.length) throw new Error('Each preview scope needs files and routes.');
  }
  const scopedFiles = scopes.flatMap(scope => scope.files);
  if (new Set(scopedFiles).size !== scopedFiles.length) throw new Error('A preview file cannot belong to multiple scopes.');

  const controller = await readFile(new URL('./client.js', import.meta.url));
  const clients = new Set();
  const assets = new Map();
  const changes = new Set();
  let snapshot;
  let pending;
  let buildingFiles = [];
  let buildVersion;
  let resolvedPublicDir;
  let nextPublicFiles;
  let buildError;
  let building = true;
  let watcher;
  let closed = false;
  const send = (response, event) => response.write(`data: ${JSON.stringify(event)}\n\n`);
  const broadcast = event => {
    for (const response of clients) send(response, event);
  };

  const server = createServer((request, response) => {
    const address = server.address();
    if (closed || !address) {
      response.writeHead(503).end('The preview is shutting down.');
      return;
    }
    const allowedHosts = [`127.0.0.1:${address.port}`, `localhost:${address.port}`];
    if (!allowedHosts.includes(request.headers.host)) {
      response.writeHead(403).end('This preview only accepts local requests.');
      return;
    }
    if (request.headers.origin && !allowedHosts.some(host => request.headers.origin === `http://${host}`)) {
      response.writeHead(403).end('Cross-origin preview requests are not allowed.');
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end('Use GET or HEAD.');
      return;
    }
    let path;
    try {
      path = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    } catch (error) {
      if (!(error instanceof URIError || error instanceof TypeError)) throw error;
      response.writeHead(400).end('The preview URL is invalid.');
      return;
    }
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (path === `${endpoint}/events` && request.method === 'GET') {
      response.writeHead(200, { 'Content-Type': 'text/event-stream', Connection: 'keep-alive' });
      clients.add(response);
      send(response, { type: 'hello', version: snapshot?.version, routeMode, building, error: buildError });
      response.on('close', () => clients.delete(response));
      return;
    }
    if (path === `${endpoint}/client.js`) {
      response.writeHead(200, { 'Content-Type': contentTypes['.js'] });
      response.end(request.method === 'HEAD' ? undefined : controller);
      return;
    }
    if (!snapshot) {
      response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': '1' });
      response.end(request.method === 'HEAD' ? undefined : 'The preview is building. Reload when it is ready.');
      return;
    }
    const isAppRoute = path === '/' || routeMode === 'pathname'
      && request.headers.accept?.includes('text/html') && !extname(path) && !path.startsWith(endpoint);
    const file = isAppRoute ? 'index.html' : path.slice(1);
    const bytes = assets.get(file) ?? snapshot.publicFiles.get(file);
    if (bytes === undefined) {
      response.writeHead(404).end('This preview asset does not exist.');
      return;
    }
    response.writeHead(200, { 'Content-Type': contentTypes[extname(file)] ?? 'application/octet-stream' });
    response.end(request.method === 'HEAD' ? undefined : bytes);
  });
  const heartbeat = setInterval(() => {
    for (const response of clients) response.write(': keep-alive\n\n');
  }, 15000);
  heartbeat.unref();

  async function close() {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    for (const response of clients) response.end();
    if (watcher) await watcher.close();
    await new Promise((resolveClose, reject) => {
      server.close(error => error ? reject(error) : resolveClose());
      server.closeIdleConnections();
    });
  }

  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolveListen);
  });
  const url = `http://127.0.0.1:${server.address().port}`;

  try {
    watcher = await build({
      root,
      configFile,
      mode: 'development',
      base: '/',
      logLevel: 'warn',
      define: { 'import.meta.env.DEV': true, 'import.meta.env.PROD': false },
      build: { write: false, watch: {}, minify: false, sourcemap: true },
      plugins: [{
        name: 'parallel-preview',
        enforce: 'post',
        configResolved(config) {
          resolvedPublicDir = config.publicDir;
        },
        watchChange(file) {
          changes.add(normalizePath(relative(root, file)));
        },
        async buildStart() {
          building = true;
          buildVersion = randomUUID();
          buildingFiles = [...changes];
          changes.clear();
          pending = undefined;
          broadcast({ type: 'building', files: buildingFiles });
          nextPublicFiles = resolvedPublicDir
            ? await publicAssets(resolvedPublicDir, path => this.addWatchFile(path))
            : new Map();
        },
        transformIndexHtml: {
          order: 'post',
          handler() {
            return [
              ...(defaultRoute ? [{
                tag: 'script',
                children: `if (!location.hash) history.replaceState(history.state, '', ${JSON.stringify(`#${defaultRoute}`)});`,
                injectTo: 'head-prepend',
              }] : []),
              { tag: 'meta', attrs: { name: 'parallel-preview-version', content: buildVersion }, injectTo: 'head' },
              { tag: 'script', attrs: { type: 'module', src: `${endpoint}/client.js` }, injectTo: 'body' },
            ];
          },
        },
        generateBundle: {
          order: 'post',
          handler(_options, bundle) {
            const files = new Map();
            for (const [name, output] of Object.entries(bundle)) {
              files.set(name, Buffer.from(output.type === 'chunk' ? output.code : output.source));
            }
            pending = {
              version: buildVersion,
              files,
              publicFiles: nextPublicFiles,
              routes: affectedRoutes([...new Set([...buildingFiles, ...changes])], scopes),
              changedFiles: [...new Set([...buildingFiles, ...changes])],
            };
          },
        },
      }],
    });
    let ready;
    let failStartup;
    const firstBuild = new Promise((resolveReady, reject) => {
      ready = resolveReady;
      failStartup = reject;
    });
    watcher.on('event', event => {
      if (event.code === 'ERROR') {
        for (const file of buildingFiles) changes.add(file);
        building = false;
        buildError = event.error.message;
        console.error(`[parallel preview] Build failed: ${buildError}`);
        broadcast({ type: 'error', message: buildError });
        if (!snapshot) failStartup(event.error);
      } else if (event.code === 'BUNDLE_END') {
        const complete = pending;
        event.result.close().then(() => {
          if (!complete || closed) return;
          for (const [name, bytes] of complete.files) assets.set(name, bytes);
          snapshot = complete;
          building = false;
          buildError = undefined;
          broadcast({ type: 'update', version: complete.version, routes: complete.routes, files: complete.changedFiles });
          ready();
        }).catch(error => {
          building = false;
          buildError = error.message;
          console.error(`[parallel preview] Could not finish build: ${buildError}`);
          broadcast({ type: 'error', message: buildError });
          if (!snapshot) failStartup(error);
        });
      }
    });
    await firstBuild;
  } catch (error) {
    await close();
    throw error;
  }
  return { url, close };
}
