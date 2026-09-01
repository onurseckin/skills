import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  assertCoordinatorPreToolGuard,
  isCoordinatorFileEditForbidden,
  isCoordinatorRole,
} from "../../../olt/scripts/src/authority/guards/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { cleanupVirtualAuthorityFS, setupVirtualAuthorityFS } from "../fixture.ts";

describe("Coordinator Tool Guard & Pre-Tool Enforcement", () => {
  beforeEach(() => {
    setupVirtualAuthorityFS();
  });

  afterEach(() => {
    cleanupVirtualAuthorityFS();
  });
  test("identifies coordinator roles correctly", () => {
    expect(isCoordinatorRole("coordinator")).toBe(true);
    expect(isCoordinatorRole("coordinator-1")).toBe(true);
    expect(isCoordinatorRole("domain-coordinator")).toBe(true);
    expect(isCoordinatorRole("coordinator_alpha")).toBe(true);
    expect(isCoordinatorRole("implementer")).toBe(false);
    expect(isCoordinatorRole("validator")).toBe(false);
    expect(isCoordinatorRole("worker")).toBe(false);
  });

  test("identifies file modification tools and categories as forbidden for coordinator", () => {
    const forbiddenTools = [
      "write_to_file",
      "replace_file_content",
      "edit_file",
      "notebook_edit",
      "generate_image",
      "touch",
      "rm",
      "mv",
      "cp",
      "mkdir",
      "write",
      "edit",
      "mutation",
      "file-write",
      "code-edit",
    ];

    for (const tool of forbiddenTools) {
      expect(isCoordinatorFileEditForbidden(tool)).toBe(true);
    }

    const allowedTools = [
      "view_file",
      "list_dir",
      "find_by_name",
      "grep_search",
      "read_resource",
      "run_command",
      "schedule",
      "manage_task",
      "send_message",
      "invoke_subagent",
    ];

    for (const tool of allowedTools) {
      expect(isCoordinatorFileEditForbidden(tool)).toBe(false);
    }
  });

  test("assertCoordinatorPreToolGuard throws ROLE_BOUNDARY_DEVIATION on forbidden tools", () => {
    expect(() => {
      assertCoordinatorPreToolGuard("coordinator", "write_to_file", "coord-1");
    }).toThrow(HarnessError);

    try {
      assertCoordinatorPreToolGuard("coordinator", "replace_file_content", "coord-1");
      expect.unreachable("should have thrown HarnessError");
    } catch (error) {
      expect(error).toBeInstanceOf(HarnessError);
      expect((error as HarnessError).code).toBe("ROLE_BOUNDARY_DEVIATION");
      expect((error as HarnessError).message).toContain("ROLE_BOUNDARY_DEVIATION");
      expect((error as HarnessError).message).toContain("invoke_subagent");
    }
  });

  test("assertCoordinatorPreToolGuard permits read and orchestration tools for coordinator", () => {
    expect(() => {
      assertCoordinatorPreToolGuard("coordinator", "view_file", "coord-1");
    }).not.toThrow();

    expect(() => {
      assertCoordinatorPreToolGuard("coordinator", "invoke_subagent", "coord-1");
    }).not.toThrow();

    expect(() => {
      assertCoordinatorPreToolGuard("coordinator", "run_command", "coord-1");
    }).not.toThrow();
  });

  test("assertCoordinatorPreToolGuard permits write tools for implementer and worker roles", () => {
    expect(() => {
      assertCoordinatorPreToolGuard("implementer", "write_to_file", "imp-1");
    }).not.toThrow();

    expect(() => {
      assertCoordinatorPreToolGuard("worker", "replace_file_content", "worker-1");
    }).not.toThrow();
  });
});
