// Persistência em arquivos JSON dentro de data/ (versionados no git, sem banco).
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

export function createStore(dir) {
  return {
    dir,
    async read(name, fallback) {
      try {
        return JSON.parse(await readFile(path.join(dir, name), 'utf8'));
      } catch (error) {
        if (error.code === 'ENOENT') return fallback;
        throw new Error(`Não consegui ler ${name}: ${error.message}`);
      }
    },
    async write(name, data) {
      await mkdir(dir, { recursive: true });
      const file = path.join(dir, name);
      const tmp = `${file}.tmp`;
      await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
      await rename(tmp, file); // escrita atômica: nunca deixa JSON pela metade
    },
  };
}
