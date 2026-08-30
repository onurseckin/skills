import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mindInitCommand } from "../../../olt/scripts/src/cli/commands/mind-init.ts";
import { whoamiCommand } from "../../../olt/scripts/src/cli/commands/whoami.ts";
import { mindWakeCommand } from "../../../olt/scripts/src/cli/commands/mind-wake.ts";
import {
  isSessionLedgerBacked,
  resolveActiveSession,
} from "../../../olt/scripts/src/authority/session/index.ts";
import { loadRepoPolicy } from "../../../olt/scripts/src/policy/repo-policy.ts";
import { scratchRoot as makeScratchRoot } from "../../support/scratch-root.ts";

function scratchRoot(label: string): string {
  return makeScratchRoot(import.meta.path, label);
}

const SAMPLE_CHARTER = `
name: "mind"
role: "mind"
tier: 0
charter:
  identity: "Autonomous Mind supervising codebase health."
  goals:
    - id: "G1"
      statement: "Enforce complete repository governance"
  non_goals:
    - "Unsupervised production changes"
  repo_roots:
    - "src/"
`;

describe("mind:init repo governance scaffolding", () => {
  test("bootstraps complete repository governance files on fresh repo", () => {
    const repo = scratchRoot("fresh-repo-governance");
    const charterPath = join(repo, "mind.yaml");
    writeFileSync(charterPath, SAMPLE_CHARTER, "utf8");

    const result = mindInitCommand({
      repo,
      charter: "mind.yaml",
      actor: "owner-alice",
    });

    expect(result.mind_id).toBe("mind-gen-1");
    expect(result.generation).toBe(1);

    const governance = result.governance as {
      olt_dir: string;
      policy_path: string;
      backlog_path: string;
      defects_path: string;
      session_path: string;
      ready: boolean;
    };

    expect(governance).toBeDefined();
    expect(governance.ready).toBe(true);

    const oltDir = join(repo, ".olt");
    const policyPath = join(oltDir, "policy.json");
    const backlogPath = join(oltDir, "backlog.jsonl");
    const defectsPath = join(oltDir, "defects.jsonl");
    const sessionPath = join(repo, ".session.json");

    expect(existsSync(oltDir)).toBe(true);
    expect(existsSync(policyPath)).toBe(true);
    expect(existsSync(backlogPath)).toBe(true);
    expect(existsSync(defectsPath)).toBe(true);
    expect(existsSync(sessionPath)).toBe(true);

    expect(governance.olt_dir).toBe(oltDir);
    expect(governance.policy_path).toBe(policyPath);
    expect(governance.backlog_path).toBe(backlogPath);
    expect(governance.defects_path).toBe(defectsPath);
    expect(governance.session_path).toBe(sessionPath);

    const policy = loadRepoPolicy(repo);
    expect(policy.schema_version).toBeDefined();
    expect(policy.review_protocol).toBeDefined();
    expect(policy.planning).toBeDefined();

    const backlogContent = readFileSync(backlogPath, "utf8");
    expect(backlogContent).toBe("");

    const defectsContent = readFileSync(defectsPath, "utf8");
    expect(defectsContent).toBe("");

    const sessionContent = JSON.parse(readFileSync(sessionPath, "utf8"));
    expect(sessionContent.agent_id).toBe("mind-gen-1");
    expect(sessionContent.role).toBe("mind");
    expect(sessionContent.tier).toBe(0);
    expect(sessionContent.token).toBeDefined();

    expect(result.markdown).toContain("Governance");
    expect(result.markdown).toContain("ready");
  });

  test("preserves pre-existing custom policy, backlog, and defects files", () => {
    const repo = scratchRoot("existing-governance-preservation");
    const oltDir = join(repo, ".olt");
    const charterPath = join(repo, "mind.yaml");
    writeFileSync(charterPath, SAMPLE_CHARTER, "utf8");

    const policyPath = join(oltDir, "policy.json");
    const backlogPath = join(oltDir, "backlog.jsonl");
    const defectsPath = join(oltDir, "defects.jsonl");

    const customPolicy = {
      schema_version: 1,
      ecosystem: "bun",
      package_manager: "bun",
      test_runner: {
        default_command: "bun test",
        targeted_pattern: "bun test <path>",
        full_suite_command: "bun test",
        timeout_ms: 45000,
      },
    };

    mkdirSync(oltDir, { recursive: true });
    writeFileSync(policyPath, JSON.stringify(customPolicy, null, 2), "utf8");
    writeFileSync(backlogPath, '{"task_id":"task-100"}\n', "utf8");
    writeFileSync(defectsPath, '{"defect_id":"defect-200"}\n', "utf8");

    const result = mindInitCommand({
      repo,
      charter: "mind.yaml",
      "mind-id": "mind-custom-42",
      generation: "3",
    });

    expect(result.mind_id).toBe("mind-custom-42");
    expect(result.generation).toBe(3);

    const reloadedPolicy = loadRepoPolicy(repo);
    expect(reloadedPolicy.test_runner?.timeout_ms).toBe(45000);

    const backlogContent = readFileSync(backlogPath, "utf8");
    expect(backlogContent).toBe('{"task_id":"task-100"}\n');

    const defectsContent = readFileSync(defectsPath, "utf8");
    expect(defectsContent).toBe('{"defect_id":"defect-200"}\n');

    const sessionPath = join(repo, ".session.json");
    expect(existsSync(sessionPath)).toBe(true);
    const session = JSON.parse(readFileSync(sessionPath, "utf8"));
    expect(session.agent_id).toBe("mind-custom-42");
    expect(session.role).toBe("mind");
  });

  test("provisions session authority usable by subsequent mind commands", async () => {
    const repo = scratchRoot("mind-session-authority");
    const charterPath = join(repo, "mind.yaml");
    writeFileSync(charterPath, SAMPLE_CHARTER, "utf8");

    const result = mindInitCommand({
      repo,
      charter: "mind.yaml",
      "mind-id": "mind-alpha",
    });

    const runRoot = result.run_root as string;

    const session = resolveActiveSession({
      cwd: repo,
      runRoot,
    });

    expect(session).not.toBeNull();
    expect(session!.agent_id).toBe("mind-alpha");
    expect(session!.role).toBe("mind");
    expect(session!.tier).toBe(0);

    const ledgerBacked = isSessionLedgerBacked(runRoot, "mind-alpha", "mind");
    expect(ledgerBacked).toBe(true);

    const whoami = whoamiCommand({
      run: runRoot,
      agent: "mind-alpha",
    });

    expect(whoami.agent_id).toBe("mind-alpha");
    expect(whoami.role).toBe("mind");
    expect(Array.isArray(whoami.active_grants)).toBe(true);
    expect((whoami.active_grants as unknown[]).length).toBe(1);

    const wakeResult = await mindWakeCommand({
      run: runRoot,
      actor: "mind-alpha",
    });

    expect(wakeResult.run_root).toBe(runRoot);
    expect(wakeResult.mode).toBeDefined();
    expect(wakeResult.actor).toBe("mind-alpha");
  });
});
