import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CLOSING_FORBIDDEN_FOR_MIND,
  formatMindPulseActiveBrief,
  formatMindPulseOpenedBrief,
  mindPulseCommand,
} from "../../../olt/scripts/src/cli/commands/index.ts";
import { execute } from "../../../olt/scripts/src/cli/index.ts";
import { findCommand } from "../../../olt/scripts/src/cli/registry/index.ts";
import type { JsonObject } from "../../../olt/scripts/src/core/contracts/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { readLastPulse } from "../../../olt/scripts/src/mind/lifecycle/index.ts";
import {
  enforceInfiniteMindCadence,
  transitionPulseToWake,
} from "../../../olt/scripts/src/mind/archival/recycler/index.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/index.ts";
import { loadRun } from "../../../olt/scripts/src/engine/store/index.ts";
import { transact } from "../../../olt/scripts/src/engine/store/index.ts";

const testRoots: string[] = [];

afterEach(() => {
  for (const root of testRoots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // Ignore test cleanup errors
    }
  }
  testRoots.length = 0;
});

interface MindTestFixture {
  readonly repo: string;
  readonly run: string;
  readonly charterPath: string;
  readonly charterSha: string;
}

function setupMindFixture(
  name: string,
  overrides: {
    readonly charterContent?: string;
    readonly budget?: Record<string, unknown>;
  } = {},
): MindTestFixture {
  const repo = mkdtempSync(join(tmpdir(), `mind-pulse-perpetual-${name}-`));
  testRoots.push(repo);

  const charterDir = join(repo, "olt", "agents");
  mkdirSync(charterDir, { recursive: true });
  mkdirSync(join(repo, ".olt"), { recursive: true });
  const charterPath = join(charterDir, "mind.yaml");
  const charterContent =
    overrides.charterContent ??
    `name: "mind"\nrole: "mind"\ncharter:\n  identity: "Test Perpetual Mind"\n  goals:\n    - id: "G1"\n      statement: "Infinite Stability"\n  non_goals:\n    - "Self-termination"\n  repo_roots:\n    - "src/"\n`;
  writeFileSync(charterPath, charterContent, "utf-8");

  const charterBytes = readFileSync(charterPath);
  const charterSha = createHash("sha256").update(charterBytes).digest("hex");

  const run = initRun(repo, `mind-gen-${name}`, charterBytes, "file", true);

  transact(
    run,
    "mind-init",
    "mind-initialized",
    {
      generation: 1,
      charter_source_path: "olt/agents/mind.yaml",
      pinned_sha256: charterSha,
    },
    (working) => {
      working.mind = {
        generation: 1,
        opened_at: new Date().toISOString(),
        charter: {
          source_path: "olt/agents/mind.yaml",
          pinned_sha256: charterSha,
          goals: ["G1"],
          repo_roots: ["src/"],
          evidence_class: "harness_observed",
        },
        actor: "mind-1",
      };
      if (overrides.budget) {
        working.budget = overrides.budget as unknown as JsonObject;
      }
    },
  );

  return { repo, run, charterPath, charterSha };
}

describe("P43 Unified Perpetual mind:pulse Command", () => {
  describe("Non-Stopping Invariant & Recycler Transitions", () => {
    test("enforceInfiniteMindCadence guarantees infinite autonomous cadence", () => {
      const assessment = enforceInfiniteMindCadence({
        runRoot: ".olt/capsules/mind-gen-1",
        actor: "mind-1",
      });

      expect(assessment.cadence).toBe("infinite_autonomous");
      expect(assessment.allowed).toBe(true);
      expect(assessment.nextInstruction).toContain("mind:wake");
    });

    test("transitionPulseToWake provides seamless transition without process termination", () => {
      const transition = transitionPulseToWake(".olt/capsules/mind-gen-1", "pulse-5", "active");

      expect(transition.canRecycle).toBe(true);
      expect(transition.infiniteCadence).toBe(true);
      expect(transition.transition).toBe("pulse_to_wake");
      expect(transition.nextRecommendedCommand).toContain("mind:wake");
    });
  });

  describe("Refusals and Safety Gates", () => {
    test("refuses pulse when mind is halted", async () => {
      const fixture = setupMindFixture("halted-guard");

      transact(
        fixture.run,
        "safety",
        "mind-halted",
        { reason: "owner intervention" },
        (working) => {
          working.mind = {
            halted: true,
            halt_reason: "owner intervention",
          } as unknown as JsonObject;
        },
      );

      await expect(
        mindPulseCommand({
          run: fixture.run,
          actor: "mind-1",
        }),
      ).rejects.toThrow(/mind is halted/);
    });

    test("refuses pulse when charter sha mismatch occurs", async () => {
      const fixture = setupMindFixture("drift-guard");

      writeFileSync(fixture.charterPath, "# DRIFTED CONTENT\n", "utf-8");

      await expect(
        mindPulseCommand({
          run: fixture.run,
          actor: "mind-1",
        }),
      ).rejects.toThrow(/charter sha256 mismatch/);
    });

    test("refuses pulse when past deadline until reclaimed", async () => {
      const fixture = setupMindFixture("deadline-expired");
      const openTime = "2026-08-22T10:00:00.000Z";
      const farFutureTime = "2026-08-22T12:00:00.000Z"; // 2 hours later, past 20m deadline

      await mindPulseCommand({
        run: fixture.run,
        actor: "mind-1",
        now: openTime,
      });

      await expect(
        mindPulseCommand({
          run: fixture.run,
          actor: "mind-1",
          now: farFutureTime,
        }),
      ).rejects.toThrow(/reclaim it first with mind:wake/);
    });
  });

  describe("Mechanical Rejection of Permanently Deleted mind:pulse-close", () => {
    test("findCommand returns undefined for mind:pulse-close", () => {
      const spec = findCommand("mind:pulse-close");
      expect(spec).toBeUndefined();
    });

    test("findCommand successfully returns spec for unified mind:pulse", () => {
      const spec = findCommand("mind:pulse");
      expect(spec).toBeDefined();
      expect(spec?.name).toBe("mind:pulse");
      expect(spec?.domain).toBe("mind");
    });

    test("CLI execute mechanically rejects mind:pulse-close with UNKNOWN_COMMAND", async () => {
      const fixture = setupMindFixture("cli-rejection");

      await expect(
        execute([
          "mind:pulse-close",
          "--run",
          fixture.run,
          "--actor",
          "mind-1",
          "--pulse",
          "pulse-1",
          "--outcome",
          "quiescent",
        ]),
      ).rejects.toThrow(/unknown command: mind:pulse-close/);
    });

    test("CLI execute successfully dispatches unified mind:pulse", async () => {
      const fixture = setupMindFixture("cli-dispatch");
      const reg = await execute([
        "agent:register",
        "--run",
        fixture.run,
        "--agent",
        "mind-1",
        "--role",
        "mind",
        "--host",
        "antigravity",
      ]);

      delete process.env.AGENT_ID;
      delete process.env.HARNESS_AGENT_ID;
      if (reg.token && typeof reg.token === "string") {
        process.env.HARNESS_TOKEN = reg.token;
      }
      const res = await execute(["mind:pulse", "--run", fixture.run, "--actor", "mind-1"]);
      expect(res.status).toBe("opened");
      expect(res.pulse_id).toBe("pulse-1");
      expect(res.invariant).toBe(CLOSING_FORBIDDEN_FOR_MIND);
    });
  });
});
