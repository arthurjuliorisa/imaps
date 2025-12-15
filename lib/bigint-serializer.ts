/**
 * Converts BigInt fields to strings for JSON serialization
 * This is necessary because JavaScript's JSON.stringify cannot serialize BigInt values
 */
export function serializeBigInt<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === 'bigint') {
    return String(obj) as T;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => serializeBigInt(item)) as T;
  }

  if (typeof obj === 'object') {
    const serialized: any = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        serialized[key] = serializeBigInt((obj as any)[key]);
      }
    }
    return serialized;
  }

  return obj;
}
