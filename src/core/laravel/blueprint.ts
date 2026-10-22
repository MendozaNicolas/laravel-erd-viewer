import { Column, Index, Relation, SourceRef } from '../../shared/model';
import { inferTableFromForeignKey, modelToForeignKeyAndTable } from './naming';
import { resolveString, resolveValue, resolveStringArray } from './resolve-values';
import type { Node } from 'php-parser';

export interface MethodCall {
  name: string;
  args: (Node | undefined)[];
  loc?: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
}

export interface InterpretedColumn {
  column: Column;
  pendingRelation?: {
    targetTable?: string;
    targetColumn?: string;
    onDelete?: string;
    onUpdate?: string;
  };
}

/**
 * Creates a default Column object.
 */
export function createDefaultColumn(name: string, type: string, rawMethod: string, source: SourceRef): Column {
  return {
    name,
    type,
    rawMethod,
    nullable: false,
    unsigned: false,
    autoIncrement: false,
    primary: false,
    unique: false,
    index: false,
    source,
  };
}

/**
 * Checks if a method is a column-creating or composite-creating method.
 */
export function isColumnDefinitionMethod(name: string): boolean {
  return [
    'id', 'increments', 'bigIncrements', 'mediumIncrements', 'smallIncrements', 'tinyIncrements',
    'uuid', 'ulid', 'string', 'char', 'text', 'mediumText', 'longText', 'tinyText',
    'integer', 'bigInteger', 'mediumInteger', 'smallInteger', 'tinyInteger',
    'unsignedInteger', 'unsignedBigInteger', 'unsignedMediumInteger', 'unsignedSmallInteger', 'unsignedTinyInteger',
    'boolean', 'decimal', 'double', 'float', 'date', 'dateTime', 'dateTimeTz',
    'time', 'timeTz', 'timestamp', 'timestampTz', 'year', 'json', 'jsonb', 'binary',
    'enum', 'set', 'ipAddress', 'macAddress',
    'timestamps', 'timestampsTz', 'nullableTimestamps',
    'softDeletes', 'softDeletesTz', 'rememberToken',
    'morphs', 'nullableMorphs', 'uuidMorphs', 'nullableUuidMorphs', 'ulidMorphs', 'nullableUlidMorphs',
    'foreignId', 'foreignUuid', 'foreignUlid', 'foreignIdFor',
    'rememberToken', 'geometry', 'point', 'polygon'
  ].includes(name);
}

/**
 * Interprets a column creation method call and returns one or more columns (for composites).
 */
export function interpretColumnBaseCall(
  call: MethodCall,
  source: SourceRef,
  tableName: string
): { columns: InterpretedColumn[]; polymorphicRelations?: Relation[] } {
  const methodName = call.name;
  const args = call.args;
  const columns: InterpretedColumn[] = [];
  const polymorphicRelations: Relation[] = [];

  switch (methodName) {
    case 'id': {
      const name = resolveString(args[0]) || 'id';
      const col = createDefaultColumn(name, 'bigInteger', 'id', source);
      col.unsigned = true;
      col.autoIncrement = true;
      col.primary = true;
      columns.push({ column: col });
      break;
    }

    case 'increments':
    case 'bigIncrements':
    case 'mediumIncrements':
    case 'smallIncrements':
    case 'tinyIncrements': {
      const name = resolveString(args[0]) || 'id';
      const typeMap: Record<string, string> = {
        increments: 'integer',
        bigIncrements: 'bigInteger',
        mediumIncrements: 'mediumInteger',
        smallIncrements: 'smallInteger',
        tinyIncrements: 'tinyInteger',
      };
      const col = createDefaultColumn(name, typeMap[methodName], methodName, source);
      col.unsigned = true;
      col.autoIncrement = true;
      col.primary = true;
      columns.push({ column: col });
      break;
    }

    case 'string':
    case 'char': {
      const name = resolveString(args[0]) || 'unnamed_string';
      const lengthVal = resolveValue(args[1]);
      const col = createDefaultColumn(name, methodName, methodName, source);
      if (typeof lengthVal === 'number') {
        col.length = lengthVal;
      }
      columns.push({ column: col });
      break;
    }

    case 'text':
    case 'mediumText':
    case 'longText':
    case 'tinyText':
    case 'boolean':
    case 'date':
    case 'dateTime':
    case 'dateTimeTz':
    case 'time':
    case 'timeTz':
    case 'timestamp':
    case 'timestampTz':
    case 'year':
    case 'json':
    case 'jsonb':
    case 'binary':
    case 'ipAddress':
    case 'macAddress':
    case 'uuid':
    case 'ulid': {
      const name = resolveString(args[0]) || `unnamed_${methodName}`;
      columns.push({ column: createDefaultColumn(name, methodName, methodName, source) });
      break;
    }

    case 'integer':
    case 'bigInteger':
    case 'mediumInteger':
    case 'smallInteger':
    case 'tinyInteger': {
      const name = resolveString(args[0]) || `unnamed_${methodName}`;
      const col = createDefaultColumn(name, methodName, methodName, source);
      const autoInc = resolveValue(args[1]);
      if (autoInc === true) {
        col.autoIncrement = true;
      }
      const unsigned = resolveValue(args[2]);
      if (unsigned === true) {
        col.unsigned = true;
      }
      columns.push({ column: col });
      break;
    }

    case 'unsignedInteger':
    case 'unsignedBigInteger':
    case 'unsignedMediumInteger':
    case 'unsignedSmallInteger':
    case 'unsignedTinyInteger': {
      const name = resolveString(args[0]) || `unnamed_${methodName}`;
      const baseType = methodName.replace('unsigned', '').toLowerCase();
      const col = createDefaultColumn(name, baseType, methodName, source);
      col.unsigned = true;
      columns.push({ column: col });
      break;
    }

    case 'decimal':
    case 'double':
    case 'float': {
      const name = resolveString(args[0]) || `unnamed_${methodName}`;
      const col = createDefaultColumn(name, methodName, methodName, source);
      const precision = resolveValue(args[1]);
      const scale = resolveValue(args[2]);
      if (typeof precision === 'number') col.precision = precision;
      if (typeof scale === 'number') col.scale = scale;
      columns.push({ column: col });
      break;
    }

    case 'enum':
    case 'set': {
      const name = resolveString(args[0]) || `unnamed_${methodName}`;
      const col = createDefaultColumn(name, methodName, methodName, source);
      const values = resolveStringArray(args[1]);
      if (values.length > 0) {
        col.enumValues = values;
      }
      columns.push({ column: col });
      break;
    }

    // Composites: timestamps
    case 'timestamps':
    case 'timestampsTz':
    case 'nullableTimestamps': {
      const nullable = methodName === 'nullableTimestamps' || true;
      const type = methodName.endsWith('Tz') ? 'timestampTz' : 'timestamp';
      const c1 = createDefaultColumn('created_at', type, methodName, source);
      c1.nullable = nullable;
      const c2 = createDefaultColumn('updated_at', type, methodName, source);
      c2.nullable = nullable;
      columns.push({ column: c1 }, { column: c2 });
      break;
    }

    case 'softDeletes':
    case 'softDeletesTz': {
      const name = resolveString(args[0]) || 'deleted_at';
      const type = methodName.endsWith('Tz') ? 'timestampTz' : 'timestamp';
      const col = createDefaultColumn(name, type, methodName, source);
      col.nullable = true;
      columns.push({ column: col });
      break;
    }

    case 'rememberToken': {
      const col = createDefaultColumn('remember_token', 'string', methodName, source);
      col.length = 100;
      col.nullable = true;
      columns.push({ column: col });
      break;
    }

    // Composites: morphs
    case 'morphs':
    case 'nullableMorphs':
    case 'uuidMorphs':
    case 'nullableUuidMorphs':
    case 'ulidMorphs':
    case 'nullableUlidMorphs': {
      const prefix = resolveString(args[0]) || 'taggable';
      const nullable = methodName.startsWith('nullable');
      const idType = methodName.includes('Uuid')
        ? 'uuid'
        : methodName.includes('Ulid')
        ? 'ulid'
        : 'bigInteger';

      const typeCol = createDefaultColumn(`${prefix}_type`, 'string', methodName, source);
      typeCol.nullable = nullable;

      const idCol = createDefaultColumn(`${prefix}_id`, idType, methodName, source);
      idCol.nullable = nullable;
      if (idType === 'bigInteger') {
        idCol.unsigned = true;
      }
      idCol.index = true;

      columns.push({ column: typeCol }, { column: idCol });

      polymorphicRelations.push({
        id: `${tableName}.${prefix}->*.*`,
        from: { table: tableName, column: `${prefix}_id` },
        to: { table: '*', column: '*' },
        kind: 'polymorphic',
        cardinality: '1:N',
        source,
      });
      break;
    }

    // Foreign id helpers
    case 'foreignId': {
      const name = resolveString(args[0]) || 'unnamed_id';
      const col = createDefaultColumn(name, 'bigInteger', methodName, source);
      col.unsigned = true;
      columns.push({
        column: col,
        pendingRelation: {
          targetTable: inferTableFromForeignKey(name) || undefined,
          targetColumn: 'id',
        },
      });
      break;
    }

    case 'foreignUuid': {
      const name = resolveString(args[0]) || 'unnamed_uuid';
      const col = createDefaultColumn(name, 'uuid', methodName, source);
      columns.push({
        column: col,
        pendingRelation: {
          targetTable: inferTableFromForeignKey(name) || undefined,
          targetColumn: 'id',
        },
      });
      break;
    }

    case 'foreignUlid': {
      const name = resolveString(args[0]) || 'unnamed_ulid';
      const col = createDefaultColumn(name, 'ulid', methodName, source);
      columns.push({
        column: col,
        pendingRelation: {
          targetTable: inferTableFromForeignKey(name) || undefined,
          targetColumn: 'id',
        },
      });
      break;
    }

    case 'foreignIdFor': {
      const modelVal = resolveString(args[0]) || 'Model';
      const customCol = resolveString(args[1]);
      const { column: defaultCol, table: targetTable } = modelToForeignKeyAndTable(modelVal);
      const colName = customCol || defaultCol;
      const col = createDefaultColumn(colName, 'bigInteger', methodName, source);
      col.unsigned = true;
      columns.push({
        column: col,
        pendingRelation: {
          targetTable,
          targetColumn: 'id',
        },
      });
      break;
    }

    default: {
      const name = resolveString(args[0]) || `col_${methodName}`;
      columns.push({ column: createDefaultColumn(name, methodName, methodName, source) });
      break;
    }
  }

  return { columns, polymorphicRelations };
}

/**
 * Applies modifier methods (e.g. nullable(), default(), constrained()) to a column.
 */
export function applyColumnModifier(
  item: InterpretedColumn,
  modifier: MethodCall
): void {
  const name = modifier.name;
  const args = modifier.args;
  const col = item.column;

  switch (name) {
    case 'nullable': {
      const val = resolveValue(args[0]);
      col.nullable = val !== false;
      break;
    }

    case 'default': {
      const val = resolveValue(args[0]);
      if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean' || val === null) {
        col.default = val;
      } else if (val && typeof val === 'object' && 'raw' in val) {
        col.default = val;
      } else if (val !== undefined) {
        col.default = { raw: JSON.stringify(val) };
      }
      break;
    }

    case 'unsigned':
      col.unsigned = true;
      break;

    case 'unique':
      col.unique = true;
      break;

    case 'primary':
      col.primary = true;
      break;

    case 'index':
      col.index = true;
      break;

    case 'autoIncrement':
      col.autoIncrement = true;
      break;

    case 'comment': {
      const commentStr = resolveString(args[0]);
      if (commentStr) col.comment = commentStr;
      break;
    }

    case 'useCurrent':
      col.default = { raw: 'CURRENT_TIMESTAMP' };
      break;

    // Foreign key modifiers
    case 'constrained': {
      if (!item.pendingRelation) {
        item.pendingRelation = {};
      }
      const targetTable = resolveString(args[0]);
      const targetColumn = resolveString(args[1]);
      if (targetTable) {
        item.pendingRelation.targetTable = targetTable;
      }
      if (targetColumn) {
        item.pendingRelation.targetColumn = targetColumn;
      } else if (!item.pendingRelation.targetColumn) {
        item.pendingRelation.targetColumn = 'id';
      }
      break;
    }

    case 'references': {
      if (!item.pendingRelation) item.pendingRelation = {};
      const targetColumn = resolveString(args[0]);
      if (targetColumn) item.pendingRelation.targetColumn = targetColumn;
      break;
    }

    case 'on': {
      if (!item.pendingRelation) item.pendingRelation = {};
      const targetTable = resolveString(args[0]);
      if (targetTable) item.pendingRelation.targetTable = targetTable;
      break;
    }

    case 'cascadeOnDelete':
      if (!item.pendingRelation) item.pendingRelation = {};
      item.pendingRelation.onDelete = 'cascade';
      break;

    case 'cascadeOnUpdate':
      if (!item.pendingRelation) item.pendingRelation = {};
      item.pendingRelation.onUpdate = 'cascade';
      break;

    case 'restrictOnDelete':
      if (!item.pendingRelation) item.pendingRelation = {};
      item.pendingRelation.onDelete = 'restrict';
      break;

    case 'nullOnDelete':
      if (!item.pendingRelation) item.pendingRelation = {};
      item.pendingRelation.onDelete = 'set null';
      break;

    case 'noActionOnDelete':
      if (!item.pendingRelation) item.pendingRelation = {};
      item.pendingRelation.onDelete = 'no action';
      break;

    case 'onDelete': {
      if (!item.pendingRelation) item.pendingRelation = {};
      const action = resolveString(args[0]);
      if (action) item.pendingRelation.onDelete = action.toLowerCase();
      break;
    }

    case 'onUpdate': {
      if (!item.pendingRelation) item.pendingRelation = {};
      const action = resolveString(args[0]);
      if (action) item.pendingRelation.onUpdate = action.toLowerCase();
      break;
    }
  }
}
