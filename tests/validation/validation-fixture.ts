/**
 * @file validation-fixture.ts
 * In-memory virtual test sandbox fixture and harness for tests/validation domain.
 * 100% zero disk writes, backed by VirtualMemoryFS and virtual descriptor session.
 */

import { afterEach } from "bun:test";
import { createHash } from "node:crypto";
import {
  VirtualMemoryFS,
  createVirtualFSSession,
  type VirtualFSSession,
} from "../../olt/scripts/src/testing/virtual-fs/index.ts";
import {
  disableInMemorySessionStore,
  enableInMemorySessionStore,
} from "../../olt/scripts/src/authority/session/paths.ts";
import type { TaskRecord } from "../../olt/scripts/src/workflow/types.ts";
import type { FeedbackItem } from "../../olt/scripts/src/mind/feedback/queue/index.ts";
import type { DualChannelFinding } from "./dual-channel/index.ts";

let currentSession: VirtualFSSession | null = null;
let currentVfs: VirtualMemoryFS = new VirtualMemoryFS();
let counter = 0;

export function setupVirtualValidationFS(): VirtualMemoryFS {
  enableInMemorySessionStore();
  if (!currentSession) {
    currentVfs = new VirtualMemoryFS();
    currentSession = createVirtualFSSession(currentVfs);
  }
  return currentVfs;
}

export function cleanupVirtualValidationFS(): void {
  disableInMemorySessionStore();
  if (currentSession) {
    currentSession.cleanup();
    currentSession = null;
  }
  currentVfs = new VirtualMemoryFS();
}

afterEach(() => {
  cleanupVirtualValidationFS();
});

function slug(value: string): string {
  const cleaned = value
    .replace(/\.+/g, "-")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const trimmed = cleaned.slice(0, 20).replace(/-+$/, "");
  return trimmed.length > 0 ? trimmed : "root";
}

function shortDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 8);
}

/**
 * Creates an in-memory virtual scratch sandbox directory for validation tests.
 * Zero physical disk writes occur.
 */
export function scratchRoot(callerPath = "validation-test", label = "test"): string {
  const vfs = setupVirtualValidationFS();
  counter += 1;
  const fileTag = slug(callerPath);
  const labelTag = slug(label);
  const digest = shortDigest(`${fileTag}:${labelTag}:${counter}`);
  const dirName = `${fileTag}-${labelTag}-${counter}-${digest}`
    .replace(/--+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/, "");
  const root = `/virtual/validation-scratch/${dirName}`;
  vfs.mkdirSync(root, { recursive: true });
  vfs.mkdirSync(`${root}/.olt/.sessions`, { recursive: true });
  return root;
}

export function createSandboxDir(label = "sandbox"): string {
  return scratchRoot("sandbox", label);
}

/**
 * Generates an in-memory 1x1 or custom-dimension valid PNG buffer.
 */
export function createMockPngBuffer(width = 1, height = 1): Buffer {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8-bit
  ihdr[9] = 2; // Truecolor
  ihdr[10] = 0; // Deflate
  ihdr[11] = 0; // Filter
  ihdr[12] = 0; // Interlace

  const ihdrChunk = createPngChunk("IHDR", ihdr);
  const idatChunk = createPngChunk("IDAT", Buffer.from([120, 156, 99, 0, 0, 0, 1, 0, 1]));
  const iendChunk = createPngChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createPngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcData = Buffer.concat([typeBuf, data]);
  const crc = crc32(crcData);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let j = 0; j < 8; j++) {
      c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

export function createMockFeedbackItem(overrides: Partial<FeedbackItem> = {}): FeedbackItem {
  return {
    id: "fb-001",
    feedback: "Fix issue with validator confinement",
    source: "critic",
    status: "pending",
    timestamp: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function createMockTaskRecord(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "task-001",
    type: "fix_defect",
    status: "in_progress",
    assignedTo: "implementer_1",
    assignedValidator: "validator_1",
    priority: "high",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function createMockDualChannelFinding(
  overrides: Partial<DualChannelFinding> = {},
): DualChannelFinding {
  return {
    id: "finding-001",
    channel: "headless",
    ruleId: "NO_ACCESSIBILITY_VIOLATIONS",
    severity: "error",
    message: "Missing aria-label on button",
    ...overrides,
  };
}
