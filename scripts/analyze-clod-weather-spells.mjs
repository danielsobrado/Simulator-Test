import fs from 'fs';
import path from 'path';

const clod = process.argv[2];
const roots = ['src/weather', 'src/spells'];
const seen = new Set();
const external = new Set();

function walk(file) {
  const abs = path.resolve(file);
  if (seen.has(abs)) return;
  seen.add(abs);
  if (!fs.existsSync(abs)) {
    external.add(file);
    return;
  }
  const text = fs.readFileSync(abs, 'utf8');
  for (const m of text.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
    const spec = m[1];
    if (!spec.startsWith('.')) {
      external.add(spec);
      continue;
    }
    let next = path.resolve(path.dirname(abs), spec.replace(/\?raw$/, ''));
    if (!next.endsWith('.ts') && !next.endsWith('.js')) {
      if (fs.existsSync(`${next}.ts`)) next = `${next}.ts`;
      else if (fs.existsSync(`${next}.js`)) next = `${next}.js`;
    }
    walk(next);
  }
}

for (const r of roots) {
  const dir = path.join(clod, r);
  for (const f of fs.readdirSync(dir)) {
    if (/\.(ts|js)$/.test(f) && !f.includes('.test.')) walk(path.join(dir, f));
  }
}

const outside = [...seen].filter((f) => !/[\\/]weather[\\/]/.test(f) && !/[\\/]spells[\\/]/.test(f));
console.log('files', seen.size);
console.log('OUTSIDE');
outside.forEach((f) => console.log(path.relative(clod, f)));
console.log('PKG');
[...external].sort().forEach((e) => console.log(e));
