// Servidor HTTP local que imita os 3 endpoints da Apify usados pelo coletor
// (iniciar execução, consultar execução, baixar itens), servindo uma resposta REAL capturada.
// Serve para testar de ponta a ponta o cliente HTTP (cabeçalhos, polling, paginação) sem gastar créditos.
import http from 'node:http';

export async function startMockApify(items, { token = 'test-token', runsBeforeDone = 1 } = {}) {
  const requests = [];
  const runs = new Map();

  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, auth: req.headers.authorization });
    const send = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.headers.authorization !== `Bearer ${token}`) return send(401, { error: { type: 'token-not-valid' } });

    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const url = new URL(req.url, 'http://mock');
      if (req.method === 'POST' && /^\/v2\/acts\/[^/]+\/runs$/.test(url.pathname)) {
        const input = JSON.parse(body || '{}');
        const id = `run${runs.size + 1}`;
        runs.set(id, { polls: 0, input });
        return send(201, { data: { id, status: 'READY', defaultDatasetId: `ds-${id}` } });
      }
      const runMatch = url.pathname.match(/^\/v2\/actor-runs\/([^/]+)$/);
      if (req.method === 'GET' && runMatch) {
        const run = runs.get(runMatch[1]);
        if (!run) return send(404, { error: { type: 'record-not-found' } });
        run.polls += 1;
        const status = run.polls > runsBeforeDone ? 'SUCCEEDED' : 'RUNNING';
        return send(200, { data: { id: runMatch[1], status, defaultDatasetId: `ds-${runMatch[1]}` } });
      }
      if (req.method === 'GET' && /^\/v2\/datasets\/[^/]+\/items$/.test(url.pathname)) {
        return send(200, items);
      }
      return send(404, { error: 'not-found' });
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requests,
    runs,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

// Uso manual: node collector/test/mock-apify.mjs <arquivo.json> [porta]
if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFile } = await import('node:fs/promises');
  const items = JSON.parse(await readFile(process.argv[2], 'utf8'));
  const mock = await startMockApify(items);
  console.log(`Mock da Apify em ${mock.baseUrl} (token: test-token). Ctrl+C para parar.`);
}
