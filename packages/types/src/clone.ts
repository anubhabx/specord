export function cloneJsonValue<T>(
  value: T,
  seen = new WeakMap<object, unknown>(),
): T {
  if (Array.isArray(value)) {
    if (seen.has(value)) return seen.get(value) as T;

    const result: unknown[] = [];
    seen.set(value, result);
    value.forEach((child) => {
      result.push(cloneJsonValue(child, seen));
    });
    return result as T;
  }

  if (value && typeof value === "object") {
    if (seen.has(value)) return seen.get(value) as T;

    if (value instanceof Date) {
      return value.toISOString() as T;
    }

    if (value instanceof RegExp) {
      return value.toString() as T;
    }

    if (value instanceof Map) {
      const result: Record<string, unknown> = {};
      seen.set(value, result);
      for (const [key, child] of value.entries()) {
        result[String(key)] = cloneJsonValue(child, seen);
      }
      return result as T;
    }

    if (value instanceof Set) {
      const result: unknown[] = [];
      seen.set(value, result);
      for (const child of value.values()) {
        result.push(cloneJsonValue(child, seen));
      }
      return result as T;
    }

    const result: Record<string, unknown> = {};
    seen.set(value, result);
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      result[key] = cloneJsonValue(child, seen);
    }
    return result as T;
  }

  return value;
}
