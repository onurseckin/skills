import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { whoamiCommand } from "../../../../olt/scripts/src/cli/commands/whoami.ts";
import { dagViewCommand } from "../../../../olt/scripts/src/cli/commands/dag-view.ts";
import {
  findingGetCommand,
  reportGetCommand,
  evidenceGetCommand,
  evidenceScreenshotsCommand,
} from "../../../../olt/scripts/src/cli/commands/inspection-ops.ts";
import { findCommand } from "../../../../olt/scripts/src/cli/registry/index.ts";
import { assertRoleMayInvoke } from "../../../../olt/scripts/src/packets/command-authority.ts";
import { loadRoleContract } from "../../../../olt/scripts/src/packets/role-contract.ts";
import { initRun, transact } from "../../../../olt/scripts/src/engine/store/index.ts";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
  roots.length = 0;
});

async function fixtureCapsuleRun() {
  const root = await mkdtemp(join(tmpdir(), "cli-query-test-"));
  roots.push(root);
  const repo = join(root, "repo");
  await mkdir(repo);
  const run = initRun(
    repo,
    "query-run",
    new TextEncoder().encode("Implement multi-viewport responsive UI"),
    "file",
    true,
  );
  return { root, repo, run };
}

describe("CLI Query Integration - Role Grants & Authority", () => {
  describe("Role Contract Query Command Grants & Authority", () => {
    test("implementer contract grants on-demand CLI query commands", () => {
      const contract = loadRoleContract("implementer");
      expect(contract.commands).toContain("finding:get");
      expect(contract.commands).toContain("report:get");
      expect(contract.commands).toContain("evidence:get");
      expect(contract.commands).toContain("whoami");

      for (const cmd of ["finding:get", "report:get", "evidence:get", "whoami"]) {
        const spec = findCommand(cmd)!;
        expect(spec).toBeDefined();
        expect(() => assertRoleMayInvoke("implementer", spec, "impl-1")).not.toThrow();
      }
    });

    test("validator contract enforces 0 command privileges (cognitive validator hard-lock)", () => {
      const contract = loadRoleContract("validator");
      expect(contract.commands).not.toContain("run:exec");
    });

    test("coordinator contract grants dag and all CLI query commands", () => {
      const contract = loadRoleContract("coordinator");
      expect(contract.commands).toContain("dag");
      expect(contract.commands).toContain("finding:get");
      expect(contract.commands).toContain("report:get");
      expect(contract.commands).toContain("evidence:get");
      expect(contract.commands).toContain("evidence:screenshots");

      for (const cmd of [
        "dag",
        "finding:get",
        "report:get",
        "evidence:get",
        "evidence:screenshots",
      ]) {
        const spec = findCommand(cmd)!;
        expect(spec).toBeDefined();
        expect(() => assertRoleMayInvoke("coordinator", spec, "coord-1")).not.toThrow();
      }
    });

    test("completeness-critic contract grants CLI query commands", () => {
      const contract = loadRoleContract("completeness-critic");
      expect(contract.commands).toContain("finding:get");
      expect(contract.commands).toContain("report:get");
      expect(contract.commands).toContain("evidence:get");
      expect(contract.commands).toContain("evidence:screenshots");
      expect(contract.commands).toContain("whoami");

      for (const cmd of [
        "finding:get",
        "report:get",
        "evidence:get",
        "evidence:screenshots",
        "whoami",
      ]) {
        const spec = findCommand(cmd)!;
        expect(spec).toBeDefined();
        expect(() => assertRoleMayInvoke("completeness-critic", spec, "critic-1")).not.toThrow();
      }
    });
  });
});
