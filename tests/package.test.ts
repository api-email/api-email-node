import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { VERSION } from '../src/version';

const root = fileURLToPath(new URL('..', import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? sourceFiles(full) : [full];
  });
}

describe('package', () => {
  it('VERSION matches package.json', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });

  it('points the top-level types field at index.d.ts, which TypeScript 4.6 and older can read', () => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { types: string };
    expect(pkg.types).toBe('./dist/index.d.ts');
  });

  it('src uses no Node-only APIs, so it runs in Bun, Deno and Workers', () => {
    for (const file of sourceFiles(join(root, 'src'))) {
      const text = readFileSync(file, 'utf8');
      expect(text, file).not.toMatch(/\bBuffer\.(from|alloc|concat|isBuffer|byteLength)\b|from ['"]node:|\brequire\(['"]/);
    }
  });
});
