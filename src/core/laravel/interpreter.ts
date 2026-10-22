import type { Node } from 'php-parser';
import { Column, Index, Relation, SourceRef, Table, Warning } from '../../shared/model';
import {
  applyColumnModifier,
  interpretColumnBaseCall,
  isColumnDefinitionMethod,
  MethodCall,
} from './blueprint';
import { resolveString, resolveStringArray } from './resolve-values';

interface UnwoundChain {
  base: MethodCall;
  modifiers: MethodCall[];
  targetVar?: string;
}

/**
 * Unwinds a chain of method calls from outside-in to base->modifiers order.
 * e.g. `$table->foreignId('role_id')->nullable()->constrained('roles')`
 */
function unwindMethodChain(expr: Node): UnwoundChain | null {
  const calls: MethodCall[] = [];
  let curr = expr;
  let targetVar: string | undefined;

  while (curr && curr.kind === 'call') {
    const what = curr.what;
    if (!what || what.kind !== 'propertylookup') {
      break;
    }

    const methodName = what.offset?.name || resolveString(what.offset) || '';
    const loc = curr.loc
      ? {
          start: { line: curr.loc.start.line, column: curr.loc.start.column },
          end: { line: curr.loc.end.line, column: curr.loc.end.column },
        }
      : undefined;

    calls.push({
      name: methodName,
      args: curr.arguments || [],
      loc,
    });

    const nextTarget = what.what;
    if (nextTarget && nextTarget.kind === 'variable') {
      targetVar = nextTarget.name;
      break;
    }
    curr = nextTarget;
  }

  if (calls.length === 0) return null;

  // Reverse so the base call ($table->method) comes first, followed by modifiers
  calls.reverse();
  const [base, ...modifiers] = calls;

  return { base, modifiers, targetVar };
}

export class SchemaInterpreter {
  public tables = new Map<string, Table>();
  public explicitRelations: Relation[] = [];
  public warnings: Warning[] = [];

  public interpretSchemaCall(
    callNode: Node,
    sourceFile: string,
    migrationName: string
  ): void {
    const call = this._extractSchemaMethodAndArgs(callNode);
    if (!call) return;

    const { method, args, loc } = call;
    const source: SourceRef = {
      file: sourceFile,
      migration: migrationName,
      line: loc?.start.line || 1,
      column: loc?.start.column || 1,
    };

    switch (method) {
      case 'create': {
        const tableName = resolveString(args[0]);
        if (!tableName) {
          this.warnings.push({
            code: 'DYNAMIC_VALUE',
            message: 'Schema::create called with non-literal table name.',
            source,
          });
          return;
        }

        const closure = args[1];
        const newTable: Table = {
          name: tableName,
          columns: [],
          indexes: [],
          source,
        };
        this.tables.set(tableName, newTable);

        if (closure) {
          this._interpretClosureStatements(closure, tableName, sourceFile, migrationName, false);
        }
        break;
      }

      case 'table': {
        const tableName = resolveString(args[0]);
        if (!tableName) {
          this.warnings.push({
            code: 'DYNAMIC_VALUE',
            message: 'Schema::table called with non-literal table name.',
            source,
          });
          return;
        }

        let existingTable = this.tables.get(tableName);
        if (!existingTable) {
          // Table was altered before being created in parsed migrations
          existingTable = {
            name: tableName,
            columns: [],
            indexes: [],
            source,
          };
          this.tables.set(tableName, existingTable);
        }

        const closure = args[1];
        if (closure) {
          this._interpretClosureStatements(closure, tableName, sourceFile, migrationName, true);
        }
        break;
      }

      case 'rename': {
        const from = resolveString(args[0]);
        const to = resolveString(args[1]);
        if (from && to) {
          const t = this.tables.get(from);
          if (t) {
            this.tables.delete(from);
            t.name = to;
            this.tables.set(to, t);
          }
        }
        break;
      }

      case 'drop':
      case 'dropIfExists': {
        const tableName = resolveString(args[0]);
        if (tableName) {
          this.tables.delete(tableName);
          // Also remove any relations originating from or targeting this dropped table
          this.explicitRelations = this.explicitRelations.filter(
            (r) => r.from.table !== tableName && r.to.table !== tableName
          );
        }
        break;
      }
    }
  }

  private _extractSchemaMethodAndArgs(callNode: Node): {
    method: string;
    args: Node[];
    loc?: any;
  } | null {
    if (callNode.kind !== 'call') return null;

    const what = callNode.what;
    // Static call: Schema::create, Schema::table, etc.
    if (what && what.kind === 'staticlookup') {
      const className = what.what?.name || '';
      const methodName = what.offset?.name || '';
      if (className.toLowerCase() === 'schema') {
        return {
          method: methodName,
          args: callNode.arguments || [],
          loc: callNode.loc,
        };
      }
    }

    // Method call on Schema::connection('x')->create(...)
    if (what && what.kind === 'propertylookup') {
      const innerCall = what.what;
      if (
        innerCall &&
        innerCall.kind === 'call' &&
        innerCall.what?.kind === 'staticlookup' &&
        (innerCall.what.what?.name || '').toLowerCase() === 'schema'
      ) {
        const methodName = what.offset?.name || '';
        return {
          method: methodName,
          args: callNode.arguments || [],
          loc: callNode.loc,
        };
      }
    }

    return null;
  }

  private _interpretClosureStatements(
    closureNode: Node,
    tableName: string,
    sourceFile: string,
    migrationName: string,
    isAlter: boolean
  ): void {
    const table = this.tables.get(tableName);
    if (!table) return;

    const statements: Node[] =
      closureNode.body && Array.isArray(closureNode.body.children)
        ? closureNode.body.children
        : [];

    for (const stmt of statements) {
      const expr = stmt.kind === 'expressionstatement' ? stmt.expression : stmt;
      if (!expr) continue;

      const chain = unwindMethodChain(expr);
      if (!chain) continue;

      const { base, modifiers } = chain;
      const stmtSource: SourceRef = {
        file: sourceFile,
        migration: migrationName,
        line: base.loc?.start.line || expr.loc?.start.line || 1,
        column: base.loc?.start.column || expr.loc?.start.column || 1,
      };

      // 1. Column creation / composite
      if (isColumnDefinitionMethod(base.name)) {
        const isChange = modifiers.some((m) => m.name === 'change');
        const { columns: interpretedCols, polymorphicRelations } = interpretColumnBaseCall(
          base,
          stmtSource,
          tableName
        );

        if (polymorphicRelations) {
          this.explicitRelations.push(...polymorphicRelations);
        }

        for (const item of interpretedCols) {
          // Apply all modifier calls (nullable, unique, constrained, etc.)
          for (const mod of modifiers) {
            applyColumnModifier(item, mod);
          }

          if (isAlter && isChange) {
            // Modify existing column in-place
            const existingIdx = table.columns.findIndex((c) => c.name === item.column.name);
            if (existingIdx !== -1) {
              table.columns[existingIdx] = {
                ...table.columns[existingIdx],
                ...item.column,
                source: stmtSource,
              };
            } else {
              table.columns.push(item.column);
            }
          } else {
            // Check if column already existed (replace or append)
            const existingIdx = table.columns.findIndex((c) => c.name === item.column.name);
            if (existingIdx !== -1) {
              table.columns[existingIdx] = item.column;
            } else {
              table.columns.push(item.column);
            }
          }

          // Register explicit relation if present
          if (item.pendingRelation?.targetTable) {
            const relId = `${tableName}.${item.column.name}->${item.pendingRelation.targetTable}.${item.pendingRelation.targetColumn || 'id'}`;
            this.explicitRelations.push({
              id: relId,
              from: { table: tableName, column: item.column.name },
              to: {
                table: item.pendingRelation.targetTable,
                column: item.pendingRelation.targetColumn || 'id',
              },
              kind: 'explicit',
              cardinality: item.column.unique ? '1:1' : '1:N',
              onDelete: item.pendingRelation.onDelete,
              onUpdate: item.pendingRelation.onUpdate,
              source: stmtSource,
            });
          }
        }
        continue;
      }

      // 2. Table-level Foreign Key: $table->foreign('user_id')->references('id')->on('users')
      if (base.name === 'foreign') {
        const colName = resolveString(base.args[0]);
        if (colName) {
          let targetTable: string | undefined;
          let targetCol = 'id';
          let onDelete: string | undefined;
          let onUpdate: string | undefined;

          for (const mod of modifiers) {
            if (mod.name === 'references') {
              targetCol = resolveString(mod.args[0]) || 'id';
            } else if (mod.name === 'on') {
              targetTable = resolveString(mod.args[0]);
            } else if (mod.name === 'onDelete' || mod.name === 'cascadeOnDelete' || mod.name === 'nullOnDelete' || mod.name === 'restrictOnDelete' || mod.name === 'noActionOnDelete') {
              if (mod.name === 'cascadeOnDelete') onDelete = 'cascade';
              else if (mod.name === 'nullOnDelete') onDelete = 'set null';
              else if (mod.name === 'restrictOnDelete') onDelete = 'restrict';
              else if (mod.name === 'noActionOnDelete') onDelete = 'no action';
              else onDelete = resolveString(mod.args[0])?.toLowerCase();
            } else if (mod.name === 'onUpdate' || mod.name === 'cascadeOnUpdate') {
              if (mod.name === 'cascadeOnUpdate') onUpdate = 'cascade';
              else onUpdate = resolveString(mod.args[0])?.toLowerCase();
            }
          }

          if (targetTable) {
            const relId = `${tableName}.${colName}->${targetTable}.${targetCol}`;
            this.explicitRelations.push({
              id: relId,
              from: { table: tableName, column: colName },
              to: { table: targetTable, column: targetCol },
              kind: 'explicit',
              cardinality: '1:N',
              onDelete,
              onUpdate,
              source: stmtSource,
            });
          }
        }
        continue;
      }

      // 3. Table-level index/unique/primary
      if (['primary', 'unique', 'index', 'fullText', 'spatialIndex'].includes(base.name)) {
        const cols = resolveStringArray(base.args[0]);
        if (cols.length > 0) {
          const kindMap: Record<string, Index['kind']> = {
            primary: 'primary',
            unique: 'unique',
            index: 'index',
            fullText: 'fulltext',
            spatialIndex: 'spatial',
          };
          table.indexes.push({
            name: resolveString(base.args[1]),
            kind: kindMap[base.name] || 'index',
            columns: cols,
            source: stmtSource,
          });

          // Mark individual column primary or unique if single column
          if (cols.length === 1) {
            const targetCol = table.columns.find((c) => c.name === cols[0]);
            if (targetCol) {
              if (base.name === 'primary') targetCol.primary = true;
              if (base.name === 'unique') targetCol.unique = true;
              if (base.name === 'index') targetCol.index = true;
            }
          }
        }
        continue;
      }

      // 4. Alter: dropColumn
      if (base.name === 'dropColumn') {
        const toDrop = resolveStringArray(base.args[0]);
        table.columns = table.columns.filter((c) => !toDrop.includes(c.name));
        this.explicitRelations = this.explicitRelations.filter(
          (r) => !(r.from.table === tableName && toDrop.includes(r.from.column))
        );
        continue;
      }

      // 5. Alter: renameColumn
      if (base.name === 'renameColumn') {
        const from = resolveString(base.args[0]);
        const to = resolveString(base.args[1]);
        if (from && to) {
          const targetCol = table.columns.find((c) => c.name === from);
          if (targetCol) {
            targetCol.name = to;
            targetCol.source = stmtSource;
          }
        }
        continue;
      }

      // 6. Alter: dropForeign
      if (base.name === 'dropForeign') {
        const fkArg = resolveString(base.args[0]) || resolveStringArray(base.args[0]);
        if (typeof fkArg === 'string') {
          // Can be index name or column name
          this.explicitRelations = this.explicitRelations.filter(
            (r) => !(r.from.table === tableName && r.from.column === fkArg)
          );
        } else if (Array.isArray(fkArg)) {
          this.explicitRelations = this.explicitRelations.filter(
            (r) => !(r.from.table === tableName && fkArg.includes(r.from.column))
          );
        }
        continue;
      }

      // 7. Alter: dropTimestamps / dropSoftDeletes / dropRememberToken / dropMorphs
      if (base.name === 'dropTimestamps' || base.name === 'dropTimestampsTz') {
        table.columns = table.columns.filter(
          (c) => c.name !== 'created_at' && c.name !== 'updated_at'
        );
        continue;
      }

      if (base.name === 'dropSoftDeletes' || base.name === 'dropSoftDeletesTz') {
        const delCol = resolveString(base.args[0]) || 'deleted_at';
        table.columns = table.columns.filter((c) => c.name !== delCol);
        continue;
      }

      if (base.name === 'dropRememberToken') {
        table.columns = table.columns.filter((c) => c.name !== 'remember_token');
        continue;
      }

      if (base.name === 'dropMorphs') {
        const prefix = resolveString(base.args[0]);
        if (prefix) {
          table.columns = table.columns.filter(
            (c) => c.name !== `${prefix}_type` && c.name !== `${prefix}_id`
          );
        }
        continue;
      }
    }
  }
}
