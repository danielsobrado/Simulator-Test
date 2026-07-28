import path from 'node:path';

export function resolveQaOutputDirectory(root, requestedPath, defaultName) {
  const repositoryRoot = path.resolve(root);
  const temporaryRoot = path.join(repositoryRoot, 'tmp');
  const outputDirectory = requestedPath == null
    ? path.join(temporaryRoot, defaultName)
    : path.resolve(repositoryRoot, requestedPath);
  const relative = path.relative(temporaryRoot, outputDirectory);
  const outsideTemporaryRoot = relative === '..'
    || relative.startsWith(`..${path.sep}`)
    || path.isAbsolute(relative);
  if (!relative || outsideTemporaryRoot) {
    throw new Error('QA output directory must be a child of the repository tmp directory.');
  }
  return outputDirectory;
}

export function normaliseQaBaseUrl(value) {
  if (value == null) return null;
  const url = new URL(value);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('QA base URL must use HTTP or HTTPS.');
  }
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/\/$/, '') || '/';
  return url.toString().replace(/\/$/, '');
}
