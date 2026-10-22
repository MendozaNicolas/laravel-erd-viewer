import { Column, Relation, Table, Warning } from '../../shared/model';
import { inferTableFromForeignKey } from './naming';

export interface ResolveRelationsOptions {
  inferRelations?: boolean;
}

export function resolveAllRelations(
  tables: Table[],
  explicitRelations: Relation[],
  options: ResolveRelationsOptions = { inferRelations: true }
): { relations: Relation[]; warnings: Warning[] } {
  const tableMap = new Map<string, Table>();
  for (const table of tables) {
    tableMap.set(table.name, table);
  }

  const relationsMap = new Map<string, Relation>();
  const warnings: Warning[] = [];

  // Helper to determine if column has unique index or unique flag
  const isColumnUnique = (table: Table, columnName: string): boolean => {
    const col = table.columns.find((c) => c.name === columnName);
    if (col && (col.unique || col.primary)) return true;

    for (const idx of table.indexes) {
      if ((idx.kind === 'unique' || idx.kind === 'primary') && idx.columns.length === 1 && idx.columns[0] === columnName) {
        return true;
      }
    }
    return false;
  };

  // 1. Process explicit relations
  for (const rel of explicitRelations) {
    const fromTable = tableMap.get(rel.from.table);
    if (fromTable) {
      if (isColumnUnique(fromTable, rel.from.column)) {
        rel.cardinality = '1:1';
      }
    }

    // Check unknown target table
    if (rel.to.table !== '*' && !tableMap.has(rel.to.table)) {
      if (rel.source) {
        warnings.push({
          code: 'UNKNOWN_TABLE',
          message: `Relation references table "${rel.to.table}" which was not found in migrations.`,
          source: rel.source,
        });
      }
    }

    relationsMap.set(rel.id, rel);
  }

  // 2. Process inferred relations
  if (options.inferRelations !== false) {
    for (const table of tables) {
      for (const col of table.columns) {
        if (!col.name.endsWith('_id') || col.name === '_id') continue;

        // Skip if there's already an explicit relation for this column
        const existingRel = Array.from(relationsMap.values()).find(
          (r) => r.from.table === table.name && r.from.column === col.name
        );
        if (existingRel) continue;

        const candidateTable = inferTableFromForeignKey(col.name);
        if (candidateTable && tableMap.has(candidateTable)) {
          const targetTable = tableMap.get(candidateTable)!;
          const targetPk = targetTable.columns.find((c) => c.primary)?.name || 'id';

          const relId = `${table.name}.${col.name}->${candidateTable}.${targetPk}`;
          relationsMap.set(relId, {
            id: relId,
            from: { table: table.name, column: col.name },
            to: { table: candidateTable, column: targetPk },
            kind: 'inferred',
            cardinality: isColumnUnique(table, col.name) ? '1:1' : '1:N',
            source: col.source,
          });
        }
      }
    }
  }

  return {
    relations: Array.from(relationsMap.values()),
    warnings,
  };
}
