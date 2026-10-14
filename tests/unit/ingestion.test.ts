import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const mocks = vi.hoisted(() => ({ all: vi.fn(), enqueue: vi.fn(), isBusy: vi.fn(), waitUntilIdle: vi.fn(), stop: vi.fn() }));
vi.mock('../../src/db/index.js', () => ({ db: { select: () => ({ from: () => ({ all: mocks.all }) }) } }));
vi.mock('../../src/ingestion/service.js', () => ({ createIngestionService: () => mocks }));
import { processPdfs } from '../../src/ingestion/ingest.js';
let dir: string;
beforeEach(() => {
  vi.resetAllMocks();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-cli-ingest-'));
  mocks.all.mockReturnValue([]);
  mocks.isBusy.mockReturnValue(false);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
describe('CLI ingestion', () => {
  it('creates a missing directory and handles an empty corpus', async () => {
    await processPdfs(path.join(dir, 'pdfs'));
    expect(fs.existsSync(path.join(dir, 'pdfs'))).toBe(true);
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it('requires reviewed metadata instead of classifying unregistered PDFs as municipal', async () => {
    fs.writeFileSync(path.join(dir, 'rdc.pdf'), '%PDF-1.4');
    await expect(processPdfs(dir)).rejects.toThrow('Cadastre os metadados');
    expect(mocks.enqueue).not.toHaveBeenCalled();
  });
  it('uses the shared queue and waits for completion', async () => {
    fs.writeFileSync(path.join(dir, 'rdc.pdf'), '%PDF-1.4');
    mocks.all.mockReturnValueOnce([{ filename: 'rdc.pdf' }]).mockReturnValueOnce([]).mockReturnValueOnce([{ filename: 'rdc.pdf', status: 'completed' }]);
    await processPdfs(dir);
    expect(mocks.enqueue).toHaveBeenCalledWith('rdc.pdf');
    expect(mocks.waitUntilIdle).toHaveBeenCalled();
  });
  it('propagates failures and refuses to compete with an active server job', async () => {
    fs.writeFileSync(path.join(dir, 'rdc.pdf'), '%PDF-1.4');
    mocks.all.mockReturnValueOnce([{ filename: 'rdc.pdf' }]).mockReturnValueOnce([]).mockReturnValueOnce([{ filename: 'rdc.pdf', status: 'failed' }]);
    await expect(processPdfs(dir)).rejects.toThrow('Falha na ingestão');
    mocks.all.mockReturnValueOnce([{ filename: 'rdc.pdf' }]).mockReturnValueOnce([{ filename: 'rdc.pdf', status: 'processing' }]);
    await expect(processPdfs(dir)).rejects.toThrow('já está em ingestão');
  });
});
