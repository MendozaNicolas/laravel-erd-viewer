import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseLaravelMigrations, MigrationFileInput } from '../../src/core/laravel';
import { exportToDbml } from '../../src/core/export/dbml';
import { exportToMermaid } from '../../src/core/export/mermaid';
// @ts-ignore
import { Parser as DbmlParser } from '@dbml/core';

function loadFixtures(dirName: string): MigrationFileInput[] {
  const dirPath = path.resolve(__dirname, '../fixtures/laravel', dirName);
  const files = fs.readdirSync(dirPath).filter((f) => f.endsWith('.php'));
  return files.map((fileName) => ({
    path: `database/migrations/${fileName}`,
    content: fs.readFileSync(path.join(dirPath, fileName), 'utf-8'),
  }));
}

describe('Schema Export', () => {
  it('exports SchemaIR to valid DBML syntax verified by @dbml/core', () => {
    const files = [...loadFixtures('default'), ...loadFixtures('blog')];
    const schema = parseLaravelMigrations(files);
    const dbml = exportToDbml(schema);

    expect(dbml).toContain('Table users {');
    expect(dbml).toContain('Table posts {');
    expect(dbml).toContain('Ref: posts.user_id > users.id');

    // Parse with @dbml/core parser to verify syntax validity
    const parser = new DbmlParser();
    const dbmlDatabase = parser.parse(dbml, 'dbml');
    expect(dbmlDatabase).toBeDefined();
    expect(dbmlDatabase.schemas[0].tables.length).toBeGreaterThan(0);
  });

  it('exports SchemaIR to valid Mermaid erDiagram syntax', () => {
    const files = [...loadFixtures('default'), ...loadFixtures('blog')];
    const schema = parseLaravelMigrations(files);
    const mermaid = exportToMermaid(schema);

    expect(mermaid).toContain('erDiagram');
    expect(mermaid).toContain('users {');
    expect(mermaid).toContain('posts {');
    expect(mermaid).toContain('users ||--o{ posts : "user_id (cascade)"');
  });
});
