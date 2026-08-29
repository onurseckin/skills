import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mindInitCommand } from "../../../olt/scripts/src/cli/commands/mind-init.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { loadRun } from "../../../olt/scripts/src/engine/store/index.ts";
import { rotateMindGeneration } from "../../../olt/scripts/src/mind/rotate.ts";
import { scratchRoot as makeScratchRoot } from "../../support/scratch-root.ts";

const PINNED_CHARTER = `
name: "mind"
role: "mind"
tier: 0
charter:
  identity: "Autonomous Mind supervising long-running task orchestration."
  goals:
    - id: "G1"
      statement: "Maintain 100% test coverage across all packages"
    - id: "G2"
      statement: "Enforce zero type regressions and zero prohibited any forms"
  non_goals:
    - "Deploying releases without explicit owner confirmation"
  repo_roots:
    - "olt/"
    - "tests/"
`;

const EDITED_CHARTER = `
name: "mind"
role: "mind"
tier: 0
charter:
  identity: "Autonomous Mind supervising long-running task orchestration."
  goals:
    - id: "G1"
      statement: "Maintain 100% test coverage across all packages"
    - id: "G2"
      statement: "Enforce zero type regressions and zero prohibited any forms"
    - id: "G4"
      statement: "Owner-directed goal added after the generation was pinned"
  non_goals:
    - "Deploying releases without explicit owner confirmation"
  repo_roots:
    - "olt/"
    - "tests/"
    - "docs/"
`;

function sha256Of(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function setupPinnedCapsule(label: string): {
  repoRoot: string;
  runRoot: string;
  charterPath: string;
  pinnedDigest: string;
} {
  const repoRoot = makeScratchRoot(import.meta.path, label);
  const charterPath = join(repoRoot, "mind.yaml");
  writeFileSync(charterPath, PINNED_CHARTER, "utf-8");

  const initResult = mindInitCommand({
    repo: repoRoot,
    charter: "mind.yaml",
    actor: "owner-alice",
  });

  const runRoot = initResult.run_root as string;
  return { repoRoot, runRoot, charterPath, pinnedDigest: loadRun(runRoot).manifest.prompt_sha256 };
}

describe("rotateMindGeneration re-sources the charter at the generational boundary", () => {
  test("carries the live charter bytes, digest, goals and repo roots after a sanctioned edit", () => {
    const { runRoot, charterPath, pinnedDigest } = setupPinnedCapsule("resources-live-charter");

    writeFileSync(charterPath, EDITED_CHARTER, "utf-8");
    const liveBytes = readFileSync(charterPath);
    const liveDigest = sha256Of(liveBytes);

    expect(liveDigest).not.toBe(pinnedDigest);

    const result = rotateMindGeneration({
      sourceRunRoot: runRoot,
      actor: "owner-alice",
      now: "2026-08-25T12:00:00.000Z",
    });

    const targetLoaded = loadRun(result.targetRunRoot);
    const targetMind = targetLoaded.state.mind as Record<string, unknown>;
    const targetCharter = targetMind.charter as Record<string, unknown>;

    expect(targetLoaded.manifest.prompt_sha256).toBe(liveDigest);
    expect(targetCharter.pinned_sha256).toBe(liveDigest);
    expect(result.charterSha256).toBe(liveDigest);

    expect(targetLoaded.manifest.prompt_sha256).toBe(targetCharter.pinned_sha256 as string);
    expect(targetLoaded.manifest.prompt_sha256).toBe(result.charterSha256);

    expect(targetLoaded.manifest.prompt_sha256).not.toBe(pinnedDigest);
    expect(targetCharter.pinned_sha256).not.toBe(pinnedDigest);
    expect(result.charterSha256).not.toBe(pinnedDigest);
  });

  test("writes successor prompt.md bytes that are the population the recorded digest was computed from", () => {
    const { runRoot, charterPath } = setupPinnedCapsule("bytes-match-digest");

    writeFileSync(charterPath, EDITED_CHARTER, "utf-8");
    const liveBytes = readFileSync(charterPath);

    const result = rotateMindGeneration({
      sourceRunRoot: runRoot,
      actor: "owner-alice",
      now: "2026-08-25T12:00:00.000Z",
    });

    const targetPromptBytes = readFileSync(join(result.targetRunRoot, "prompt.md"));
    const targetLoaded = loadRun(result.targetRunRoot);

    expect(targetPromptBytes.equals(liveBytes)).toBe(true);
    expect(targetPromptBytes.byteLength).toBe(liveBytes.byteLength);
    expect(targetLoaded.manifest.prompt_bytes).toBe(liveBytes.byteLength);
    expect(sha256Of(targetPromptBytes)).toBe(targetLoaded.manifest.prompt_sha256);
  });

  test("satisfies the pulse-open drift predicate that the stale carry violated", () => {
    const { repoRoot, runRoot, charterPath, pinnedDigest } = setupPinnedCapsule("drift-predicate");

    writeFileSync(charterPath, EDITED_CHARTER, "utf-8");

    const result = rotateMindGeneration({
      sourceRunRoot: runRoot,
      actor: "owner-alice",
      now: "2026-08-25T12:00:00.000Z",
    });

    const targetLoaded = loadRun(result.targetRunRoot);
    const targetMind = targetLoaded.state.mind as Record<string, unknown>;
    const targetCharter = targetMind.charter as Record<string, unknown>;

    const charterFullPath = join(repoRoot, targetCharter.source_path as string);
    expect(charterFullPath).toBe(charterPath);
    const observedDigest = sha256Of(readFileSync(charterFullPath));
    const gatingDigest =
      typeof targetCharter.pinned_sha256 === "string"
        ? targetCharter.pinned_sha256
        : targetLoaded.manifest.prompt_sha256;

    expect(observedDigest).toBe(gatingDigest);

    const sourceLoaded = loadRun(runRoot);
    const sourceMind = sourceLoaded.state.mind as Record<string, unknown>;
    const sourceCharter = sourceMind.charter as Record<string, unknown>;
    expect(sourceCharter.pinned_sha256).toBe(pinnedDigest);
    expect(observedDigest).not.toBe(sourceCharter.pinned_sha256);
  });

  test("records goals as string ids and repo roots from the live charter, not the stale record", () => {
    const { runRoot, charterPath } = setupPinnedCapsule("goal-ids-shape");

    writeFileSync(charterPath, EDITED_CHARTER, "utf-8");

    const result = rotateMindGeneration({
      sourceRunRoot: runRoot,
      actor: "owner-alice",
      now: "2026-08-25T12:00:00.000Z",
    });

    const targetLoaded = loadRun(result.targetRunRoot);
    const targetMind = targetLoaded.state.mind as Record<string, unknown>;
    const targetCharter = targetMind.charter as Record<string, unknown>;

    expect(targetCharter.goals).toEqual(["G1", "G2", "G4"]);
    expect(targetCharter.repo_roots).toEqual(["olt/", "tests/", "docs/"]);
    expect(targetCharter.source_path).toBe("mind.yaml");
    expect(targetCharter.evidence_class).toBe("harness_observed");

    for (const goal of targetCharter.goals as readonly unknown[]) {
      expect(typeof goal).toBe("string");
    }
    for (const root of targetCharter.repo_roots as readonly unknown[]) {
      expect(typeof root).toBe("string");
    }
  });

  test("carries the declined candidate ledger and agent grants across the boundary unchanged", () => {
    const { runRoot, charterPath } = setupPinnedCapsule("ledger-carry-forward");

    writeFileSync(charterPath, EDITED_CHARTER, "utf-8");

    const result = rotateMindGeneration({
      sourceRunRoot: runRoot,
      actor: "owner-alice",
      now: "2026-08-25T12:00:00.000Z",
    });

    const sourceLoaded = loadRun(runRoot);
    const sourceCandidates = sourceLoaded.state.candidates as readonly unknown[];
    const sourceAgents = sourceLoaded.state.agents as readonly unknown[];

    const targetLoaded = loadRun(result.targetRunRoot);
    const targetCandidates = targetLoaded.state.candidates as readonly unknown[];
    const targetAgents = targetLoaded.state.agents as readonly unknown[];

    expect(targetCandidates.length).toBe(sourceCandidates.length);
    expect(result.carriedCandidates.length).toBe(sourceCandidates.length);
    expect(targetAgents.length).toBe(sourceAgents.length);
    expect(result.carriedGrantsCount).toBe(sourceAgents.length);
    expect(result.previousEventHead).toBe(sourceLoaded.state.event_head as string);
  });

  test("fails closed with INTEGRITY when the live charter is missing, and leaves the source unsealed", () => {
    const { runRoot, charterPath } = setupPinnedCapsule("fail-closed-missing");

    rmSync(charterPath, { force: true });

    expect(() =>
      rotateMindGeneration({
        sourceRunRoot: runRoot,
        actor: "owner-alice",
        now: "2026-08-25T12:00:00.000Z",
      }),
    ).toThrow(HarnessError);

    let observedCode = "";
    try {
      rotateMindGeneration({
        sourceRunRoot: runRoot,
        actor: "owner-alice",
        now: "2026-08-25T12:00:00.000Z",
      });
    } catch (err: unknown) {
      observedCode = err instanceof HarnessError ? err.code : "not-a-harness-error";
    }
    expect(observedCode).toBe("INTEGRITY");

    const sourceLoaded = loadRun(runRoot);
    const sourceMind = sourceLoaded.state.mind as Record<string, unknown>;
    expect(sourceMind.status).not.toBe("rotated");
    expect(existsSync(join(runRoot, "..", "mind-gen-2"))).toBe(false);
  });

  test("fails closed with INTEGRITY when the live charter is empty rather than reusing stale bytes", () => {
    const { runRoot, charterPath, pinnedDigest } = setupPinnedCapsule("fail-closed-empty");

    writeFileSync(charterPath, "", "utf-8");

    let observedCode = "";
    let observedMessage = "";
    try {
      rotateMindGeneration({
        sourceRunRoot: runRoot,
        actor: "owner-alice",
        now: "2026-08-25T12:00:00.000Z",
      });
    } catch (err: unknown) {
      observedCode = err instanceof HarnessError ? err.code : "not-a-harness-error";
      observedMessage = err instanceof Error ? err.message : String(err);
    }

    expect(observedCode).toBe("INTEGRITY");
    expect(observedMessage).toContain("empty");
    expect(observedMessage).not.toContain(pinnedDigest);
    expect(existsSync(join(runRoot, "..", "mind-gen-2"))).toBe(false);
  });

  test("fails closed with INTEGRITY when the live charter is unparseable", () => {
    const { runRoot, charterPath } = setupPinnedCapsule("fail-closed-unparseable");

    writeFileSync(charterPath, "identity: [unclosed\n  - :: bad yaml ::\n", "utf-8");

    let observedCode = "";
    try {
      rotateMindGeneration({
        sourceRunRoot: runRoot,
        actor: "owner-alice",
        now: "2026-08-25T12:00:00.000Z",
      });
    } catch (err: unknown) {
      observedCode = err instanceof HarnessError ? err.code : "not-a-harness-error";
    }

    expect(observedCode).toBe("INTEGRITY");
    expect(existsSync(join(runRoot, "..", "mind-gen-2"))).toBe(false);
  });
});
