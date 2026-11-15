// Baixa o vídeo do post e transcreve o áudio com Whisper local (faster-whisper).
// Se qualquer etapa falhar, devolve status "unavailable" com o motivo real — nunca inventa texto.
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'whisper_transcribe.py');
const MAX_BYTES = 80 * 1024 * 1024;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

export async function downloadVideo(url, { fetchImpl = fetch, timeoutMs = 90_000 } = {}) {
  let res;
  try {
    res = await fetchImpl(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'video/*,*/*;q=0.8' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const why = error?.name === 'TimeoutError' ? 'tempo esgotado' : error?.cause?.code ?? error?.message ?? 'erro desconhecido';
    return { ok: false, reason: `falha de rede (${why})` };
  }
  if (!res.ok) return { ok: false, reason: `o CDN do Instagram recusou o download do vídeo (HTTP ${res.status})` };

  const type = res.headers.get('content-type') ?? '';
  if (!/^(video\/|application\/octet-stream)/i.test(type)) {
    return { ok: false, reason: `o link não devolveu um vídeo (content-type: ${type || 'desconhecido'})` };
  }
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    return { ok: false, reason: 'o vídeo é grande demais para transcrever (mais de 80 MB)' };
  }
  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.length === 0) return { ok: false, reason: 'o download do vídeo veio vazio' };
  if (buffer.length > MAX_BYTES) return { ok: false, reason: 'o vídeo é grande demais para transcrever (mais de 80 MB)' };
  return { ok: true, buffer };
}

async function runWhisper(file, { exec, python, log }) {
  const run = () =>
    exec(python, [SCRIPT, file], { timeout: 15 * 60 * 1000, maxBuffer: 10 * 1024 * 1024, env: process.env });
  try {
    return await run();
  } catch (error) {
    const output = `${error?.stderr ?? ''}${error?.message ?? ''}`;
    if (/No module named ['"]?faster_whisper/.test(output)) {
      log('Instalando faster-whisper (primeira vez)…');
      await exec(python, ['-m', 'pip', 'install', '--quiet', '--user', 'faster-whisper'], {
        timeout: 10 * 60 * 1000,
        maxBuffer: 10 * 1024 * 1024,
        env: { ...process.env, PIP_BREAK_SYSTEM_PACKAGES: '1' },
      });
      return run();
    }
    throw error;
  }
}

/**
 * @returns {Promise<{status: 'ok', text: string, language: string|null}
 *   | {status: 'no_speech'} | {status: 'unavailable', note: string}>}
 */
export async function transcribeVideo(videoUrl, options = {}) {
  const {
    fetchImpl = fetch,
    exec = execFileAsync,
    python = process.env.PYTHON || 'python3',
    log = () => {},
  } = options;

  const downloaded = await downloadVideo(videoUrl, { fetchImpl });
  if (!downloaded.ok) {
    return { status: 'unavailable', note: `Não foi possível baixar o vídeo: ${downloaded.reason}.` };
  }

  const dir = await mkdtemp(path.join(tmpdir(), 'igmon-'));
  try {
    const file = path.join(dir, 'video.mp4');
    await writeFile(file, downloaded.buffer);
    const { stdout } = await runWhisper(file, { exec, python, log });
    const line = String(stdout).trim().split('\n').filter(Boolean).pop() ?? '';
    const parsed = JSON.parse(line);
    const text = typeof parsed.text === 'string' ? parsed.text.trim() : '';
    if (!text) return { status: 'no_speech' };
    return { status: 'ok', text, language: typeof parsed.language === 'string' ? parsed.language : null };
  } catch (error) {
    const detail = String(error?.stderr ?? error?.message ?? error).trim().split('\n').slice(-1)[0].slice(0, 200);
    return { status: 'unavailable', note: `O vídeo foi baixado, mas a transcrição falhou: ${detail}.` };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
