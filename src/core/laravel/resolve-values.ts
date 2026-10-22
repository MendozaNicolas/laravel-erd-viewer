import type { Node } from 'php-parser';

export type ResolvedValue =
  | string
  | number
  | boolean
  | null
  | ResolvedValue[]
  | { raw: string };

/**
 * Resolves static/literal PHP AST expressions to JavaScript values.
 */
export function resolveValue(node: Node | null | undefined): ResolvedValue | undefined {
  if (!node) return undefined;

  switch (node.kind) {
    case 'string':
      return typeof node.value === 'string' ? node.value : String(node.value);

    case 'number': {
      const n = Number(node.value);
      return isNaN(n) ? node.value : n;
    }

    case 'boolean':
      return Boolean(node.value);

    case 'nullkeyword':
    case 'null':
      return null;

    case 'array': {
      const items: ResolvedValue[] = [];
      if (Array.isArray(node.items)) {
        for (const item of node.items) {
          if (item) {
            // item can be an array entry: { value: Node, key?: Node }
            const val = item.value ? resolveValue(item.value) : resolveValue(item);
            if (val !== undefined) {
              items.push(val);
            }
          }
        }
      }
      return items;
    }

    case 'identifier':
      return node.name;

    case 'staticlookup':
    case 'classconstant': {
      // E.g. User::class or Post::STATUS_ACTIVE
      const what = node.what?.name || node.what?.value || 'Unknown';
      const offset = node.offset?.name || node.offset?.value || '';
      if (offset.toLowerCase() === 'class') {
        // Return unqualified class name or full name
        const parts = String(what).split('\\');
        return parts[parts.length - 1];
      }
      return `${what}::${offset}`;
    }

    case 'unary': {
      const inner = resolveValue(node.what);
      if (typeof inner === 'number' && node.type === '-') {
        return -inner;
      }
      if (typeof inner === 'boolean' && node.type === '!') {
        return !inner;
      }
      return inner;
    }

    default:
      if (node.raw) {
        return { raw: String(node.raw) };
      }
      return undefined;
  }
}

/**
 * Convenience helper to resolve a string argument or return a fallback.
 */
export function resolveString(node: Node | null | undefined): string | undefined {
  const val = resolveValue(node);
  if (typeof val === 'string') return val;
  if (typeof val === 'number') return String(val);
  return undefined;
}

/**
 * Convenience helper to resolve an array of strings (e.g. columns list).
 */
export function resolveStringArray(node: Node | null | undefined): string[] {
  if (!node) return [];
  const val = resolveValue(node);
  if (typeof val === 'string') return [val];
  if (Array.isArray(val)) {
    return val.filter((item): item is string => typeof item === 'string');
  }
  return [];
}
