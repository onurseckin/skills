import { describe, expect, it } from "bun:test";
import {
  captureEnvironmentContext,
  captureSessionContext,
  captureViewportContext,
  computeDomPhysicsHash,
  computeMerkleRoot,
  computeNodeStateHash,
  createSnapshotContext,
  GENESIS_MERKLE_ROOT,
  sha256Hex,
  verifySnapshotIntegrity,
} from "../../../olt/scripts/src/capture/snapshot/index.ts";
import type { DomPhysicsSnapshot } from "../../../olt/scripts/src/capture/runners/types.ts";
import type { SnapshotNode } from "../../../olt/scripts/src/capture/snapshot/types.ts";
import {
  createInMemorySessionAuth,
  createInMemorySessionContext,
  createInMemorySessionToken,
  createSandboxDir,
  scratchRoot,
} from "../session-fixture.ts";

function createSamplePhysics(): DomPhysicsSnapshot {
  return {
    viewport: { width: 1920, height: 1080, deviceScaleFactor: 2 },
    scrollPosition: { x: 0, y: 0 },
    capturedAt: "2026-08-31T12:00:00.000Z",
    elements: [
      {
        selector: "nav.main-nav",
        tagName: "NAV",
        bounds: { x: 0, y: 0, width: 1920, height: 64, top: 0, left: 0, right: 1920, bottom: 64 },
        computedStyles: {
          display: "flex",
          position: "relative",
          zIndex: 10,
          backgroundColor: "rgb(11, 10, 13)",
          color: "rgb(255, 255, 255)",
          overflowX: "visible",
          overflowY: "visible",
        },
        metrics: {
          scrollWidth: 1920,
          scrollHeight: 64,
          clientWidth: 1920,
          clientHeight: 64,
          offsetWidth: 1920,
          offsetHeight: 64,
        },
      },
    ],
    layoutOverflows: [],
    textClippings: [],
  };
}

describe("Context Capture & Cryptographic State Hashing", () => {
  it("captures execution environment metrics and generates SHA-256 fingerprint", () => {
    const env = captureEnvironmentContext();
    expect(env.platform).toBe(process.platform);
    expect(env.runtime).toBe("bun");
    expect(typeof env.heapUsedBytes).toBe("number");
    expect(env.heapUsedBytes).toBeGreaterThan(0);
    expect(env.environmentSha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("captures viewport metrics with landscape and touch detection", () => {
    const desktopVp = captureViewportContext({ name: "desktop", width: 1440, height: 900 });
    expect(desktopVp.isLandscape).toBe(true);
    expect(desktopVp.deviceScaleFactor).toBe(1);
    expect(desktopVp.hasTouch).toBe(false);

    const mobileVp = captureViewportContext(
      { name: "mobile", width: 390, height: 844, deviceScaleFactor: 3 },
      { hasTouch: true },
    );
    expect(mobileVp.isLandscape).toBe(false);
    expect(mobileVp.deviceScaleFactor).toBe(3);
    expect(mobileVp.hasTouch).toBe(true);
  });

  it("captures authenticated session context with cryptographic token hashing (zero cleartext)", () => {
    const unauth = captureSessionContext();
    expect(unauth.authenticated).toBe(false);

    const rawSecret = "super-secret-token-xyz";
    const auth = captureSessionContext({
      role: "admin",
      personaId: "admin-1",
      token: rawSecret,
    });

    expect(auth.authenticated).toBe(true);
    expect(auth.role).toBe("admin");
    expect(auth.personaId).toBe("admin-1");
    expect(auth.sessionHash).toBe(sha256Hex(`SESSION_TOKEN:${rawSecret}`));
    expect(JSON.stringify(auth)).not.toContain(rawSecret);
  });

  it("computes deterministic DOM physics hash", () => {
    const physics1 = createSamplePhysics();
    const physics2 = createSamplePhysics();

    const hash1 = computeDomPhysicsHash(physics1);
    const hash2 = computeDomPhysicsHash(physics2);

    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[a-f0-9]{64}$/);

    const alteredPhysics: DomPhysicsSnapshot = {
      ...physics1,
      elements: [
        {
          ...physics1.elements[0],
          bounds: { x: 0, y: 0, width: 1920, height: 80 },
        },
      ],
    };
    const alteredHash = computeDomPhysicsHash(alteredPhysics);
    expect(alteredHash).not.toBe(hash1);
  });

  it("computes hierarchical Merkle root across variable leaf node sets", () => {
    expect(computeMerkleRoot([])).toBe(GENESIS_MERKLE_ROOT);

    const h1 = sha256Hex("node-1");
    const singleRoot = computeMerkleRoot([h1]);
    expect(singleRoot).toBe(sha256Hex(`LEAF:${h1}`));

    const h2 = sha256Hex("node-2");
    const h3 = sha256Hex("node-3");
    const multiRoot = computeMerkleRoot([h1, h2, h3]);
    expect(multiRoot).toMatch(/^[a-f0-9]{64}$/);

    const shuffledRoot = computeMerkleRoot([h3, h1, h2]);
    expect(shuffledRoot).toBe(multiRoot);
  });

  it("verifies snapshot node integrity and catches tampering", () => {
    const context = createSnapshotContext({
      viewport: { name: "desktop", width: 1440, height: 900 },
      url: "http://localhost:3000/dashboard",
    });
    const physics = createSamplePhysics();

    const stateHash = computeNodeStateHash({
      context,
      physics,
      label: "Initial Render",
      sequence: 1,
    });

    const validNode: SnapshotNode = {
      id: "node-1",
      label: "Initial Render",
      sequence: 1,
      createdAt: new Date().toISOString(),
      depth: 0,
      context,
      physics,
      stateHash,
      merkleRoot: computeMerkleRoot([stateHash]),
      children: [],
    };

    expect(verifySnapshotIntegrity(validNode)).toBe(true);

    const tamperedNode: SnapshotNode = {
      ...validNode,
      label: "Modified Render Without Re-hashing",
    };
    expect(verifySnapshotIntegrity(tamperedNode)).toBe(false);
  });

  it("verifies pure in-memory session fixture generators and sandboxing", () => {
    const auth = createInMemorySessionAuth({ userId: "custom-user" });
    expect(auth.userId).toBe("custom-user");
    expect(auth.role).toBe("implementer");
    expect(auth.headers["Authorization"]).toContain("Bearer");

    const token = createInMemorySessionToken("test-token");
    expect(token.startsWith("test-token-")).toBe(true);

    const ctx = createInMemorySessionContext({ role: "validator" });
    expect(ctx.role).toBe("validator");
    expect(ctx.status).toBe("active");

    const root = scratchRoot(import.meta.path, "test");
    expect(typeof root).toBe("string");
    const sandbox = createSandboxDir("test-sandbox");
    expect(typeof sandbox).toBe("string");
  });
});
