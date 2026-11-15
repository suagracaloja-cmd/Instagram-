#!/usr/bin/env node
// Entrada da coleta diária. Variáveis de ambiente:
//   APIFY_TOKEN          (obrigatória) token da Apify
//   ANTHROPIC_API_KEY    (opcional)    habilita a análise do gancho dos posts que bombaram
//   ANALYSIS_MODEL       (opcional)    modelo do Claude (padrão: claude-opus-5-5)
//   WHISPER_MODEL        (opcional)    modelo do faster-whisper (padrão: small)
//   DATA_DIR             (opcional)    pasta dos JSON (padrão: ./data)
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeHook } from './lib/analyze.mjs';
import { normalizeItems, scrapeProfiles } from './lib/apify.mjs';
import { runCollection } from './lib/run.mjs';
import { createStore } from './lib/store.mjs';
import { transcribeVideo } from './lib/transcribe.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const token = process.env.APIFY_TOKEN;

const log = (message) => console.log(message);
const store = createStore(process.env.DATA_DIR || path.join(root, 'data'));

if (!token) {
  // Sem token a coleta falha, mas a falha é registrada em data/meta.json e aparece no painel.
  log('ERRO: APIFY_TOKEN não está configurado. No GitHub: Settings > Secrets and variables > Actions > New repository secret.');
}

const result = await runCollection({
  store,
  log,
  scrape: async (handles) => {
    if (!token) {
      throw new Error('APIFY_TOKEN não está configurado no GitHub (Settings > Secrets and variables > Actions).');
    }
    return normalizeItems(await scrapeProfiles(handles, { token, log }), handles);
  },
  transcribe: (videoUrl) => transcribeVideo(videoUrl, { log }),
  analyze: (entry, transcript) => analyzeHook(entry, transcript),
});

process.exit(result.exitCode);
