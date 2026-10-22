import ELK, { ElkNode, ElkExtendedEdge } from 'elkjs/lib/elk.bundled.js';
import { Table, Relation } from '../../shared/model';

const elk = new ELK();

export const TABLE_WIDTH = 280;
export const ROW_HEIGHT = 28;
export const HEADER_HEIGHT = 44;

export function calculateTableHeight(columnCount: number): number {
  return HEADER_HEIGHT + Math.max(1, columnCount) * ROW_HEIGHT + 16;
}

export async function layoutSchema(
  tables: Table[],
  relations: Relation[],
  savedPositions?: Record<string, { x: number; y: number }> | null
): Promise<Record<string, { x: number; y: number }>> {
  const result: Record<string, { x: number; y: number }> = {};

  // If all tables have saved positions, reuse them
  if (savedPositions && Object.keys(savedPositions).length > 0) {
    let allFound = true;
    for (const table of tables) {
      if (savedPositions[table.name]) {
        result[table.name] = savedPositions[table.name];
      } else {
        allFound = false;
      }
    }
    if (allFound) {
      return result;
    }
  }

  const children: ElkNode[] = tables.map((t) => ({
    id: t.name,
    width: TABLE_WIDTH,
    height: calculateTableHeight(t.columns.length),
  }));

  const edges: ElkExtendedEdge[] = relations
    .filter((r) => r.to.table !== '*')
    .map((r) => ({
      id: r.id,
      sources: [r.from.table],
      targets: [r.to.table],
    }));

  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': '60',
      'elk.layered.spacing.nodeNodeBetweenLayers': '90',
      'elk.edgeRouting': 'ORTHOGONAL',
    },
    children,
    edges,
  };

  try {
    const layouted = await elk.layout(graph);
    if (layouted.children) {
      for (const node of layouted.children) {
        if (node.id) {
          // If a table has a manually saved position, keep it; otherwise use ELK position
          if (savedPositions && savedPositions[node.id]) {
            result[node.id] = savedPositions[node.id];
          } else {
            result[node.id] = {
              x: Math.round(node.x ?? 0),
              y: Math.round(node.y ?? 0),
            };
          }
        }
      }
    }
  } catch (err) {
    console.error('[elk] layout error:', err);
    // Fallback: simple grid
    let col = 0;
    let row = 0;
    for (const table of tables) {
      if (savedPositions && savedPositions[table.name]) {
        result[table.name] = savedPositions[table.name];
      } else {
        result[table.name] = {
          x: col * (TABLE_WIDTH + 80),
          y: row * 320,
        };
        col++;
        if (col > 3) {
          col = 0;
          row++;
        }
      }
    }
  }

  return result;
}
