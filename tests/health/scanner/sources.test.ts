import { describe, expect, test } from "bun:test";
import { listFiles, loadSources } from "../../../olt/scripts/src/health/sources.ts";

describe("Health Scanner - Source File Discovery & Loading", () => {
  test("listFiles returns empty array for non-existent directory", () => {
    expect(listFiles("/virtual/non-existent-directory-xyz", [".ts"])).toEqual([]);
  });

  test("loadSources scans files with valid extensions and extracts scanned source", () => {
    const cwd = process.cwd();
    const sources = loadSources(cwd + "/olt/scripts/src/health/hygiene", [".ts"]);
    expect(sources.length).toBeGreaterThan(0);
    for (const s of sources) {
      expect(s.path.endsWith(".ts")).toBe(true);
      expect(typeof s.relative).toBe("string");
      expect(typeof s.text).toBe("string");
      expect(s.scan).toBeDefined();
      expect(s.scan.code).toBeDefined();
      expect(s.scan.identifiers).toBeDefined();
    }
  });
});
