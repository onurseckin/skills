import { describe, expect, it } from "bun:test";
import { assertRoleArtifactPresent } from "./review/role-evidence.ts";
import { HarnessError } from "../errors/harness-error.ts";

describe("Role Evidence Artifact Enforcement", () => {
  it("allows non-UI domains without artifact evidence", () => {
    expect(() => {
      assertRoleArtifactPresent("task-01", false, { hasArtifact: false });
    }).not.toThrow();
  });

  it("throws HarnessError when UI task has no artifact evidence", () => {
    expect(() => {
      assertRoleArtifactPresent("task-ui-01", true, { hasArtifact: false });
    }).toThrow(HarnessError);
  });

  it("rejects UI task if screenshots are below 1024 bytes (e.g. 67-byte minimal dummy stub)", () => {
    expect(() => {
      assertRoleArtifactPresent("task-ui-02", true, {
        hasArtifact: true,
        screenshots: [{ sizeBytes: 67, name: "stub.png" }],
      });
    }).toThrow(HarnessError);
  });

  it("accepts UI task when valid screenshots >= 1024 bytes exist", () => {
    expect(() => {
      assertRoleArtifactPresent("task-ui-03", true, {
        hasArtifact: true,
        screenshots: [{ sizeBytes: 2048, name: "valid.png" }],
      });
    }).not.toThrow();
  });

  it("accepts UI task when companion manifests exist", () => {
    expect(() => {
      assertRoleArtifactPresent("task-ui-04", true, {
        hasArtifact: true,
        manifests: [{ screenId: "dashboard", viewport: "desktop" }],
      });
    }).not.toThrow();
  });
});
