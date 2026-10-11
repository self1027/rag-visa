import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { documentsTable } from '../../src/db/schema.js';
import { eq } from 'drizzle-orm';
import { createTestDb, seedTestDb } from '../setup.js';

describe('documentsTable schema', () => {
  let sqlite: Database.Database;
  let db: ReturnType<typeof drizzle>;

  beforeEach(() => {
    const testDb = createTestDb();
    sqlite = testDb.sqlite;
    db = testDb.db;
  });

  afterEach(() => {
    sqlite.close();
  });

  describe('table structure', () => {
    it('should have filename as primary key', () => {
      // Insert a document
      db.insert(documentsTable).values({
        filename: 'test.pdf',
        titulo: 'Teste',
        esfera: 'federal',
        tipo: 'legislacao',
        ano: 2024,
        orgao: 'ANVISA',
      }).run();

      // Try to insert duplicate - should fail due to primary key
      expect(() => {
        db.insert(documentsTable).values({
          filename: 'test.pdf',
          titulo: 'Teste 2',
          esfera: 'estadual',
          tipo: 'legislacao',
          ano: 2023,
          orgao: 'SES',
        }).run();
      }).toThrow();
    });

    it('should require titulo field', () => {
      expect(() => {
        db.insert(documentsTable).values({
          filename: 'test2.pdf',
          esfera: 'federal',
          tipo: 'legislacao',
          ano: 2024,
          orgao: 'ANVISA',
        } as any).run();
      }).toThrow();
    });

    it('should require esfera field', () => {
      expect(() => {
        db.insert(documentsTable).values({
          filename: 'test3.pdf',
          titulo: 'Teste',
          tipo: 'legislacao',
          ano: 2024,
          orgao: 'ANVISA',
        } as any).run();
      }).toThrow();
    });

    it('should require tipo field', () => {
      expect(() => {
        db.insert(documentsTable).values({
          filename: 'test4.pdf',
          titulo: 'Teste',
          esfera: 'federal',
          ano: 2024,
          orgao: 'ANVISA',
        } as any).run();
      }).toThrow();
    });

    it('should require ano field', () => {
      expect(() => {
        db.insert(documentsTable).values({
          filename: 'test5.pdf',
          titulo: 'Teste',
          esfera: 'federal',
          tipo: 'legislacao',
          orgao: 'ANVISA',
        } as any).run();
      }).toThrow();
    });

    it('should require orgao field', () => {
      expect(() => {
        db.insert(documentsTable).values({
          filename: 'test6.pdf',
          titulo: 'Teste',
          esfera: 'federal',
          tipo: 'legislacao',
          ano: 2024,
        } as any).run();
      }).toThrow();
    });
  });

  describe('field types', () => {
    beforeEach(() => {
      seedTestDb(db);
    });

    it('should store filename as TEXT', () => {
      const doc = db.select().from(documentsTable).where(eq(documentsTable.filename, 'rdc_67_2007.pdf')).get()!;
      expect(typeof doc.filename).toBe('string');
    });

    it('should store titulo as TEXT', () => {
      const doc = db.select().from(documentsTable).where(eq(documentsTable.filename, 'rdc_67_2007.pdf')).get()!;
      expect(typeof doc.titulo).toBe('string');
    });

    it('should store esfera as TEXT', () => {
      const doc = db.select().from(documentsTable).where(eq(documentsTable.filename, 'rdc_67_2007.pdf')).get()!;
      expect(typeof doc.esfera).toBe('string');
      expect(['federal', 'estadual', 'municipal']).toContain(doc.esfera);
    });

    it('should store tipo as TEXT', () => {
      const doc = db.select().from(documentsTable).where(eq(documentsTable.filename, 'rdc_67_2007.pdf')).get()!;
      expect(typeof doc.tipo).toBe('string');
      expect(['legislacao', 'modelo_notificacao']).toContain(doc.tipo);
    });

    it('should store ano as INTEGER', () => {
      const doc = db.select().from(documentsTable).where(eq(documentsTable.filename, 'rdc_67_2007.pdf')).get()!;
      expect(typeof doc.ano).toBe('number');
      expect(Number.isInteger(doc.ano)).toBe(true);
    });

    it('should store orgao as TEXT', () => {
      const doc = db.select().from(documentsTable).where(eq(documentsTable.filename, 'rdc_67_2007.pdf')).get()!;
      expect(typeof doc.orgao).toBe('string');
    });
  });

  describe('data integrity', () => {
    it('should reject duplicate filenames', () => {
      db.insert(documentsTable).values({
        filename: 'unique.pdf',
        titulo: 'Teste',
        esfera: 'federal',
        tipo: 'legislacao',
        ano: 2024,
        orgao: 'ANVISA',
      }).run();

      expect(() => {
        db.insert(documentsTable).values({
          filename: 'unique.pdf',
          titulo: 'Outro',
          esfera: 'municipal',
          tipo: 'modelo_notificacao',
          ano: 2023,
          orgao: 'CVS',
        }).run();
      }).toThrow(/UNIQUE constraint failed|PRIMARY KEY/);
    });

    it('should allow valid esfera values', () => {
      const validEsferas = ['federal', 'estadual', 'municipal'];
      
      for (const esfera of validEsferas) {
        const filename = `test_${esfera}.pdf`;
        db.insert(documentsTable).values({
          filename,
          titulo: 'Teste',
          esfera: esfera as any,
          tipo: 'legislacao',
          ano: 2024,
          orgao: 'ORGAO',
        }).run();
        
        const doc = db.select().from(documentsTable).where(eq(documentsTable.filename, filename)).get()!;
        expect(doc.esfera).toBe(esfera);
      }
    });

    it('should allow valid tipo values', () => {
      const validTipos = ['legislacao', 'modelo_notificacao'];
      
      for (const tipo of validTipos) {
        const filename = `test_${tipo}.pdf`;
        db.insert(documentsTable).values({
          filename,
          titulo: 'Teste',
          esfera: 'federal',
          tipo: tipo as any,
          ano: 2024,
          orgao: 'ORGAO',
        }).run();
        
        const doc = db.select().from(documentsTable).where(eq(documentsTable.filename, filename)).get()!;
        expect(doc.tipo).toBe(tipo);
      }
    });

    it('should store year correctly as integer', () => {
      const testYears = [1990, 2000, 2024, 2030];
      
      for (const year of testYears) {
        const filename = `test_${year}.pdf`;
        db.insert(documentsTable).values({
          filename,
          titulo: 'Teste',
          esfera: 'federal',
          tipo: 'legislacao',
          ano: year,
          orgao: 'ORGAO',
        }).run();
        
        const doc = db.select().from(documentsTable).where(eq(documentsTable.filename, filename)).get()!;
        expect(doc.ano).toBe(year);
      }
    });
  });

  describe('queries', () => {
    beforeEach(() => {
      seedTestDb(db);
    });

    it('should select all documents', () => {
      const docs = db.select().from(documentsTable).all();
      expect(docs.length).toBe(3);
    });

    it('should select by filename', () => {
      const doc = db.select().from(documentsTable).where(eq(documentsTable.filename, 'rdc_67_2007.pdf')).get();
      expect(doc).toBeDefined();
      expect(doc?.titulo).toContain('RDC 67');
    });

    it('should update documents', () => {
      db.update(documentsTable)
        .set({ titulo: 'Novo Título' })
        .where(eq(documentsTable.filename, 'rdc_67_2007.pdf'))
        .run();
      
      const doc = db.select().from(documentsTable).where(eq(documentsTable.filename, 'rdc_67_2007.pdf')).get()!;
      expect(doc.titulo).toBe('Novo Título');
    });

    it('should delete documents', () => {
      db.delete(documentsTable).where(eq(documentsTable.filename, 'rdc_67_2007.pdf')).run();
      
      const doc = db.select().from(documentsTable).where(eq(documentsTable.filename, 'rdc_67_2007.pdf')).get();
      expect(doc).toBeUndefined();
    });
  });
});