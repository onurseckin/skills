import { describe, expect, test } from "bun:test";
import * as storeIndex from "../../../olt/scripts/src/engine/store/index.ts";
import {
  createInMemoryEvent,
  createInMemoryManifest,
  createInMemoryRunHarness,
  createInMemoryRunState,
  createSandboxDir,
  InMemoryRunHarness,
  scratchRoot,
  setupVirtualStoreFS,
} from "../index.ts";

setupVirtualStoreFS();

describe("store barrel exports", () => {
  test("re-exports the public store API surface", () => {
    expect(typeof storeIndex.initRun).toBe("function");
    expect(typeof storeIndex.loadRun).toBe("function");
    expect(typeof storeIndex.recoverProjection).toBe("function");
    expect(typeof storeIndex.transact).toBe("function");
    expect(typeof storeIndex.verifyIntegrity).toBe("function");
    expect(typeof storeIndex.verifyCapsuleDeep).toBe("function");
    expect(typeof storeIndex.indexFreshness).toBe("function");
    expect(typeof storeIndex.loadIndex).toBe("function");
    expect(typeof storeIndex.appendCapsuleDefect).toBe("function");
    expect(typeof storeIndex.loadCapsuleDefects).toBe("function");
    expect(typeof storeIndex.compactCapsuleDefects).toBe("function");
    expect(typeof storeIndex.resolveCapsuleDefect).toBe("function");
    expect(typeof storeIndex.pruneCapsuleBoilerplate).toBe("function");
    expect(typeof storeIndex.archiveCapsule).toBe("function");
    expect(typeof storeIndex.consolidateCapsules).toBe("function");
    expect(typeof storeIndex.isEffectivelyEmptyDirectory).toBe("function");
    expect(Array.isArray(storeIndex.BOILERPLATE_CAPSULE_SUBDIRECTORIES)).toBe(true);
  });

  test("in-memory fixture helpers generate valid RAM structures", () => {
    const manifest = createInMemoryManifest({ run_id: "test-run" });
    expect(manifest.run_id).toBe("test-run");
    expect(manifest.schema).toBe("harness.capsule.manifest");

    const state = createInMemoryRunState({ revision: 5 });
    expect(state.revision).toBe(5);

    const event = createInMemoryEvent(1, { actor: "test-actor" });
    expect(event.sequence).toBe(1);
    expect(event.actor).toBe("test-actor");

    const harness = createInMemoryRunHarness("ram-run-1");
    expect(harness).toBeInstanceOf(InMemoryRunHarness);
    expect(harness.manifest.run_id).toBe("ram-run-1");
    expect(harness.getState().revision).toBe(0);

    harness.recordEvent(event);
    expect(harness.getEvents()).toHaveLength(1);
    expect(harness.getEvents()[0]?.sequence).toBe(1);

    const sampleBlob = new TextEncoder().encode("virtual blob content");
    const { sha256, size } = harness.putBlob(sampleBlob);
    expect(size).toBe(sampleBlob.byteLength);
    expect(harness.hasBlob(sha256)).toBe(true);
    expect(harness.getBlob(sha256)).toEqual(sampleBlob);

    harness.reset();
    expect(harness.getEvents()).toHaveLength(0);
    expect(harness.hasBlob(sha256)).toBe(false);

    const root = scratchRoot(import.meta.path, "test");
    expect(typeof root).toBe("string");
    const sandbox = createSandboxDir("test-sandbox");
    expect(typeof sandbox).toBe("string");
  });
});
