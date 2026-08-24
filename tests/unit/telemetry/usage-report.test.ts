import { describe, expect, it } from "bun:test";
import { usageReportCommand } from "../../../olt/scripts/src/cli/commands/usage-report.ts";
import { COMMAND_REGISTRY } from "../../../olt/scripts/src/cli/registry/index.ts";

describe("usage:report CLI command", () => {
  it("registers usage:report in COMMAND_REGISTRY", () => {
    const spec = COMMAND_REGISTRY.find((c) => c.name === "usage:report");
    expect(spec).toBeDefined();
    expect(spec?.domain).toBe("reporting");
    expect(spec?.aliases).toContain("telemetry:usage");
    expect(spec?.aliases).toContain("quota:report");
  });

  const mockEnv = {
    exec: async () => null,
    readFile: async () => null,
    env: { GEMINI_API_KEY: "test-key" },
  };

  it("executes usageReportCommand without throwing", async () => {
    const result = await usageReportCommand({}, undefined, undefined, mockEnv);
    expect(result.markdown).toBeDefined();
    expect(typeof result.markdown).toBe("string");
    expect(result.report).toBeDefined();
    expect(result.summary).toBeDefined();
    expect(result.timestamp).toBeDefined();
  });

  it("filters platform when --platform flag is provided", async () => {
    const result = await usageReportCommand(
      { platform: "antigravity" },
      undefined,
      undefined,
      mockEnv,
    );
    const report = result.report as { results: { platformId: string }[] };
    expect(report.results.length).toBe(1);
    expect(report.results[0]!.platformId).toBe("antigravity");
  });

  it("includes detailed observations when --detailed flag is set", async () => {
    const result = await usageReportCommand(
      { detailed: true, platform: "antigravity" },
      undefined,
      undefined,
      mockEnv,
    );
    const markdown = result.markdown as string;
    expect(markdown).toContain("Detailed Raw Observations");
  });
});
