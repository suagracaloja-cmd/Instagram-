// Regras de negócio puras (sem rede, sem disco): engajamento, média e sinalização de "bombou".

/** Um post "bombou" quando o engajamento > 2x a média histórica do perfil. */
export const FLAG_MULTIPLIER = 2;

/**
 * Mínimo de outros posts (com curtidas visíveis) para a média histórica valer.
 * Abaixo disso não sinalizamos nada: com base pequena demais, "2x a média" é ruído.
 */
export const MIN_BASELINE_POSTS = 5;

/**
 * Engajamento = (curtidas + comentários) / seguidores.
 * Devolve null (nunca um número inventado) quando não dá para calcular:
 * curtidas ocultas (a Apify devolve valor negativo), contagem ausente ou seguidores <= 0.
 */
export function engagementOf(post, followers) {
  if (!Number.isFinite(followers) || followers <= 0) return null;
  if (!Number.isFinite(post?.likes) || post.likes < 0) return null; // curtidas ocultas/desconhecidas
  if (!Number.isFinite(post?.comments) || post.comments < 0) return null;
  return (post.likes + post.comments) / followers;
}

export function mean(values) {
  const nums = values.filter((v) => Number.isFinite(v));
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/** Média de engajamento de uma lista de posts, ignorando os que não têm engajamento calculável. */
export function averageEngagement(posts, followers) {
  const values = posts.map((p) => engagementOf(p, followers)).filter((v) => v !== null);
  return { average: mean(values), count: values.length };
}

/**
 * Média histórica "dos outros posts": todos os posts conhecidos do perfil,
 * exceto o próprio candidato (para um post gigante não puxar a própria régua).
 */
export function baselineExcluding(shortCode, knownPosts, followers) {
  return averageEngagement(knownPosts.filter((p) => p.shortCode !== shortCode), followers);
}

/**
 * Decide quais posts da coleta atual devem ser sinalizados como "bombou".
 *
 * @param {object} args
 * @param {Array} args.candidates     posts da coleta atual
 * @param {Array} args.knownPosts     todos os posts conhecidos do perfil (inclui os candidatos)
 * @param {number} args.followers
 * @param {Set<string>} args.alreadyFlagged  shortCodes já sinalizados (nunca duplicar)
 */
export function detectFlags({
  candidates,
  knownPosts,
  followers,
  alreadyFlagged,
  multiplier = FLAG_MULTIPLIER,
  minBaseline = MIN_BASELINE_POSTS,
}) {
  const flags = [];
  for (const post of candidates) {
    if (alreadyFlagged.has(post.shortCode)) continue;
    const engagement = engagementOf(post, followers);
    if (engagement === null) continue;
    const { average, count } = baselineExcluding(post.shortCode, knownPosts, followers);
    if (average === null || count < minBaseline || average <= 0) continue;
    if (engagement > multiplier * average) {
      flags.push({ post, engagement, baseline: average, baselinePosts: count, multiple: engagement / average });
    }
  }
  return flags.sort((a, b) => String(b.post.timestamp).localeCompare(String(a.post.timestamp)));
}
