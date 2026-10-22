import { describe, it, expect } from 'vitest';
import { SchemaIR } from '../../src/shared/model';

describe('Shared model contracts', () => {
  it('creates a valid empty SchemaIR', () => {
    const ir: SchemaIR = {
      tables: [],
      relations: [],
      warnings: [],
      migrationsApplied: [],
    };
    expect(ir.tables).toHaveLength(0);
    expect(ir.relations).toHaveLength(0);
  });
});
