import { createServer } from 'node:http';
import { once } from 'node:events';
import { it, expect, vi } from 'vitest';

it('usa o endpoint, a credencial e o modelo configurados em uma chamada HTTP real', async () => {
  let requestPath = ''; let authorization = ''; let payload: any;
  const server = createServer(async (req, res) => {
    requestPath = req.url || '';
    authorization = req.headers.authorization || '';
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    payload = JSON.parse(Buffer.concat(chunks).toString());
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Porta indisponível');
    vi.stubEnv('LLM_BASE_URL', `http://127.0.0.1:${address.port}/custom/v1`);
    vi.stubEnv('LLM_API_KEY', 'credencial-do-teste');
    vi.stubEnv('LLM_MODEL', 'modelo-alternativo');
    vi.resetModules();
    const { getLlmClient } = await import('../../src/config/llm.js');
    const { settings } = await import('../../src/config/settings.js');
    expect(getLlmClient()).toBe(getLlmClient());
    const response = await getLlmClient().chat.completions.create({
      model: settings.llmModel, messages: [{ role: 'user', content: 'teste' }],
    });
    expect(response.choices[0].message.content).toBe('ok');
    expect(requestPath).toBe('/custom/v1/chat/completions');
    expect(authorization).toBe('Bearer credencial-do-teste');
    expect(payload.model).toBe('modelo-alternativo');
  } finally {
    vi.unstubAllEnvs(); vi.resetModules();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

it('só exige a configuração da IA ao usar o chat', async () => {
  try {
    for (const key of ['LLM_API_KEY', 'GROQ_API_KEY', 'LLM_MODEL', 'GROQ_MODEL', 'LLM_BASE_URL', 'GROQ_BASE_URL']) vi.stubEnv(key, '');
    vi.resetModules();
    const { getLlmClient } = await import('../../src/config/llm.js');
    expect(() => getLlmClient()).toThrow('Configure LLM_BASE_URL');
  } finally { vi.unstubAllEnvs(); vi.resetModules(); }
});
