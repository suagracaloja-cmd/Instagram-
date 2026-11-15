// Enriquecimento de um post sinalizado: transcrição (só vídeo) + análise do gancho.
// Regra de ouro: nenhum campo é preenchido com texto que não veio de fonte real.

const MAX_TRANSCRIPT_ATTEMPTS = 5;

/**
 * Atualiza (in place) a transcrição e a análise de uma entrada de flagged.json.
 *
 * @param {object} entry          entrada sinalizada
 * @param {object|null} currentPost  o mesmo post na coleta de hoje (traz o link do vídeo, que expira)
 * @param {{transcribe: Function, analyze: Function, log?: Function}} deps
 */
export async function enrichEntry(entry, currentPost, { transcribe, analyze, log = () => {} }) {
  // 1) Transcrição (só para vídeo)
  if (entry.type !== 'video') {
    entry.transcriptStatus = 'not_applicable';
    entry.transcriptNote = null;
  } else {
    const settled = entry.transcriptStatus === 'ok' || entry.transcriptStatus === 'no_speech';
    if (!settled && entry.transcriptAttempts < MAX_TRANSCRIPT_ATTEMPTS) {
      if (currentPost?.videoUrl) {
        entry.transcriptAttempts += 1;
        let result;
        try {
          result = await transcribe(currentPost.videoUrl);
        } catch (error) {
          result = { status: 'unavailable', note: `Não foi possível transcrever: ${error?.message ?? error}.` };
        }
        if (result.status === 'ok') {
          entry.transcript = result.text;
          entry.transcriptStatus = 'ok';
          entry.transcriptNote = null;
          entry.transcriptLanguage = result.language ?? null;
        } else if (result.status === 'no_speech') {
          entry.transcript = null;
          entry.transcriptStatus = 'no_speech';
          entry.transcriptNote = 'O vídeo não tem fala detectável (música ou sem narração), então não há transcrição.';
        } else {
          entry.transcript = null;
          entry.transcriptStatus = 'unavailable';
          entry.transcriptNote = result.note;
        }
        log(`  transcrição de ${entry.shortCode}: ${entry.transcriptStatus}`);
      } else if (entry.transcriptStatus === 'pending') {
        entry.transcriptStatus = 'unavailable';
        entry.transcriptNote =
          'Não foi possível transcrever: a Apify não devolveu o link do vídeo nesta coleta, então não deu para baixar o áudio.';
      }
    }
  }

  // 2) Análise do gancho
  const hasTranscript = entry.transcriptStatus === 'ok' && Boolean(entry.transcript);
  const needsAnalysis =
    entry.analysisStatus !== 'ok' || (hasTranscript && entry.analysisBasis !== 'transcript+caption');
  if (needsAnalysis) {
    const result = await analyze(entry, hasTranscript ? entry.transcript : null);
    entry.analysisBasis = result.basis;
    if (result.status === 'ok') {
      entry.analysis = result.text;
      entry.analysisStatus = 'ok';
      entry.analysisNote = null;
      entry.analysisModel = result.model ?? null;
      entry.analysisAt = new Date().toISOString();
    } else {
      // Mantém a análise anterior (se houver) em vez de apagar; só registra o motivo.
      entry.analysisStatus = entry.analysis ? entry.analysisStatus : result.status;
      entry.analysisNote = result.note ?? null;
    }
    log(`  análise de ${entry.shortCode}: ${result.status}`);
  }
  return entry;
}
