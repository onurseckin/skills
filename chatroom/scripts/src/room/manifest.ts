import { existsSync, readFileSync } from "node:fs";
import {
  canonicalJson,
  ChatError,
  isRoomManifest,
  roomManifestPath,
  safeJsonParse,
  writeAtomic,
  type RoomManifest,
  type RoomSettings,
} from "../core/index.ts";

export const DEFAULT_ROOM_SETTINGS: RoomSettings = {
  lease_ttl_ms: 120000,
  max_payload_bytes: 262144,
  segment_max_bytes: 8388608,
  segment_max_lines: 5000,
};

export function createDefaultRoomSettings(overrides?: Partial<RoomSettings>): RoomSettings {
  return {
    lease_ttl_ms: overrides?.lease_ttl_ms ?? DEFAULT_ROOM_SETTINGS.lease_ttl_ms,
    max_payload_bytes: overrides?.max_payload_bytes ?? DEFAULT_ROOM_SETTINGS.max_payload_bytes,
    segment_max_bytes: overrides?.segment_max_bytes ?? DEFAULT_ROOM_SETTINGS.segment_max_bytes,
    segment_max_lines: overrides?.segment_max_lines ?? DEFAULT_ROOM_SETTINGS.segment_max_lines,
  };
}

export function roomManifestExists(roomId: string): boolean {
  return existsSync(roomManifestPath(roomId));
}

export function readRoomManifest(roomId: string): RoomManifest {
  const manifestPath = roomManifestPath(roomId);
  if (!existsSync(manifestPath)) {
    throw new ChatError("UNKNOWN_ROOM", `Room '${roomId}' not found`);
  }

  try {
    const raw = readFileSync(manifestPath, "utf8");
    const parsed = safeJsonParse(raw);
    if (!isRoomManifest(parsed)) {
      throw new ChatError("CORRUPT_LAYOUT", `Corrupt room manifest at '${manifestPath}'`);
    }
    return parsed;
  } catch (error: unknown) {
    if (error instanceof ChatError) {
      throw error;
    }
    throw new ChatError(
      "CORRUPT_LAYOUT",
      `Failed to parse room manifest at '${manifestPath}': ${String(error)}`,
    );
  }
}

export function writeRoomManifest(manifest: RoomManifest): void {
  if (!isRoomManifest(manifest)) {
    throw new ChatError("INVALID_ARGUMENT", "Invalid room manifest object");
  }
  const manifestPath = roomManifestPath(manifest.id);
  const serialized = canonicalJson(manifest);
  writeAtomic(manifestPath, serialized);
}
