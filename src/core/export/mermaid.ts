import { SchemaIR } from '../../shared/model';

/**
 * Exports a SchemaIR into Mermaid erDiagram syntax.
 */
export function exportToMermaid(schema: SchemaIR): string {
  const lines: string[] = ['erDiagram'];

  // Tables
  for (const table of schema.tables) {
    lines.push(`  ${table.name} {`);
    for (const col of table.columns) {
      const typeStr = col.type.replace(/[^a-zA-Z0-9_]/g, '_');
      const pkMarker = col.primary ? ' PK' : col.unique ? ' UK' : '';
      const commentStr = col.comment ? ` "${col.comment.replace(/"/g, "'")}"` : '';
      lines.push(`    ${typeStr} ${col.name}${pkMarker}${commentStr}`);
    }
    lines.push('  }');
  }

  // Relations
  for (const rel of schema.relations) {
    if (rel.to.table === '*') continue;

    // In Mermaid erDiagram:
    // 1:N: target ||--o{ from : ""
    // 1:1: target ||--|| from : ""
    const relSymbol = rel.cardinality === '1:1' ? '||--||' : '||--o{';
    const label = rel.onDelete ? `${rel.from.column} (${rel.onDelete})` : rel.from.column;
    lines.push(`  ${rel.to.table} ${relSymbol} ${rel.from.table} : "${label}"`);
  }

  return lines.join('\n');
}
