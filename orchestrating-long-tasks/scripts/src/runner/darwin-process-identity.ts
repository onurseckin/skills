const BSD_INFO_BYTES = 136;

export function parseDarwinProcessIdentity(
  info: Uint8Array,
  pid: number,
): { pid: number; parent: number; group: number; birth: string } | undefined {
  if (info.byteLength < BSD_INFO_BYTES) return undefined;
  const bytes = Buffer.from(info.buffer, info.byteOffset, info.byteLength);
  if (bytes.readUInt32LE(12) !== pid) return undefined;
  return {
    pid,
    parent: bytes.readUInt32LE(16),
    group: bytes.readUInt32LE(100),
    birth: `${bytes.readBigUInt64LE(120)}:${bytes.readBigUInt64LE(128)}`,
  };
}
