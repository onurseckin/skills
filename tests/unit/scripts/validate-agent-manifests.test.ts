import { describe, expect, test, spyOn } from "bun:test";
import * as fs from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

describe("validate-agent-manifests script", () => {
  test("runs as standalone script and validates all agent manifests successfully", () => {
    const scriptPath = join(process.cwd(), "scripts/validate-agent-manifests.ts");
    const result = spawnSync("bun", [scriptPath], {
      encoding: "utf-8",
      cwd: process.cwd(),
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Agent Manifest Validation Results:");
    expect(result.stdout).toContain("PASS");
  });

  test("runs manifest validation workflow in process", async () => {
    let exitCode: number | undefined;
    const exitSpy = spyOn(process, "exit").mockImplementation((code) => {
      exitCode = typeof code === "number" ? code : 0;
      throw new Error(`process.exit called with ${code as string | number}`);
    });
    const logSpy = spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = spyOn(console, "error").mockImplementation(() => {});

    try {
      await import("../../../scripts/validate-agent-manifests.ts");
    } catch (err) {
      if (!(err instanceof Error && err.message.startsWith("process.exit"))) {
        throw err;
      }
    } finally {
      exitSpy.mockRestore();
      logSpy.mockRestore();
      errorSpy.mockRestore();
    }

    expect(exitCode).toBe(0);
  });
});
