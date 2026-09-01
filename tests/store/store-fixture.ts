/**
 * @file store-fixture.ts
 * In-memory / fast test sandbox fixture and harness for tests/store domain
 */

import { afterEach } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  HarnessEvent,
  JsonObject,
  Manifest,
  RunState,
} from "../../olt/scripts/src/core/contracts/index.ts";
import { canonicalJsonBytes, sha256Bytes } from "../../olt/scripts/src/core/json.ts";
import { initialState } from "../../olt/scripts/src/engine/store/capsule/state.ts";

const SCRATCH_BASE = join(tmpdir(), "store-scratch");
const rootsToClean: string[] = [];

afterEach(() => {
  for (const root of rootsToClean) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {}
  }
  rootsToClean.length = 0;
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

let counter = 0;

/**
 * Creates an isolated scratch sandbox directory for testing.
 * Automatically registered for cleanup in afterEach hooks.
 */
export function scratchRoot(callerPath = "store-test", label = "test"): string {
  counter += 1;
  const fileTag = slug(callerPath);
  const labelTag = slug(label);
  const digest = shortDigest(`${fileTag}:${labelTag}:${counter}`);
  const raw = `${fileTag}-${labelTag}-${counter}-${digest}`
    .replace(/--+/g, "-")
    .replace(/^-+|-+$/g, "");
  const dirName = raw.slice(0, 50).replace(/-+$/, "");
  const root = join(SCRATCH_BASE, dirName);

  try {
    rmSync(root, { recursive: true, force: true });
  } catch {}

  mkdirSync(root, { recursive: true });
  rootsToClean.push(root);
  return root;
}

export function createSandboxDir(label = "sandbox"): string {
  return scratchRoot("sandbox", label);
}

export function createInMemoryManifest(overrides: Partial<Manifest> = {}): Manifest {
  const promptBytes = new TextEncoder().encode("test prompt");
  return {
    schema: "harness.capsule.manifest",
    version: 1,
    run_id: "in-memory-run-001",
    capsule_id: "0123456789abcdef0123456789abcdef",
    prompt_sha256: sha256Bytes(promptBytes),
    prompt_bytes: promptBytes.byteLength,
    capture_mode: "file",
    source_verified: true,
    assurance: "source_verified",
    mode: "feature",
    created_at: "2026-01-01T00:00:00.000Z",
    bun_version: "1.4.0",
    bun_compatibility: "bun-1.4+",
    runtime_version: "0.1.0",
    ...overrides,
  };
}

export function createInMemoryRunState(overrides: Partial<RunState> = {}): RunState {
  return {
    ...initialState(),
    ...overrides,
  };
}

export function createInMemoryEvent(
  sequence: number,
  overrides: Partial<HarnessEvent> = {},
): HarnessEvent {
  const basePayload: JsonObject = { note: `event-${sequence}` };
  const payloadBytes = canonicalJsonBytes(basePayload);
  return {
    schema: "harness.event",
    version: 1,
    sequence,
    timestamp: "2026-01-01T00:00:00.000Z",
    run_id: "in-memory-run-001",
    capsule_id: "0123456789abcdef0123456789abcdef",
    actor: "in-memory-actor",
    kind: "step",
    payload: basePayload,
    payload_sha256: sha256Bytes(payloadBytes),
    previous_hash: "0".repeat(64),
    event_hash: sha256Bytes(new TextEncoder().encode(`event-${sequence}`)),
    revision: sequence,
    ...overrides,
  };
}

export class InMemoryRunHarness {
  public manifest: Manifest;
  public state: RunState;
  private readonly eventLog: HarnessEvent[] = [];
  private readonly blobStore: Map<string, Uint8Array> = new Map();

  constructor(runId = "in-memory-run-001", manifestOverrides: Partial<Manifest> = {}) {
    this.manifest = createInMemoryManifest({ run_id: runId, ...manifestOverrides });
    this.state = createInMemoryRunState();
  }

  public getEvents(): readonly HarnessEvent[] {
    return [...this.eventLog];
  }

  public getState(): RunState {
    return { ...this.state };
  }

  public recordEvent(event: HarnessEvent): void {
    this.eventLog.push(event);
  }

  public putBlob(content: Uint8Array): { sha256: string; size: number } {
    const digest = sha256Bytes(content);
    this.blobStore.set(digest, content);
    return { sha256: digest, size: content.byteLength };
  }

  public getBlob(sha256: string): Uint8Array | undefined {
    return this.blobStore.get(sha256);
  }

  public hasBlob(sha256: string): boolean {
    return this.blobStore.has(sha256);
  }

  public reset(): void {
    this.eventLog.length = 0;
    this.blobStore.clear();
    this.state = createInMemoryRunState();
  }
}

export function createInMemoryRunHarness(
  runId = "in-memory-run-001",
  overrides: Partial<Manifest> = {},
): InMemoryRunHarness {
  return new InMemoryRunHarness(runId, overrides);
}
