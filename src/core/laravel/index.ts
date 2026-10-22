import { SchemaIR, Table, Warning } from '../../shared/model';
import { SchemaInterpreter } from './interpreter';
import { parseMigrationFile } from './parse';
import { resolveAllRelations } from './relations';

export interface MigrationFileInput {
  path: string;
  content: string;
}

export interface ParseOptions {
  inferRelations?: boolean;
}

/**
 * Statically parses an array of Laravel migration files and constructs the final SchemaIR.
 * Files are automatically ordered chronologically by filename.
 */
export function parseLaravelMigrations(
  files: MigrationFileInput[],
  options: ParseOptions = { inferRelations: true }
): SchemaIR {
  // Sort files ascending by basename
  const sortedFiles = [...files].sort((a, b) => {
    const nameA = a.path.replace(/\\/g, '/').split('/').pop() || '';
    const nameB = b.path.replace(/\\/g, '/').split('/').pop() || '';
    return nameA.localeCompare(nameB);
  });

  const interpreter = new SchemaInterpreter();
  const appliedMigrations: string[] = [];
  const allWarnings: Warning[] = [];

  for (const file of sortedFiles) {
    const res = parseMigrationFile(file.path, file.content, interpreter);
    if (res.applied) {
      appliedMigrations.push(res.migrationName);
    }
    allWarnings.push(...res.warnings);
  }

  // Get table list in order of creation
  const tables: Table[] = Array.from(interpreter.tables.values());

  // Resolve explicit and inferred relations
  const { relations, warnings: relationWarnings } = resolveAllRelations(
    tables,
    interpreter.explicitRelations,
    { inferRelations: options.inferRelations ?? true }
  );

  allWarnings.push(...interpreter.warnings);
  allWarnings.push(...relationWarnings);

  return {
    tables,
    relations,
    warnings: allWarnings,
    migrationsApplied: appliedMigrations,
  };
}

export * from './naming';
export * from './blueprint';
export * from './interpreter';
export * from './parse';
export * from './relations';
