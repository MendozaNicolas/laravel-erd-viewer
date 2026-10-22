import pluralize from 'pluralize';

/**
 * Converts CamelCase or PascalCase to snake_case.
 */
export function toSnakeCase(str: string): string {
  return str
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase();
}

/**
 * Given a foreign key column name like `user_id`, returns the expected table name `users`.
 * Returns null if the column does not match the `_id` convention.
 */
export function inferTableFromForeignKey(columnName: string): string | null {
  if (!columnName.endsWith('_id') || columnName.length <= 3) {
    return null;
  }
  const singular = columnName.slice(0, -3);
  return pluralize.plural(singular);
}

/**
 * Given a Model class name (e.g. "User" or "BlogPost"), returns the foreign key column name
 * and default target table name.
 */
export function modelToForeignKeyAndTable(modelName: string): { column: string; table: string } {
  const snake = toSnakeCase(modelName);
  return {
    column: `${snake}_id`,
    table: pluralize.plural(snake),
  };
}

/**
 * Checks if a table name appears to be a standard Laravel many-to-many pivot table (e.g. `post_tag`).
 */
export function isPivotTableName(tableName: string, existingTableNames: Set<string>): boolean {
  const parts = tableName.split('_');
  if (parts.length !== 2) return false;

  const [singular1, singular2] = parts;
  const plural1 = pluralize.plural(singular1);
  const plural2 = pluralize.plural(singular2);

  return existingTableNames.has(plural1) && existingTableNames.has(plural2);
}
