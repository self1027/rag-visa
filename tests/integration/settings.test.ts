import { it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createTestDb } from '../setup.js';
import { createApp } from '../../src/server.js';
import { settings } from '../../src/config/settings.js';
import { migrateDatabase } from '../../src/db/migrate.js';
import { getRagSettings } from '../../src/rag/settings.js';

const { askRAG } = vi.hoisted(() => ({ askRAG: vi.fn() }));
vi.mock('../../src/rag/generator.js', () => ({ askRAG }));
let database: ReturnType<typeof createTestDb>;
const ingestion = { enqueue: vi.fn(), remove: vi.fn(), resume: vi.fn(), isBusy: () => false };
const create = () => createApp(database.db, '/tmp/rag-visa-unused', (_req, _res, next) => next(), ingestion);
beforeEach(() => { database = createTestDb(); vi.stubEnv('ADMIN_API_TOKEN', ''); });
afterEach(() => { database.sqlite.close(); vi.unstubAllEnvs(); });
const config = { searchLimit: 9, searchThreshold: 0.65, maxResponseTokens: 1500 };

it('serve HTML e assets estáticos sem EJS', async () => {
  const app = create();
  const page = await request(app).get('/');
  expect(page.status).toBe(200);
  expect(page.text).toContain('Configurações da IA');
  expect((await request(app).get('/app.js')).status).toBe(200);
  expect((await request(app).get('/styles.css')).status).toBe(200);
});

it('persiste ajustes e os reutiliza em outra instância da API sem expor credenciais', async () => {
  const app = create();
  const initial = await request(app).get('/api/settings');
  expect(initial.body.searchLimit).toBe(settings.searchLimit);
  expect(initial.body).not.toHaveProperty('llmApiKey');
  expect(initial.body).not.toHaveProperty('llmBaseUrl');
  expect(initial.body.limits.searchThreshold).toEqual({ min: 0, max: 1 });
  expect((await request(app).put('/api/settings').send(config)).body).toEqual(config);
  migrateDatabase(database.db);
  expect(getRagSettings(database.db)).toEqual(config);
  expect((await request(create()).get('/api/settings')).body).toMatchObject(config);
});

it('protege leitura e escrita quando o token administrativo está configurado', async () => {
  vi.stubEnv('ADMIN_API_TOKEN', 'administrador');
  const app = create();
  expect((await request(app).get('/api/settings')).status).toBe(401);
  expect((await request(app).put('/api/settings').send(config)).status).toBe(401);
  expect((await request(app).put('/api/settings').set('Authorization', 'Bearer administrador').send(config)).status).toBe(200);
});

it.each([
  { ...config, searchLimit: 0 }, { ...config, searchLimit: 51 }, { ...config, searchLimit: 1.5 },
  { ...config, searchThreshold: -0.1 }, { ...config, searchThreshold: 1.1 },
  { ...config, maxResponseTokens: 32001 }, { ...config, searchLimit: '9' },
  { ...config, llmApiKey: 'nao-permitido' }, { searchLimit: 9 }, [], null,
])('rejeita configurações inválidas e preserva o valor anterior: %j', async value => {
  const app = create();
  await request(app).put('/api/settings').send(config);
  expect((await request(app).put('/api/settings').set('Content-Type', 'application/json').send(JSON.stringify(value))).status).toBe(400);
  expect(getRagSettings(database.db)).toEqual(config);
});

it('aplica os ajustes persistidos às próximas perguntas sem reiniciar o servidor', async () => {
  askRAG.mockResolvedValue({ answer: 'Resposta', sources: [], evidence: [] });
  const app = create();
  await request(app).put('/api/settings').send(config);
  const chat = await request(app).post('/api/chat').send({ history: [{ role: 'user', content: 'Olá' }] });
  expect(chat.status).toBe(200);
  expect(askRAG).toHaveBeenCalledWith(expect.any(Array), expect.any(Function), expect.objectContaining({
    maxResponseTokens: 1500, search: expect.objectContaining({ limit: 9, scoreThreshold: 0.65 }),
  }));
});
