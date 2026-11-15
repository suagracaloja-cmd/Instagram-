import { useState } from 'react';
import { fmtInt, fmtMultiple, fmtPct, fmtPostDate, TYPE_LABEL } from '../lib/format';
import type { FlaggedPost } from '../types';

const PAGE = 10;

function FlaggedCard({ post, colors }: { post: FlaggedPost; colors: Record<string, string> }) {
  const [captionOpen, setCaptionOpen] = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);

  const multiple = post.multipleNow ?? post.multiple;
  const isVideo = post.type === 'video';
  const noTranscript = isVideo && post.transcriptStatus !== 'ok';
  const longCaption = post.caption.length > 180 || post.caption.split('\n').length > 3;

  return (
    <article className="post-card" data-testid="flagged-post">
      <header className="post-head">
        <span className="post-who">
          <span className="key" style={{ background: colors[post.handle] }} aria-hidden="true" />
          <strong>@{post.handle}</strong>
          <span className="badge">{TYPE_LABEL[post.type] ?? 'Post'}</span>
          <span className="muted">{fmtPostDate(post.timestamp)}</span>
        </span>
        <span
          className="multiple"
          title={`Engajamento de ${fmtPct(post.engagement)} contra média de ${fmtPct(post.baseline)} dos outros ${post.baselinePosts} posts do perfil (no dia em que foi sinalizado: ${fmtMultiple(post.multiple)})`}
        >
          <strong>{fmtMultiple(multiple)}</strong> a média
        </span>
      </header>

      <p className={`caption${captionOpen ? '' : ' clamp'}`}>{post.caption.trim() || <span className="muted">(post sem legenda)</span>}</p>
      {longCaption && (
        <button type="button" className="link-btn" aria-expanded={captionOpen} onClick={() => setCaptionOpen((v) => !v)}>
          {captionOpen ? 'Mostrar menos' : 'Ler legenda completa'}
        </button>
      )}

      <p className="post-stats">
        <span>♥ {post.likes == null ? 'curtidas ocultas' : fmtInt(post.likes)}</span>
        <span>💬 {fmtInt(post.comments)}</span>
        <span className="muted">
          {fmtPct(post.engagement)} de engajamento vs {fmtPct(post.baseline)} de média dos outros posts
        </span>
        <a href={post.url} target="_blank" rel="noopener noreferrer">
          Abrir no Instagram ↗
        </a>
      </p>

      {noTranscript && (
        <p className="notice warn" role="note">
          <strong>Sem transcrição.</strong> {post.transcriptNote ?? 'O áudio ainda não foi transcrito.'} A análise usa só a legenda.
        </p>
      )}
      {post.transcriptStatus === 'no_speech' && (
        <p className="notice" role="note">
          {post.transcriptNote}
        </p>
      )}

      <button
        type="button"
        className="expander"
        aria-expanded={analysisOpen}
        onClick={() => setAnalysisOpen((v) => !v)}
      >
        <span>Análise do gancho</span>
        <span className="chev" aria-hidden="true">
          {analysisOpen ? '▾' : '▸'}
        </span>
      </button>
      {analysisOpen && (
        <div className="analysis">
          {post.analysisStatus === 'ok' && post.analysis ? (
            <>
              <p>{post.analysis}</p>
              <p className="muted small">
                {post.analysisBasis === 'transcript+caption'
                  ? 'Baseada na legenda e na transcrição do áudio.'
                  : isVideo
                    ? 'Baseada só na legenda, porque o áudio não foi transcrito.'
                    : 'Baseada só na legenda.'}
              </p>
            </>
          ) : (
            <p className="notice warn">
              <strong>Análise não gerada.</strong> {post.analysisNote ?? 'Ainda não foi processada.'}
            </p>
          )}
        </div>
      )}

      {post.transcriptStatus === 'ok' && post.transcript && (
        <>
          <button
            type="button"
            className="expander"
            aria-expanded={transcriptOpen}
            onClick={() => setTranscriptOpen((v) => !v)}
          >
            <span>Transcrição do vídeo</span>
            <span className="chev" aria-hidden="true">
              {transcriptOpen ? '▾' : '▸'}
            </span>
          </button>
          {transcriptOpen && <blockquote className="analysis transcript">{post.transcript}</blockquote>}
        </>
      )}
    </article>
  );
}

export function FlaggedList({ posts, colors, hasBaseline }: { posts: FlaggedPost[]; colors: Record<string, string>; hasBaseline: boolean }) {
  const [shown, setShown] = useState(PAGE);
  if (posts.length === 0) {
    return (
      <div className="empty" role="status">
        <strong>Nenhum post passou de 2× a média ainda.</strong>
        <span>
          {hasBaseline
            ? 'Quando um post tiver engajamento maior que o dobro da média do perfil, ele aparece aqui com a análise do gancho.'
            : 'Para comparar, o perfil precisa de pelo menos 5 outros posts com curtidas visíveis.'}
        </span>
      </div>
    );
  }
  return (
    <>
      <div className="post-list">
        {posts.slice(0, shown).map((p) => (
          <FlaggedCard key={p.shortCode} post={p} colors={colors} />
        ))}
      </div>
      {posts.length > shown && (
        <button type="button" className="btn secondary wide" onClick={() => setShown((n) => n + PAGE)}>
          Mostrar mais ({posts.length - shown})
        </button>
      )}
    </>
  );
}
