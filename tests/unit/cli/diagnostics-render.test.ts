import { describe, expect, test } from "bun:test";
import { formatDoctorBrief } from "../../../orchestrating-long-tasks/scripts/src/cli/commands/diagnostics-ops.ts";

describe("doctor brief rendering", () => {
  test("renders observed booleans and the measured Bun version", () => {
    const brief = formatDoctorBrief("/tmp/run", {
      healthy: false,
      bun_version: "1.3.14",
      bun_supported: true,
      gitignored: true,
      issues: ["INTEGRITY: chain broken"],
    });
    expect(brief).toContain("### Capsule Doctor: `/tmp/run`");
    expect(brief).toContain("- **Healthy**: no");
    expect(brief).toContain("- **Bun**: 1.3.14 (supported)");
    expect(brief).toContain("- **Gitignored**: yes");
    expect(brief).toContain("- **Issues**:");
    expect(brief).toContain("  - INTEGRITY: chain broken");
  });

  test("renders a missing field as unknown rather than a healthy-looking default", () => {
    const brief = formatDoctorBrief("/tmp/run", {});
    expect(brief).toContain("- **Healthy**: unknown");
    expect(brief).toContain("- **Bun**: unknown (unknown)");
    expect(brief).toContain("- **Gitignored**: unknown");
    expect(brief).toContain("- **Issues**: none");
    expect(brief).not.toContain("undefined");
    expect(brief).not.toContain("Healthy**: no");
  });

  test("treats a null or non-boolean field as unknown, not as false", () => {
    const brief = formatDoctorBrief("/tmp/run", {
      healthy: null,
      bun_version: "   ",
      bun_supported: "yes",
      gitignored: null,
      issues: "not-a-list",
    });
    expect(brief).toContain("- **Healthy**: unknown");
    expect(brief).toContain("- **Bun**: unknown (unknown)");
    expect(brief).toContain("- **Gitignored**: unknown");
    expect(brief).toContain("- **Issues**: none");
  });

  test("keeps only the string issues the report actually carries", () => {
    const brief = formatDoctorBrief("/tmp/run", { issues: ["real", 7, null, "also real"] });
    expect(brief).toContain("  - real");
    expect(brief).toContain("  - also real");
    expect(brief).not.toContain("  - 7");
    expect(brief).not.toContain("null");
  });
});
