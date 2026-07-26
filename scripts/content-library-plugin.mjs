import fs from 'node:fs/promises';
import path from 'node:path';

const CONTENT_DIRECTORIES = Object.freeze(['maps', 'settings']);
const MIME_TYPES = Object.freeze({
  '.csv': 'text/csv; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/octet-stream',
  '.png': 'image/png',
});

/**
 * Turns a reference such as `/maps/Eldara Full 2026.json` or `../maps/x.json`
 * into a content path, resolved the same way the browser resolves it: against
 * the document that holds the reference. External URLs and anything outside the
 * content directories return null — they are served elsewhere or a mistake.
 */
function contentPath(url, fromPath = '/') {
  if (typeof url !== 'string' || url.length === 0) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) return null;
  let resolved;
  try {
    resolved = new URL(url, `http://content.invalid${fromPath}`);
  } catch {
    return null;
  }
  const segments = decodeURIComponent(resolved.pathname)
    .split('/')
    .filter((segment) => segment.length > 0);
  const [directoryName, ...rest] = segments;
  if (!CONTENT_DIRECTORIES.includes(directoryName) || rest.length === 0) return null;
  return { directoryName, relative: rest.join('/') };
}

function manifestReferences(manifest) {
  return CONTENT_DIRECTORIES
    .flatMap((key) => (Array.isArray(manifest?.[key]) ? manifest[key] : []))
    .map((entry) => entry?.url);
}

function safeFile(root, relative) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relative);
  return resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}${path.sep}`)
    ? resolved
    : null;
}

/**
 * Keeps author-facing `maps/` and `settings/` folders as the canonical content
 * library. Vite serves them in development and emits the same paths in builds,
 * without duplicating multi-megabyte map sources under `public/`.
 */
export function contentLibraryPlugin(projectRoot) {
  return {
    name: 'simcity-dnd-content-library',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        try {
          const pathname = decodeURIComponent(
            new URL(request.url ?? '/', 'http://localhost').pathname,
          );
          const directoryName = CONTENT_DIRECTORIES.find(
            (candidate) => pathname === `/${candidate}`
              || pathname.startsWith(`/${candidate}/`),
          );
          if (!directoryName) {
            next();
            return;
          }
          const relative = pathname.slice(directoryName.length + 2);
          const file = safeFile(path.join(projectRoot, directoryName), relative);
          if (!file) {
            response.statusCode = 400;
            response.end('Invalid content-library path.');
            return;
          }
          const stat = await fs.stat(file).catch(() => null);
          if (!stat?.isFile()) {
            next();
            return;
          }
          response.statusCode = 200;
          response.setHeader(
            'Content-Type',
            MIME_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
          );
          response.end(await fs.readFile(file));
        } catch (error) {
          next(error);
        }
      });
    },
    /**
     * Only manifest-reachable content is emitted. `maps/` doubles as the raw
     * authoring folder — superseded exports, `.map` sources and preview PNGs add
     * tens of megabytes that no dropdown can reach, so shipping the whole tree
     * would bloat every deploy with files the app never requests.
     */
    async generateBundle() {
      const emitted = new Set();
      const pending = [];
      const emit = async (directoryName, relative) => {
        const fileName = `${directoryName}/${relative}`;
        if (emitted.has(fileName)) return null;
        const file = safeFile(path.join(projectRoot, directoryName), relative);
        const source = file ? await fs.readFile(file).catch(() => null) : null;
        if (!source) {
          this.warn(`Content library reference "${fileName}" does not exist; skipping.`);
          return null;
        }
        emitted.add(fileName);
        this.emitFile({ type: 'asset', fileName, source });
        return source;
      };

      for (const directoryName of CONTENT_DIRECTORIES) {
        const source = await emit(directoryName, 'manifest.json');
        if (!source) continue;
        let manifest;
        try {
          manifest = JSON.parse(source.toString('utf8'));
        } catch (error) {
          this.warn(`Content library manifest "${directoryName}/manifest.json" is not valid JSON: ${error.message}`);
          continue;
        }
        const from = `/${directoryName}/manifest.json`;
        pending.push(...manifestReferences(manifest).map((url) => ({ url, from })));
      }

      // Settings documents may point at a map in `maps/`, so follow one level of
      // reference rather than requiring authors to list it twice.
      while (pending.length > 0) {
        const { url, from } = pending.pop();
        const reference = contentPath(url, from);
        if (!reference) continue;
        const source = await emit(reference.directoryName, reference.relative);
        // Map exports are multi-megabyte and reference nothing, so only settings
        // documents are worth parsing.
        if (!source || reference.directoryName !== 'settings') continue;
        const settingsPath = `/${reference.directoryName}/${reference.relative}`;
        try {
          const document = JSON.parse(source.toString('utf8'));
          if (document?.map?.url) pending.push({ url: document.map.url, from: settingsPath });
        } catch (error) {
          this.warn(`Settings document "${settingsPath}" is not valid JSON: ${error.message}`);
        }
      }
    },
  };
}
