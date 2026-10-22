export interface SourceRef {
  file: string;        // workspace-relative path, forward slashes
  migration: string;   // file basename without .php
  line: number;        // 1-based
  column: number;      // 1-based
}

export interface Column {
  name: string;
  type: string;                 // normalized: 'bigInteger','string','uuid',...
  rawMethod: string;            // original blueprint method, e.g. 'foreignId'
  length?: number;
  precision?: number;
  scale?: number;
  enumValues?: string[];
  nullable: boolean;
  default?: string | number | boolean | null | { raw: string };
  unsigned: boolean;
  autoIncrement: boolean;
  primary: boolean;
  unique: boolean;
  index: boolean;
  comment?: string;
  source: SourceRef;
}

export interface Index {
  name?: string;
  kind: 'primary' | 'unique' | 'index' | 'fulltext' | 'spatial';
  columns: string[];
  source: SourceRef;
}

export interface Table {
  name: string;
  columns: Column[];            // in declaration order
  indexes: Index[];
  comment?: string;
  source: SourceRef;            // the Schema::create call
}

export interface Relation {
  id: string;                                   // deterministic: `${from.table}.${from.column}->${to.table}.${to.column}`
  from: { table: string; column: string };      // FK side (child)
  to:   { table: string; column: string };      // referenced side (parent)
  kind: 'explicit' | 'inferred' | 'polymorphic';
  cardinality: '1:N' | '1:1';                   // 1:1 if FK column is unique
  onDelete?: string;                            // 'cascade' | 'set null' | 'restrict' | 'no action'
  onUpdate?: string;
  source?: SourceRef;
}

export interface Warning {
  code: 'UNSUPPORTED_CALL' | 'DYNAMIC_VALUE' | 'PARSE_ERROR'
      | 'UNKNOWN_TABLE' | 'UNKNOWN_COLUMN' | 'RAW_SQL';
  message: string;
  source: SourceRef;
}

export interface SchemaIR {
  tables: Table[];
  relations: Relation[];
  warnings: Warning[];
  migrationsApplied: string[];  // ordered
}
