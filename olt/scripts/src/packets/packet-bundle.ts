import { randomUUID } from "node:crypto";
import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteBytes, fsyncDirectory } from "../core/durable-write.ts";
import { canonicalJsonBytes } from "../core/json.ts";
import { readRegularFileNoFollow } from "../core/no-follow.ts";
import { HarnessError } from "../core/errors/harness-error.ts";
import { safeRmSync } from "../core/shared/safe-fs.ts";
import type { BuiltPacket } from "./types.ts";

export interface PacketPaths {
  markdownPath: string;
  metadataPath: string;
}

function paths(root: string, id: string): PacketPaths {
  const bundle = join(root, id);
  return { markdownPath: join(bundle, "packet.md"), metadataPath: join(bundle, "metadata.json") };
}

function exactBundle(root: string, id: string, packet: BuiltPacket): boolean {
  const bundle = join(root, id);
  try {
    if (!lstatSync(bundle).isDirectory()) return false;
    if (readdirSync(bundle).sort().join("\n") !== "metadata.json\npacket.md") return false;
    const target = paths(root, id);
    const markdown = readRegularFileNoFollow(target.markdownPath);
    const metadata = readRegularFileNoFollow(target.metadataPath);
    return (
      Buffer.from(markdown).equals(Buffer.from(packet.markdown)) &&
      Buffer.from(metadata).equals(Buffer.from(canonicalJsonBytes(packet.metadata)))
    );
  } catch {
    return false;
  }
}

export function verifyPacketBundle(root: string, id: string, packet: BuiltPacket): PacketPaths {
  if (!exactBundle(root, id, packet))
    throw new HarnessError("INTEGRITY", `packet bundle is missing or differs: ${id}`);
  return paths(root, id);
}

export function createPacketBundle(
  root: string,
  id: string,
  packet: BuiltPacket,
  allowExact: boolean,
): PacketPaths {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(id))
    throw new HarnessError("INVALID_ARGUMENT", "unsafe packet id");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const final = join(root, id);
  if (existsSync(final)) {
    if (allowExact && exactBundle(root, id, packet)) return paths(root, id);
    throw new HarnessError("INVALID_STATE", `packet bundle already exists: ${id}`);
  }
  const temporary = join(root, `.${id}.${randomUUID()}.tmp`);
  mkdirSync(temporary, { mode: 0o700 });
  try {
    atomicWriteBytes(join(temporary, "packet.md"), Buffer.from(packet.markdown), { mode: 0o444 });
    atomicWriteBytes(join(temporary, "metadata.json"), canonicalJsonBytes(packet.metadata), {
      mode: 0o444,
    });
    fsyncDirectory(temporary);
    renameSync(temporary, final);
    chmodSync(final, 0o755);
    fsyncDirectory(final);
    fsyncDirectory(root);
    return paths(root, id);
  } catch (error) {
    safeRmSync(temporary, { allowedRoots: [root], missingOk: true });
    throw error;
  }
}
