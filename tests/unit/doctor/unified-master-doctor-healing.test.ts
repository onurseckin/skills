import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  runDoctor,
  formatDoctorReport,
  autoHealCapsule,
} from "../../../olt/scripts/src/reporting/doctor.ts";
import { formatDoctorBrief } from "../../../olt/scripts/src/cli/commands/diagnostics-ops.ts";
import { initRun } from "../../../olt/scripts/src/engine/store/capsule.ts";
import { transact } from "../../../olt/scripts/src/engine/store/transaction.ts";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("Unified Master Doctor - Auto-Healing and Severity-Tiered Reporting", () => {
  describe("Auto-Healing Engine", () => {
    test("autoHealCapsule recovers torn state projection and records auto_healed", async () => {
      const repo = await mkdtemp(join(tmpdir(), "harness-autoheal-"));
      roots.push(repo);
      await mkdir(join(repo, ".git"));
      const runRoot = initRun(
        repo,
        "autoheal-run",
        new TextEncoder().encode("Prompt"),
        "file",
        true,
      );

      transact(runRoot, "coord-1", "plan-brainstormed", { plan_id: "p1" }, (state) => {
        state.tasks = { t1: { id: "t1", status: "open" } };
      });

      // Mutate state.json manually to simulate a torn state projection mismatch
      writeFileSync(
        join(runRoot, "state.json"),
        JSON.stringify({ schema: "harness.state", event_sequence: 999, corrupted: true }),
      );

      const healResult = autoHealCapsule(runRoot);
      expect(healResult.projectionRecovered).toBe(true);
      expect(healResult.autoHealed.length).toBeGreaterThan(0);
      expect(healResult.autoHealed[0]).toContain("Recovered state projection");

      // Corrupt state again to verify in-flight auto-healing in runDoctor
      writeFileSync(
        join(runRoot, "state.json"),
        JSON.stringify({ schema: "harness.state", event_sequence: 999, corrupted: true }),
      );

      // Verify doctor auto-heals in-flight and reports healthy
      const doctorReport = await runDoctor(runRoot, {}, () => ({
        status: 0,
        bytes: new Uint8Array(),
      }));
      expect(doctorReport.healthy).toBe(true);
      expect(Array.isArray(doctorReport.auto_healed)).toBe(true);
      expect((doctorReport.auto_healed as string[]).length).toBeGreaterThan(0);
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

      expect(reportMarkdown).toContain("### Doctor Findings:");
      expect(reportMarkdown).toContain("- **[ERROR]**:");
      expect(reportMarkdown).toContain("  - critical issue 1");
      expect(reportMarkdown).toContain("- **[WARN]**:");
      expect(reportMarkdown).toContain("  - advisory warning 1");
      expect(reportMarkdown).toContain("- **[INFO]**:");
      expect(reportMarkdown).toContain("  - Auto-Healed: Recovered projection");

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

      expect(briefMarkdown).toContain("### Doctor Findings:");
      expect(briefMarkdown).toContain("- **[ERROR]**:");
      expect(briefMarkdown).toContain("- **[WARN]**:");
      expect(briefMarkdown).toContain("- **[INFO]**:");
      expect(briefMarkdown).toContain("Auto-Healed: Recovered projection");
    });
  });
});
