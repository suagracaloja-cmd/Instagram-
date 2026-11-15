#!/usr/bin/env node
// Copia data/*.json para web/public/data/ (o site estático lê os dados de lá).
// DATA_DIR permite apontar para outra pasta (usado nos testes locais).
import { cp, mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const from = process.env.DATA_DIR || path.join(root, 'data');
const to = path.join(root, 'web', 'public', 'data');

await rm(to, { recursive: true, force: true });
await mkdir(to, { recursive: true });
let copied = 0;
for (const name of await readdir(from)) {
  if (!name.endsWith('.json')) continue;
  await cp(path.join(from, name), path.join(to, name));
  copied += 1;
}
console.log(`sync-data: ${copied} arquivo(s) de ${from} -> web/public/data`);
