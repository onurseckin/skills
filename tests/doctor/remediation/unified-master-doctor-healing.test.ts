import { afterEach, describe, expect, spyOn, test } from "bun:test";
import * as cp from "node:child_process";
import { join } from "node:path";
import {
  runDoctor,
  formatDoctorReport,
  autoHealCapsule,
} from "../../../olt/scripts/src/reporting/doctor.ts";
import { formatDoctorBrief } from "../../../olt/scripts/src/cli/commands/diagnostics-ops.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/capsule/capsule.ts";
import { transact } from "../../../olt/scripts/src/engine/store/events/transaction.ts";
import * as agentCanonical from "../../../olt/scripts/src/reporting/doctor/agent-canonical-engine.ts";
import * as socratic2 from "../../../olt/scripts/src/reporting/socratic-validator/evaluators-2.ts";
import {
  VirtualMemoryFS,
  createVirtualFSSession,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

export const unifiedMasterDoctorHealingSuiteName =
  "Unified Master Doctor - Auto-Healing and Severity-Tiered Reporting";

let session: VirtualFSSession | null = null;
let vfs: VirtualMemoryFS;
const spies: Array<{ mockRestore: () => void }> = [];

function setupVirtualFs(): void {
  vfs = new VirtualMemoryFS();
  vfs.mkdirSync("/virtual/repo-autoheal/.git", { recursive: true });
  vfs.mkdirSync(process.cwd(), { recursive: true });
  vfs.mkdirSync(join(process.cwd(), ".git"), { recursive: true });
  vfs.writeFileSync(join(process.cwd(), "package.json"), "{}");
  session = createVirtualFSSession(vfs);

  spies.push(
    spyOn(cp, "spawnSync").mockImplementation(
      () =>
        ({
          status: 0,
          stdout: "",
          stderr: "",
          error: undefined,
        }) as unknown as cp.SpawnSyncReturns<string>,
    ),
    spyOn(agentCanonical, "checkAgentCanonicalAlignment").mockReturnValue({
      engine: "checkAgentCanonicalAlignment",
      findings: [],
    }),
    spyOn(socratic2, "evaluateTwoKeyValidatorPairing").mockReturnValue([]),
  );
}

afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore();
  session?.cleanup();
  session = null;
});

describe(unifiedMasterDoctorHealingSuiteName, () => {
  describe("Auto-Healing Engine", () => {
    test("autoHealCapsule recovers torn state projection and records auto_healed", async () => {
      setupVirtualFs();
      const repo = "/virtual/repo-autoheal";
      const runRoot = initRun(
        repo,
        "autoheal-run",
        new TextEncoder().encode("Prompt"),
        "file",
        true,
      );
      transact(runRoot, "coord-1", "plan-brainstormed", { plan_id: "p1" }, (state) => {
        state.data = { t1: { id: "t1", status: "open" } };
      });

      vfs.writeFileSync(
        join(runRoot, "state.json"),
        JSON.stringify({ schema: "harness.state", event_sequence: 999, corrupted: true }),
      );
      const healResult = autoHealCapsule(runRoot);
      expect(
        healResult.projectionRecovered &&
          healResult.autoHealed.length > 0 &&
          healResult.autoHealed[0].includes("Recovered state projection"),
      ).toBe(true);

      vfs.writeFileSync(
        join(runRoot, "state.json"),
        JSON.stringify({ schema: "harness.state", event_sequence: 999, corrupted: true }),
      );
      const doctorReport = await runDoctor(runRoot, { repoRoot: repo }, () => ({
        status: 0,
        bytes: new Uint8Array(),
      }));
      expect(
        doctorReport.healthy &&
          Array.isArray(doctorReport.auto_healed) &&
          (doctorReport.auto_healed as string[]).length > 0,
      ).toBe(true);
    });
  });

  describe("Severity-Tiered Reporting & Formatting", () => {
    test("formatDoctorReport and formatDoctorBrief render clear severity sections: [ERROR], [WARN], [INFO]", () => {
      const reportMarkdown = formatDoctorReport({
        runRoot: "/test/run",
        healthy: false,
        bunVersion: "1.3.14",
        bunSupported: true,
        gitignored: true,
        issues: ["critical issue 1", "LAYOUT_UNDECLARED: note"],
        errors: ["critical issue 1"],
        warnings: ["advisory warning 1"],
        infos: ["Auto-Healed: Recovered projection", "LAYOUT_UNDECLARED: note"],
      });
      expect(
        [
          "### Doctor Findings:",
          "- **[ERROR]**:",
          "  - critical issue 1",
          "- **[WARN]**:",
          "  - advisory warning 1",
          "- **[INFO]**:",
          "  - Auto-Healed: Recovered projection",
        ].every((s) => reportMarkdown.includes(s)),
      ).toBe(true);

      const briefMarkdown = formatDoctorBrief("/test/run", {
        healthy: false,
        bun_version: "1.3.14",
        bun_supported: true,
        gitignored: true,
        critical_issues: ["critical issue 1"],
        cosmetic_issues: ["cosmetic note 1"],
        warnings: ["advisory warning 1"],
        auto_healed: ["Recovered projection"],
      });
      expect(
        [
          "### Doctor Findings:",
          "- **[ERROR]**:",
          "- **[WARN]**:",
          "- **[INFO]**:",
          "Auto-Healed: Recovered projection",
        ].every((s) => briefMarkdown.includes(s)),
      ).toBe(true);
    });
  });
});
