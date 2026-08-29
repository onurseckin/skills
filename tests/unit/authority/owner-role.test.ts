import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findSkillRoot,
  listAvailableManifests,
  listAvailableRoles,
  loadAgentManifest,
  loadRoleContract,
  loadUnifiedAgentModel,
} from "../../../olt/scripts/src/authority/manifest-parser.ts";
import {
  parseUnifiedAgentManifest,
  validateUnifiedAgentManifest,
  type UnifiedAgentManifest,
} from "../../../olt/scripts/src/authority/manifest-schema.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { initRun, transact } from "../../../olt/scripts/src/engine/store/index.ts";
import {
  assertRoleMayDecideProposal,
  decideProposal,
  isProposalAdmissible,
  isProposalGranted,
  PROPOSAL_WITNESS_OWNER_DECISION,
  recordProposal,
} from "../../../olt/scripts/src/mind/proposals/proposal/index.ts";
import {
  auditPermissionHealth,
  generateDefaultRepoPolicy,
  loadRepoPolicy,
} from "../../../olt/scripts/src/policy/index.ts";
import { verifyCommandAuthorization } from "../../../olt/scripts/src/policy/index.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots) {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // cleanup error ignored
    }
  }
  roots.length = 0;
});

function createCapsule(name: string): { readonly repo: string; readonly run: string } {
  const repo = mkdtempSync(join(tmpdir(), `owner-role-test-${name}-`));
  roots.push(repo);

  const charterDir = join(repo, "olt", "agents");
  mkdirSync(charterDir, { recursive: true });
  const charterPath = join(charterDir, "mind.yaml");
  writeFileSync(
    charterPath,
    `name: "mind"\nrole: "mind"\ncharter:\n  identity: "Test Mind"\n  goals:\n    - id: "G1"\n      statement: "Discovery"\n  repo_roots:\n    - "src/"\n`,
    "utf-8",
  );

  const charterBytes = readFileSync(charterPath);
  const charterSha = createHash("sha256").update(charterBytes).digest("hex");
  const run = initRun(repo, `owner-run-${name}`, charterBytes, "file", true);

  transact(run, "mind-init", "mind-initialized", {}, (working) => {
    working.mind = {
      generation: 1,
      opened_at: new Date().toISOString(),
      charter: {
        source_path: "olt/agents/mind.yaml",
        pinned_sha256: charterSha,
        goals: ["G1"],
        repo_roots: ["src/"],
        evidence_class: "harness_observed",
      },
      actor: "mind-1",
    };
  });

  return { repo, run };
}

describe("Task 4.2: Owner Role Genesis & Manifest Schema Optionality", () => {
  describe("Manifest Schema Optionality (hb-s6-manifest-schema-coerces-absent-commands)", () => {
    test("handles undefined commands vs explicit empty array commands", () => {
      const omittedYaml = `name: "no-commands-agent"\nrole: "custom"\ntier: 3\npermissions:\n  may:\n    - "read files"\n  must_not:\n    - "write files"\n`;
      const manifestOmitted = parseUnifiedAgentManifest(omittedYaml);
      expect(manifestOmitted.permissions.commands).toBeUndefined();
      expect(validateUnifiedAgentManifest(manifestOmitted).valid).toBe(true);

      const emptyArrayYaml = `name: "empty-commands-agent"\nrole: "custom"\ntier: "independent"\npermissions:\n  may:\n    - "concept design"\n  must_not:\n    - "run tools"\n  commands: []\n`;
      const manifestEmpty = parseUnifiedAgentManifest(emptyArrayYaml);
      expect(manifestEmpty.permissions.commands).toEqual([]);
      expect(validateUnifiedAgentManifest(manifestEmpty).valid).toBe(true);

      const declaredYaml = `name: "declared-agent"\nrole: "owner"\ntier: "independent"\npermissions:\n  may:\n    - "genesis conferral"\n  must_not:\n    - "unwitnessed actions"\n  commands:\n    - "authority:decide"\n    - "agent:register"\n`;
      const manifestDeclared = parseUnifiedAgentManifest(declaredYaml);
      expect(manifestDeclared.permissions.commands).toEqual(["authority:decide", "agent:register"]);
      expect(validateUnifiedAgentManifest(manifestDeclared).valid).toBe(true);
    });

    test("validates commands array type safety when commands are present", () => {
      const invalidCommandsManifest: UnifiedAgentManifest = {
        name: "bad-commands",
        role: "bad",
        tier: 3,
        provider: ["generic"],
        tools: { enable_subagent_tools: false, enable_write_tools: false },
        interface: { display_name: "Bad", short_description: "Bad" },
        permissions: {
          may: [],
          must_not: [],
          commands: [123 as unknown as string],
          spawns: [],
        },
        invariants: [],
        protocol: { cli: "bun harness.ts", zero_json: true },
        instructions: "bad",
      };

      const result = validateUnifiedAgentManifest(invalidCommandsManifest);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes("permissions.commands"))).toBe(true);
    });
  });

  describe("Owner Manifest Definition (hb-s8-owner-yaml-behind-sync-bar)", () => {
    test("olt/agents/owner.yaml exists, parses cleanly, and passes validation", () => {
      const skillRoot = findSkillRoot();
      const ownerYamlPath = join(skillRoot, "agents", "owner.yaml");
      const rawYaml = readFileSync(ownerYamlPath, "utf-8");
      const manifest = parseUnifiedAgentManifest(rawYaml, ownerYamlPath);

      expect(manifest.name).toBe("owner");
      expect(manifest.role).toBe("owner");
      expect(manifest.tier).toBe("independent");
      expect(manifest.tools.enable_write_tools).toBe(true);
      expect(manifest.tools.enable_subagent_tools).toBe(true);
      expect(manifest.permissions.commands).toContain("authority:decide");
      expect(manifest.permissions.commands).toContain("agent:register");
      expect(manifest.permissions.commands).toContain("recover");

      expect(validateUnifiedAgentManifest(manifest).valid).toBe(true);

      const policy = loadRepoPolicy();
      const health = auditPermissionHealth(manifest, policy);
      expect(health.healthy).toBe(true);
      expect(health.errors).toHaveLength(0);
    });

    test("generated repo policy includes genesis owner role with rbac capabilities", () => {
      const policy = generateDefaultRepoPolicy(process.cwd());
      expect(policy.agents?.owner).toBeDefined();
      expect(policy.agents?.owner?.tier).toBe("independent");
      expect(policy.agents?.owner?.rbac.can_execute_shell).toBe(true);
      expect(policy.agents?.owner?.rbac.can_edit_code).toBe(true);
      expect(policy.agents?.owner?.rbac.allowed_commands).toContain("authority:decide");
      expect(policy.agents?.owner?.rbac.allowed_commands).toContain("agent:register");
      expect(policy.agents?.owner?.rbac.allowed_commands).toContain("recover");
    });

    test("manifest parser loads owner role contract and unified agent model", () => {
      const agentManifest = loadAgentManifest("owner", { bypassCache: true });
      expect(agentManifest.name).toBe("owner");
      expect(agentManifest.role).toBe("owner");
      expect(agentManifest.permissions?.commands).toContain("agent:register");
      expect(agentManifest.permissions?.commands).toContain("authority:decide");

      const roleContract = loadRoleContract("owner", { bypassCache: true });
      expect(roleContract.role).toBe("owner");
      expect(roleContract.commands).toContain("agent:register");
      expect(roleContract.commands).toContain("authority:decide");

      const unifiedModel = loadUnifiedAgentModel("owner", { bypassCache: true });
      expect(unifiedModel.role).toBe("owner");
      expect(unifiedModel.commands).toContain("authority:decide");
      expect(unifiedModel.tools.enable_write_tools).toBe(true);

      expect(listAvailableRoles({ bypassCache: true })).toContain("owner");
      expect(listAvailableManifests({ bypassCache: true })).toContain("owner");
    });
  });

  describe("Authority Conferral & Witness Isolation (hb-s6-authority-decide-granted-to-zero-roles)", () => {
    test("owner role can execute authority:decide and confer PROPOSAL_WITNESS_OWNER_DECISION", () => {
      const capsule = createCapsule("owner-decide-witness");

      const proposal = recordProposal(capsule.run, {
        id: "prop-owner-1",
        statement: "Autonomous self-improvement task",
        rationale: "Requires genesis authority grant",
        charter_goal_ids: ["G1"],
        actor: "mind-1",
        pulseId: "pulse-1",
        minIntervalMs: 0,
      });

      expect(proposal.status).toBe("needs_authority");
      expect(isProposalGranted(proposal)).toBe(false);
      expect(isProposalAdmissible(proposal)).toBe(false);

      const decided = decideProposal(
        capsule.run,
        proposal.id,
        "owner-genesis",
        {
          decision: "grant",
          rationale: "Genesis authority conferred by repository owner",
        },
        { actorRole: "owner" },
      );

      expect(decided.status).toBe("granted");
      expect(decided.disposition).toBe("actionable");
      expect(decided.witness).toBe(PROPOSAL_WITNESS_OWNER_DECISION);
      expect(decided.witness_command_id).toBe(PROPOSAL_WITNESS_OWNER_DECISION);
      expect(decided.decided_by).toBe("owner-genesis");
      expect(decided.rationale).toBe("Genesis authority conferred by repository owner");

      expect(isProposalGranted(decided)).toBe(true);
      expect(isProposalAdmissible(decided)).toBe(true);
    });

    test("witness isolation prevents mind from self-approving proposals for mind:admit", () => {
      expect(() => assertRoleMayDecideProposal("mind", "mind-1")).toThrow(HarnessError);

      const capsule = createCapsule("mind-self-approval-blocked");
      const proposal = recordProposal(capsule.run, {
        id: "prop-mind-unauthorized",
        statement: "Unauthorized self-approval attempt",
        rationale: "Mind attempts to bypass witness isolation",
        charter_goal_ids: ["G1"],
        actor: "mind-1",
        pulseId: "pulse-1",
        minIntervalMs: 0,
      });

      expect(() =>
        decideProposal(
          capsule.run,
          proposal.id,
          "mind-1",
          { decision: "grant", rationale: "Self approved" },
          { actorRole: "mind" },
        ),
      ).toThrow(HarnessError);

      expect(isProposalGranted(proposal)).toBe(false);
      expect(isProposalAdmissible(proposal)).toBe(false);
    });

    test("command authority and rbac recognizes authority:decide, agent:register, and recover for owner role", () => {
      const policy = generateDefaultRepoPolicy(process.cwd());
      expect(policy.agents?.owner).toBeDefined();

      const ownerActor = { role: "owner", agent_id: "owner-1", can_execute_shell: true };

      const decideAuth = verifyCommandAuthorization(ownerActor, "authority:decide", policy);
      expect(decideAuth.error_code).toBeUndefined();
      expect(decideAuth.authorized).toBe(true);

      const recoverAuth = verifyCommandAuthorization(ownerActor, "recover", policy);
      expect(recoverAuth.authorized).toBe(true);

      const regAuth = verifyCommandAuthorization(ownerActor, "agent:register", policy);
      expect(regAuth.authorized).toBe(true);

      const unauthorizedActor = {
        role: "unregistered_actor",
        agent_id: "intruder-1",
        can_execute_shell: true,
      };
      const unauthDecide = verifyCommandAuthorization(
        unauthorizedActor,
        "authority:decide",
        policy,
      );
      expect(unauthDecide.authorized).toBe(false);
      expect(unauthDecide.error_code).toBe("PERMISSION_DENIED");
    });
  });
});
