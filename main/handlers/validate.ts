/**
 * Minimal runtime validation for IPC boundary inputs. Handlers receive `unknown`
 * and use these guards rather than trusting the renderer or casting to `any`.
 */
export function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    throw new Error(`${context}: expected an object payload`);
  }
  return value as Record<string, unknown>;
}

export function reqString(obj: Record<string, unknown>, key: string, context: string): string {
  const value = obj[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${context}: missing required string "${key}"`);
  }
  return value;
}

export function optString(obj: Record<string, unknown>, key: string): string | undefined {
  const value = obj[key];
  return typeof value === "string" ? value : undefined;
}

export function reqNumber(obj: Record<string, unknown>, key: string, context: string): number {
  const value = obj[key];
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`${context}: missing required number "${key}"`);
  }
  return value;
}

export function reqBool(obj: Record<string, unknown>, key: string, context: string): boolean {
  const value = obj[key];
  if (typeof value !== "boolean") {
    throw new Error(`${context}: missing required boolean "${key}"`);
  }
  return value;
}
