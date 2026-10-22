import { it, expect } from 'vitest';
import { EmbeddingError } from '../../src/config/embeddingError.js';
it.each([
  ['model requires more system memory', 500, 'memory'],
  ['do embedding request: EOF', 500, 'runner_stopped'],
  ['model not found', 404, 'model_missing'],
  ['input length exceeds context length', 400, 'context_exceeded'],
  ['fetch failed', undefined, 'unreachable'],
])('identifica %s sem publicar a resposta bruta do serviço', (message, status, code) => {
  const cause = Object.assign(new Error(`${message}; texto privado do documento`), { status_code: status });
  const error = new EmbeddingError(cause);
  expect(error.code).toBe(code);
  expect(error.cause).toBe(cause);
  expect(error.message).not.toContain('texto privado');
  expect(error.statusCode).toBe(status);
});
