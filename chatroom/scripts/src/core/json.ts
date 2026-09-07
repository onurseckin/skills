import { timingSafeEqual } from "node:crypto";

const textEncoder = new TextEncoder();

export function canonicalJson(
  value: unknown,
  seen: WeakSet<object> = new WeakSet<object>(),
): string {
  if (value === null || value === undefined) {
    return "null";
  }

  const valueType = typeof value;

  if (valueType === "boolean" || valueType === "string") {
    return JSON.stringify(value);
  }

  if (valueType === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("JSON numbers must be finite");
    }
    return JSON.stringify(value);
  }

  if (valueType === "bigint") {
    throw new TypeError("Do not know how to serialize a BigInt to JSON");
  }

  if (valueType === "function" || valueType === "symbol") {
    return "null";
  }

  if (valueType === "object") {
    const objectValue = value as object;

    const toJSONFn = (objectValue as { readonly toJSON?: unknown }).toJSON;
    if (typeof toJSONFn === "function") {
      const serialized = toJSONFn.call(objectValue);
      return canonicalJson(serialized, seen);
    }

    if (seen.has(objectValue)) {
      throw new TypeError("Circular reference in canonical JSON serialization");
    }
    seen.add(objectValue);

    try {
      if (Array.isArray(value)) {
        const items = value.map((item: unknown) => {
          if (item === undefined || typeof item === "function" || typeof item === "symbol") {
            return "null";
          }
          return canonicalJson(item, seen);
        });
        return `[${items.join(",")}]`;
      }

      const record = value as Readonly<Record<string, unknown>>;
      const sortedKeys = Object.keys(record).sort();
      const entries: string[] = [];

      for (const key of sortedKeys) {
        const prop = record[key];
        if (prop !== undefined && typeof prop !== "function" && typeof prop !== "symbol") {
          entries.push(`${JSON.stringify(key)}:${canonicalJson(prop, seen)}`);
        }
      }

      return `{${entries.join(",")}}`;
    } finally {
      seen.delete(objectValue);
    }
  }

  return JSON.stringify(value);
}

export function canonicalJsonBytes(value: unknown): Uint8Array {
  return textEncoder.encode(canonicalJson(value));
}

export function safeJsonParse(text: string): unknown {
  return JSON.parse(text) as unknown;
}

export function timingSafeEqualBuffers(
  left: Uint8Array | Buffer,
  right: Uint8Array | Buffer,
): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  const leftBuf = Buffer.isBuffer(left)
    ? left
    : Buffer.from(left.buffer, left.byteOffset, left.byteLength);
  const rightBuf = Buffer.isBuffer(right)
    ? right
    : Buffer.from(right.buffer, right.byteOffset, right.byteLength);
  return timingSafeEqual(leftBuf, rightBuf);
}

export function timingSafeEqualStrings(left: string, right: string): boolean {
  const leftBuf = Buffer.from(left, "utf8");
  const rightBuf = Buffer.from(right, "utf8");
  return timingSafeEqualBuffers(leftBuf, rightBuf);
}
