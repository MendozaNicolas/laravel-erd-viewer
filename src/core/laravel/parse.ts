import Engine, { Node, Program } from 'php-parser';
import { Warning } from '../../shared/model';
import { SchemaInterpreter } from './interpreter';

const parser = new Engine({
  parser: {
    extractDoc: false,
    php7: true,
    locations: true,
    withPositions: true,
    suppressErrors: true,
  },
  ast: {
    withPositions: true,
  },
});

export interface ParseFileResult {
  migrationName: string;
  applied: boolean;
  warnings: Warning[];
}

export function parseMigrationFile(
  filePath: string,
  content: string,
  interpreter: SchemaInterpreter
): ParseFileResult {
  const normalizedPath = filePath.replace(/\\/g, '/');
  const fileName = normalizedPath.split('/').pop() || 'migration';
  const migrationName = fileName.replace(/\.php$/i, '');
  const warnings: Warning[] = [];

  let ast: Program;
  try {
    ast = parser.parseCode(content, fileName);
  } catch (err: any) {
    warnings.push({
      code: 'PARSE_ERROR',
      message: `Failed to parse PHP file: ${err.message || String(err)}`,
      source: { file: normalizedPath, migration: migrationName, line: 1, column: 1 },
    });
    return { migrationName, applied: false, warnings };
  }

  if (ast.errors && ast.errors.length > 0) {
    for (const err of ast.errors) {
      warnings.push({
        code: 'PARSE_ERROR',
        message: `PHP syntax warning: ${err.message || 'Syntax error'}`,
        source: {
          file: normalizedPath,
          migration: migrationName,
          line: err.line || 1,
          column: err.column || 1,
        },
      });
    }
  }

  const upStatements = findUpMethodStatements(ast);
  if (!upStatements || upStatements.length === 0) {
    return { migrationName, applied: false, warnings };
  }

  // Traverse statements in up()
  for (const stmt of upStatements) {
    findSchemaCallsInStatement(stmt, (callNode) => {
      interpreter.interpretSchemaCall(callNode, normalizedPath, migrationName);
    });
  }

  return { migrationName, applied: true, warnings };
}

/**
 * Finds the body statements of the `up()` method in either an anonymous migration
 * class or a named class declaration.
 */
function findUpMethodStatements(ast: Program): Node[] | null {
  const children = ast.children || [];

  for (const node of children) {
    // 1. Anonymous migration: return new class extends Migration { ... }
    if (node.kind === 'return' && node.expr && node.expr.kind === 'new') {
      const classNode = node.expr.what;
      if (classNode && classNode.kind === 'class') {
        const upMethod = findMethod(classNode, 'up');
        if (upMethod && upMethod.body && Array.isArray(upMethod.body.children)) {
          return upMethod.body.children;
        }
      }
    }

    // 2. Named class: class CreateUsersTable extends Migration { ... }
    if (node.kind === 'class') {
      const upMethod = findMethod(node, 'up');
      if (upMethod && upMethod.body && Array.isArray(upMethod.body.children)) {
        return upMethod.body.children;
      }
    }

    // 3. Namespace wrapper: namespace ... { class ... }
    if (node.kind === 'namespace' && Array.isArray(node.children)) {
      for (const nsChild of node.children) {
        if (nsChild.kind === 'class') {
          const upMethod = findMethod(nsChild, 'up');
          if (upMethod && upMethod.body && Array.isArray(upMethod.body.children)) {
            return upMethod.body.children;
          }
        }
      }
    }
  }

  return null;
}

function findMethod(classNode: Node, methodName: string): Node | null {
  if (!Array.isArray(classNode.body)) return null;
  for (const member of classNode.body) {
    if (member.kind === 'method') {
      const name = member.name?.name || member.name;
      if (name && String(name).toLowerCase() === methodName.toLowerCase()) {
        return member;
      }
    }
  }
  return null;
}

/**
 * Recursively locates any Schema calls within a statement.
 */
function findSchemaCallsInStatement(node: Node, onCall: (callNode: Node) => void): void {
  if (!node) return;

  if (node.kind === 'expressionstatement' && node.expression) {
    findSchemaCallsInStatement(node.expression, onCall);
    return;
  }

  if (node.kind === 'call') {
    // Check if this call is Schema::*
    const what = node.what;
    if (
      (what && what.kind === 'staticlookup' && (what.what?.name || '').toLowerCase() === 'schema') ||
      (what && what.kind === 'propertylookup')
    ) {
      onCall(node);
      return;
    }
  }

  // Handle conditionals or loops if present (e.g. if (!Schema::hasTable(...)))
  if (node.kind === 'if') {
    if (node.body && Array.isArray(node.body.children)) {
      for (const child of node.body.children) {
        findSchemaCallsInStatement(child, onCall);
      }
    }
    return;
  }

  if (node.kind === 'block' && Array.isArray(node.children)) {
    for (const child of node.children) {
      findSchemaCallsInStatement(child, onCall);
    }
  }
}
