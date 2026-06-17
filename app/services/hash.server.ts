import { createHash } from "node:crypto";

export function stableHash(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value, objectKeySorter))
    .digest("hex");
}

function objectKeySorter(_key: string, value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((sorted, key) => {
      sorted[key] = (value as Record<string, unknown>)[key];
      return sorted;
    }, {});
}
