import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJsonBytes } from "../../../olt/scripts/src/core/json.ts";
import * as store from "../../../olt/scripts/src/engine/store/index.ts";
import { initRun, loadRun, transact } from "../../../olt/scripts/src/engine/store/index.ts";
import { executeRung0 } from "../../../olt/scripts/src/mind/lanes/rescue/rungs/rung0.ts";
import type { RescueLaneOptions } from "../../../olt/scripts/src/mind/lanes/rescue/types.ts";
import {
  cleanupVirtualStoreFS,
  getVirtualStoreFS,
  scratchRoot,
  setupVirtualStoreFS,
} from "../../store/store-fixture.ts";

describe("Rung 0 Rescue Lane Coverage Suite", () => {
  beforeEach(() => setupVirtualStoreFS());
  afterEach(() => cleanupVirtualStoreFS());

  function fixture(label: string) {
    const repoRoot = scratchRoot(import.meta.path, `${label}-repo`);
    const prompt = new TextEncoder().encode("Mind test prompt");
    const mindRunRoot = initRun(repoRoot, `mind-${label}`, prompt, "file", true);
    return { repoRoot, mindRunRoot, prompt, actor: "mind-tester" };
  }

  function writeCharter(repoRoot: string, rel = "olt/agents/mind.yaml", content = "name: mind\n") {
    const full = join(repoRoot, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
    return createHash("sha256").update(new TextEncoder().encode(content)).digest("hex");
  }

  function setupHealthy(label: string) {
    const { repoRoot, mindRunRoot, actor } = fixture(label);
    const sha = writeCharter(repoRoot);
    transact(mindRunRoot, actor, "setup", {}, (draft) => {
      draft.mind = {
        charter: { pinned_sha256: sha, source_path: "olt/agents/mind.yaml" },
      } as unknown as Record<string, unknown>;
    });
    return { repoRoot, mindRunRoot, actor, sha };
  }

  async function invokeRung0(
    mindRunRoot: string,
    loadedMind: ReturnType<typeof loadRun>,
    repoRoot: string,
    options: RescueLaneOptions = {},
  ) {
    const actionsTaken: string[] = [];
    const escalations: string[] = [];
    const nowMs = 1756700000000;
    const result = await executeRung0({
      mindRunRoot,
      loadedMind,
      repoRoot,
      actor: "mind-tester",
      nowMs,
      nowIso: new Date(nowMs).toISOString(),
      options,
      actionsTaken,
      escalations,
    });
    return { result, actionsTaken, escalations };
  }

  it("halts with 'charter file missing' when charter file does not exist on disk", async () => {
    const { repoRoot, mindRunRoot } = fixture("charter-missing");
    const { result, actionsTaken, escalations } = await invokeRung0(
      mindRunRoot,
      loadRun(mindRunRoot, false),
      repoRoot,
    );

    expect(result.charterDrifted && result.halted).toBe(true);
    expect(result.haltReason).toBe("charter file missing");
    expect(actionsTaken).toContain("Rung 0: HALT triggered due to charter file missing");
    expect(escalations).toContain("charter file missing");

    const reloaded = loadRun(mindRunRoot, false);
    expect((reloaded.state.mind as Record<string, unknown>).halted).toBe(true);
    const escList = reloaded.state.escalations as Array<Record<string, unknown>> | undefined;
    expect(escList?.[0]?.reason).toBe("charter_missing");
  });

  it("handles charter read errors by marking charter file missing", async () => {
    const { repoRoot, mindRunRoot } = fixture("charter-read-err");
    writeCharter(repoRoot);
    const vfs = getVirtualStoreFS();
    const origRead = vfs.readFileSync.bind(vfs);
    vfs.readFileSync = (p, opt) => {
      if (String(p).includes("mind.yaml")) throw new Error("EACCES: permission denied");
      return origRead(p, opt);
    };

    try {
      const { result } = await invokeRung0(mindRunRoot, loadRun(mindRunRoot, false), repoRoot);
      expect(result.charterDrifted && result.halted).toBe(true);
      expect(result.haltReason).toBe("charter file missing");
    } finally {
      vfs.readFileSync = origRead;
    }
  });

  it("halts with 'charter drifted from pinned digest' when charter hash does not match pinned_sha256", async () => {
    const { repoRoot, mindRunRoot, actor } = fixture("charter-drifted");
    writeCharter(repoRoot, "olt/agents/mind.yaml", "name: mind-modified\n");
    transact(mindRunRoot, actor, "setup", {}, (draft) => {
      draft.mind = {
        charter: { pinned_sha256: "0".repeat(64), source_path: "olt/agents/mind.yaml" },
      } as unknown as Record<string, unknown>;
    });

    const { result, actionsTaken, escalations } = await invokeRung0(
      mindRunRoot,
      loadRun(mindRunRoot, false),
      repoRoot,
    );
    expect(result.charterDrifted && result.halted).toBe(true);
    expect(result.haltReason).toBe("charter drifted from pinned digest");
    expect(actionsTaken).toContain(
      "Rung 0: HALT triggered due to charter drifted from pinned digest",
    );
    expect(escalations).toContain("charter drifted from pinned digest");
  });

  it("halts with 'runtime drifted' when runtimeFreshnessOverride specifies drifted: true", async () => {
    const { repoRoot, mindRunRoot, actor } = fixture("runtime-drifted");
    const sha = writeCharter(repoRoot);
    transact(mindRunRoot, actor, "setup", {}, (draft) => {
      draft.mind = { charter: { pinned_sha256: sha } } as unknown as Record<string, unknown>;
    });

    const opts = { runtimeFreshnessOverride: { drifted: true, referenceRuntimeVersion: "1.0.0" } };
    const { result, actionsTaken, escalations } = await invokeRung0(
      mindRunRoot,
      loadRun(mindRunRoot, false),
      repoRoot,
      opts,
    );
    expect(result.runtimeDrifted && result.halted).toBe(true);
    expect(result.haltReason).toBe("runtime drifted");
    expect(actionsTaken).toContain("Rung 0: HALT triggered due to runtime drifted");
    expect(escalations).toContain("runtime drifted");
  });

  it("proceeds with zero halts when charter, runtime, and capsule integrity are fully healthy", async () => {
    const { repoRoot, mindRunRoot } = setupHealthy("healthy");
    const opts = { runtimeFreshnessOverride: { drifted: false, referenceRuntimeVersion: "1.0.0" } };
    const { result, actionsTaken, escalations } = await invokeRung0(
      mindRunRoot,
      loadRun(mindRunRoot, false),
      repoRoot,
      opts,
    );
    expect(
      result.halted ||
        result.charterDrifted ||
        result.runtimeDrifted ||
        result.integrityRepaired ||
        result.integrityFailed,
    ).toBe(false);
    expect(actionsTaken.length === 0 && escalations.length === 0).toBe(true);
  });

  it("handles fallback to prompt_sha256 and no runtime override without halting", async () => {
    const { repoRoot, mindRunRoot, prompt } = fixture("prompt-sha-fallback");
    writeCharter(repoRoot, "olt/agents/mind.yaml", new TextDecoder().decode(prompt));
    const { result } = await invokeRung0(mindRunRoot, loadRun(mindRunRoot, false), repoRoot);
    expect(result.charterDrifted || result.runtimeDrifted || result.halted).toBe(false);
  });

  it("resolves custom charter source_path and custom repo_roots in charterRecord", async () => {
    const { repoRoot, mindRunRoot, actor } = fixture("custom-charter-path");
    const customRel = "sub-module/custom-mind.yaml";
    const sha = writeCharter(repoRoot, customRel, "domain: custom\n");
    transact(mindRunRoot, actor, "setup", {}, (draft) => {
      draft.mind = {
        charter: { source_path: customRel, repo_roots: ["sub-module", 123], pinned_sha256: sha },
      } as unknown as Record<string, unknown>;
    });
    const opts = { runtimeFreshnessOverride: { drifted: false, referenceRuntimeVersion: "1.0.0" } };
    const { result } = await invokeRung0(mindRunRoot, loadRun(mindRunRoot, false), repoRoot, opts);
    expect(result.charterDrifted || result.halted).toBe(false);
  });

  it("repairs projection mismatch integrity issues via doctor and recoverProjection", async () => {
    const { repoRoot, mindRunRoot } = setupHealthy("repairable-integrity");
    const loadedMind = loadRun(mindRunRoot, false);
    const stateObj = JSON.parse(readFileSync(join(mindRunRoot, "state.json"), "utf-8"));
    stateObj.revision = 999;
    writeFileSync(join(mindRunRoot, "state.json"), canonicalJsonBytes(stateObj));

    const opts = { runtimeFreshnessOverride: { drifted: false, referenceRuntimeVersion: "1.0.0" } };
    const { result, actionsTaken } = await invokeRung0(mindRunRoot, loadedMind, repoRoot, opts);
    expect(result.integrityRepaired).toBe(true);
    expect(result.integrityFailed || result.halted).toBe(false);
    expect(actionsTaken).toContain(
      "Rung 0: repaired mind capsule state projection via doctor:repair",
    );
  });

  it("handles projection recovery failure gracefully when recoverProjection throws", async () => {
    const { repoRoot, mindRunRoot } = setupHealthy("recovery-throws");
    const loadedMind = loadRun(mindRunRoot, false);
    let verifyCount = 0;
    const spyVerify = spyOn(store, "verifyIntegrity").mockImplementation(() => {
      verifyCount++;
      return verifyCount <= 2 ? [{ code: "STATE_PROJECTION", message: "mismatch" }] : [];
    });
    const spyRecover = spyOn(store, "recoverProjection").mockImplementation(() => {
      throw new Error("projection recovery crashed");
    });

    try {
      const opts = {
        runtimeFreshnessOverride: { drifted: false, referenceRuntimeVersion: "1.0.0" },
      };
      const { result } = await invokeRung0(mindRunRoot, loadedMind, repoRoot, opts);
      expect(result.integrityRepaired).toBe(false);
    } finally {
      spyVerify.mockRestore();
      spyRecover.mockRestore();
    }
  });

  it("retries verification when encountering transient READ_RACE integrity subcodes", async () => {
    const { repoRoot, mindRunRoot } = setupHealthy("read-race-retry");
    const orig = store.verifyIntegrity;
    let calls = 0;
    const spy = spyOn(store, "verifyIntegrity").mockImplementation((root, opts) => {
      calls++;
      return calls === 1
        ? [{ code: "STATE_JSON", subcode: "READ_RACE", message: "read race" }]
        : orig(root, opts);
    });

    try {
      const opts = {
        runtimeFreshnessOverride: { drifted: false, referenceRuntimeVersion: "1.0.0" },
      };
      const { result } = await invokeRung0(
        mindRunRoot,
        loadRun(mindRunRoot, false),
        repoRoot,
        opts,
      );
      expect(result.readRaceRetried).toBe(true);
      expect(result.halted).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it("halts with 'mind capsule integrity unrepairable' and transacts halt mutation", async () => {
    const { repoRoot, mindRunRoot } = setupHealthy("fatal-integrity");
    const loadedMind = loadRun(mindRunRoot, false);
    const spyVerify = spyOn(store, "verifyIntegrity").mockReturnValue([
      { code: "MANIFEST_JSON", message: "Corrupted manifest" },
    ]);
    const spyTransact = spyOn(store, "transact").mockImplementation(
      (_root, _actor, _kind, _payload, mutate) => {
        const working: Record<string, unknown> = { mind: {}, escalations: [] };
        if (typeof mutate === "function") mutate(working as never);
        return working as never;
      },
    );

    try {
      const opts = {
        runtimeFreshnessOverride: { drifted: false, referenceRuntimeVersion: "1.0.0" },
      };
      const { result, actionsTaken, escalations } = await invokeRung0(
        mindRunRoot,
        loadedMind,
        repoRoot,
        opts,
      );
      expect(result.integrityFailed && result.halted).toBe(true);
      expect(result.haltReason).toContain("mind capsule integrity unrepairable: MANIFEST_JSON");
      expect(
        actionsTaken.some((a) =>
          a.includes("HALT triggered due to mind capsule integrity unrepairable"),
        ),
      ).toBe(true);
      expect(escalations.some((e) => e.includes("MANIFEST_JSON"))).toBe(true);
      expect(spyTransact).toHaveBeenCalled();
    } finally {
      spyVerify.mockRestore();
      spyTransact.mockRestore();
    }
  });
});
