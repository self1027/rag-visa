// Global test setup - runs before all tests
import { vi, beforeAll, afterAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { migrateDatabase } from '../src/db/migrate.js';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { documentsTable } from '../src/db/schema.js';
import { eq } from 'drizzle-orm';
import fs from 'fs';
import os from 'os';
import path from 'path';

// Mock environment variables BEFORE any module imports
process.env.GROQ_API_KEY = 'test-groq-api-key';
process.env.OLLAMA_URL = 'http://localhost:11434';
process.env.PORT = '3333';

// Mock console methods to reduce noise in tests
const originalConsole = { ...console };
beforeAll(() => {
  console.log = vi.fn();
  console.error = vi.fn();
  console.warn = vi.fn();
  console.info = vi.fn();
});

afterAll(() => {
  Object.assign(console, originalConsole);
});

// Reset all mocks before each test
beforeEach(() => {
  vi.clearAllMocks();
});

// Helper to create a temporary SQLite database for testing
export function createTestDb() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite);
  
  // Create the documents table
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      filename TEXT PRIMARY KEY,
      titulo TEXT NOT NULL,
      esfera TEXT NOT NULL,
      tipo TEXT NOT NULL,
      ano INTEGER NOT NULL,
      orgao TEXT NOT NULL
    )
  `);
  
  migrateDatabase(db);
  return { sqlite, db };
}

export function createTempFileDb() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rag-visa-test-'));
  const dbPath = path.join(tmpDir, 'database.sqlite');
  const sqlite = new Database(dbPath);
  const db = drizzle(sqlite);
  
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      filename TEXT PRIMARY KEY,
      titulo TEXT NOT NULL,
      esfera TEXT NOT NULL,
      tipo TEXT NOT NULL,
      ano INTEGER NOT NULL,
      orgao TEXT NOT NULL
    )
  `);
  
  migrateDatabase(db);
  return { 
    sqlite, 
    db, 
    cleanup: () => {
      sqlite.close();
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  };
}

// Mock Qdrant client
export const mockQdrantClient = {
  getCollections: vi.fn(),
  createCollection: vi.fn(),
  query: vi.fn(),
  upsert: vi.fn(),
  delete: vi.fn(),
};

// Mock Ollama client
export const mockOllamaClient = {
  embeddings: vi.fn(),
};

// Mock OpenAI/Groq client
export const mockGroqClient = {
  chat: {
    completions: {
      create: vi.fn(),
    },
  },
};

// Test data helpers
export const testDocuments = [
  {
    filename: 'rdc_67_2007.pdf',
    titulo: 'RDC 67/2007 - Boas Práticas para Serviços de Alimentação',
    esfera: 'federal' as const,
    tipo: 'legislacao' as const,
    ano: 2007,
    orgao: 'ANVISA',
  },
  {
    filename: 'lei_10083_1998.pdf',
    titulo: 'Lei 10.083/1998 - Código de Saúde do Estado de São Paulo',
    esfera: 'estadual' as const,
    tipo: 'legislacao' as const,
    ano: 1998,
    orgao: 'SES-SP',
  },
  {
    filename: 'cvs_1_2024.pdf',
    titulo: 'CVS 1/2024 - Centro de Vigilância Sanitária',
    esfera: 'municipal' as const,
    tipo: 'legislacao' as const,
    ano: 2024,
    orgao: 'CVS-SP',
  },
];

export function seedTestDb(db: ReturnType<typeof drizzle>) {
  for (const doc of testDocuments) {
    db.insert(documentsTable).values(doc).run();
  }
}