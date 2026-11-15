# Radar de concorrentes no Instagram · SCALABLE

Monitor diário de até 5 perfis concorrentes do Instagram. Um site que você abre no celular ou no computador mostra seguidores, engajamento e **os posts que bombaram**, com a análise de por que o gancho funcionou.

Sem servidor e sem banco de dados: tudo roda dentro do GitHub.

```
GitHub Actions (cron diário, 06:17 em Brasília)
   └─ coleta os perfis na Apify ─► grava JSON em data/ ─► publica o site no GitHub Pages
                                                              └─ você abre o link no celular
```

| Peça | Onde roda | Custo |
|---|---|---|
| Coleta diária (cron) | GitHub Actions | grátis em repositório público |
| Dados (histórico) | arquivos JSON em `data/`, versionados no git | grátis |
| Dashboard | GitHub Pages (React estático) | grátis |
| Fonte dos dados | Apify (`apify/instagram-profile-scraper`) | centavos por mês (confira o preço atual do ator) |
| Análise do gancho | API do Claude (opcional) | centavos por mês |
| Transcrição de vídeo | Whisper local (`faster-whisper`) dentro do Actions | grátis |

## O que falta configurar (faça uma vez)

1. **Tornar o repositório público.** `Settings → General → Danger Zone → Change visibility`. O GitHub Pages grátis só publica de repositório público. Chaves ficam em *Secrets* e nunca vão para o código. Os dados coletados (métricas públicas dos concorrentes e as análises) ficam visíveis a quem achar o repositório.
2. **Levar o código para a branch `main`** (abra um Pull Request deste branch e faça o merge). O cron do GitHub só roda a partir da branch padrão.
3. **Ativar o Pages.** `Settings → Pages → Build and deployment → Source: GitHub Actions`.
4. **Cadastrar os segredos.** `Settings → Secrets and variables → Actions → New repository secret`:
   - `APIFY_TOKEN` (**obrigatório**): em [console.apify.com](https://console.apify.com) → *Settings → API & Integrations → API tokens*.
   - `ANTHROPIC_API_KEY` (opcional): em [console.anthropic.com](https://console.anthropic.com). Sem ela os posts continuam sendo sinalizados, mas a análise do gancho fica em branco com o aviso "ANTHROPIC_API_KEY não configurada".
5. **Rodar a primeira coleta.** `Actions → Coleta diária e publicação → Run workflow`. Em poucos minutos o site fica no ar em `https://<seu-usuario>.github.io/<nome-do-repositório>/`.
6. **(Para adicionar/remover perfis pelo site)** abra *Gerenciar perfis* e siga o passo a passo para colar um token do GitHub restrito a este repositório (permissões *Contents* e *Actions*: read and write). O token fica só no seu aparelho.

## Uso diário

- **Ver os dados:** abra o link do site. Toque em um perfil para filtrar o gráfico e os posts.
- **Adicionar concorrente:** *Gerenciar perfis* → cole o link do perfil (`https://www.instagram.com/usuario`). O @ é extraído sozinho. Máximo de 5.
- **Coletar agora:** botão no topo do site (ou *Run workflow* na aba Actions).
- **Sem o site:** edite `data/profiles.json` direto no GitHub.

## Regras de cálculo

- **Engajamento** = (curtidas + comentários) ÷ seguidores. Posts com **curtidas ocultas** (a Apify devolve valor negativo) ficam fora da conta: nunca viram zero.
- **Bombou** = engajamento do post **maior que 2×** a média dos *outros* posts do perfil (o próprio post não entra na régua). Precisa de pelo menos 5 outros posts com curtidas visíveis; abaixo disso nada é sinalizado.
- **Nunca duplica:** cada post é sinalizado uma única vez (chave = código do post).
- **Histórico:** um registro por perfil por dia (fuso de São Paulo) em `data/snapshots.json`. Rodar duas vezes no mesmo dia substitui o registro do dia.
- **Vídeo sinalizado:** tenta baixar e transcrever o áudio. Se o CDN do Instagram bloquear o download, a transcrição fica em branco, a análise usa só a legenda e o painel avisa o motivo. Nas coletas seguintes ele tenta de novo (até 5 vezes).
- **Imagem/carrossel sinalizado:** a análise usa só a legenda.
- **Nunca inventa dado:** o que não puder ser obtido aparece como "sem dados" com o motivo.

## Limitações conhecidas

- A Apify devolve só os ~12 posts mais recentes por perfil. O histórico de posts cresce a partir da primeira coleta.
- O gráfico só ganha linha a partir da 2ª coleta (1 ponto por dia).
- O agendamento do GitHub pode atrasar alguns minutos. Em repositório público, o GitHub desativa workflows agendados após 60 dias sem atividade no repositório (as coletas diárias gravam commits, o que mantém o repositório ativo).
- O link do vídeo expira rápido e o CDN do Instagram às vezes recusa download de datacenter.

## Desenvolvimento

```bash
npm ci && npm --prefix web ci
npm test                      # testes do coletor e dos cálculos do painel
APIFY_TOKEN=... npm run collect   # coleta de verdade (grava em data/)
npm run web:dev               # painel local (copia data/ para o site)
npm run web:build             # build estático em web/dist
```

Estrutura: `collector/` (coleta, regras, transcrição, análise), `web/` (React + Vite), `data/` (JSON), `shared/` (extração do @ do link, usada pelos dois lados), `.github/workflows/` (cron e publicação).
