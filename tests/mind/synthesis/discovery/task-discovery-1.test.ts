import { describe, expect, it } from "bun:test";
import {
  sanitizeSlug,
  DEFAULT_EXCLUDE_PATTERNS,
} from "../../../../olt/scripts/src/mind/tasks/discovery/index.ts";

describe("Task Discovery Sanitation & Patterns Suite (Part 1)", () => {
  it("sanitizes slugs correctly", () => {
    expect(sanitizeSlug("Feature A 123")).toBe("feature-a-123");
    expect(sanitizeSlug("Hello_World")).toBe("hello-world");
  });

  it("exports default exclude patterns", () => {
    expect(DEFAULT_EXCLUDE_PATTERNS).toContain("node_modules");
  });
});
