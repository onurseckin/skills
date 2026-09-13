import { describe, it, expect } from "bun:test";
import {
  parseUnifiedAgentManifest,
  validateUnifiedAgentManifest,
} from "../../../olt/scripts/src/authority/manifest-schema.ts";
import rawYaml from "../../../olt/agents/ui-optical-validator.yaml" with { type: "text" };
import * as yaml from "js-yaml";

const MANIFEST_PATH = "olt/agents/ui-optical-validator.yaml";

describe("ui-optical-validator manifest human perception overhaul", () => {
  const rawDoc = yaml.load(rawYaml) as {
    tools: {
      enable_subagent_tools: boolean;
      enable_write_tools: boolean;
      can_execute_shell: boolean;
    };
  };
  const manifest = parseUnifiedAgentManifest(rawYaml, MANIFEST_PATH);

  it("parses as a valid unified agent manifest with zero schema errors", () => {
    expect(manifest.name).toBe("ui-optical-validator");
    expect(manifest.role).toBe("ui-optical-validator");
    expect(manifest.tier).toBe(3);

    const validation = validateUnifiedAgentManifest(manifest);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);
  });

  it("strictly enforces zero shell command execution and zero write tools", () => {
    // Structural tool prohibitions
    expect(rawDoc.tools.can_execute_shell).toBe(false);
    expect(manifest.tools.enable_write_tools).toBe(false);
    expect(manifest.tools.enable_subagent_tools).toBe(false);
    expect(manifest.permissions.spawns).toEqual([]);

    // Prohibited commands
    const disallowedCommands = ["run:exec", "shell", "exec", "bash", "bun test", "sh"];
    for (const cmd of disallowedCommands) {
      expect(manifest.permissions.commands).not.toContain(cmd);
    }

    // Must-not prohibitions for command execution
    const hasShellBan = manifest.permissions.must_not.some((rule) =>
      /Execute ANY bash.*can_execute_shell:\s*false/i.test(rule),
    );
    expect(hasShellBan).toBe(true);
  });

  it("enforces cognitive code-blindness and forbids source code / AST inspection", () => {
    expect(manifest.invariants).toContain("COGNITIVE_CODE_BLINDNESS_INVARIANT");

    const hasCodeBlindnessRule = manifest.permissions.must_not.some((rule) =>
      /COGNITIVE_CODE_BLINDNESS_INVARIANT|source code|TSX components/i.test(rule),
    );
    expect(hasCodeBlindnessRule).toBe(true);

    // Verify view_file is quarantined strictly to rendered image artifacts
    const hasViewFileQuarantine = manifest.permissions.must_not.some((rule) =>
      /Invoke `view_file`.*source code.*quarantined to rendered image screenshot artifacts/i.test(
        rule,
      ),
    );
    expect(hasViewFileQuarantine).toBe(true);

    expect(manifest.instructions).toContain("COGNITIVE_CODE_BLINDNESS_INVARIANT");
    expect(manifest.instructions).toMatch(/NEVER read source code|AST/i);
    expect(manifest.instructions).toMatch(/NEVER invoke `view_file` on non-image/i);
  });

  it("completely removes formulaic 8-point checklist parroting and robotic rubrics", () => {
    // Prohibit legacy 8 Optical Dimensions checklist
    expect(rawYaml).not.toContain("8 Optical Dimensions");
    expect(manifest.instructions).not.toContain("8 Optical Dimensions");

    // Prohibit formulaic rubric recitation
    expect(manifest.instructions).toMatch(/NEVER recite numbered checklists/i);
    expect(manifest.instructions).toMatch(/NEVER output JSON diagnostic stubs/i);

    const hasChecklistBan = manifest.permissions.must_not.some((rule) =>
      /numbered 8-point checklists|bureaucratic rubrics/i.test(rule),
    );
    expect(hasChecklistBan).toBe(true);

    const hasJsonStubBan = manifest.permissions.must_not.some((rule) =>
      /raw JSON stubs|synthetic diagnostic objects/i.test(rule),
    );
    expect(hasJsonStubBan).toBe(true);
  });

  it("enforces the 3-Stage Natural Human Eye Flow structure in instructions", () => {
    expect(manifest.instructions).toContain("The Natural 3-Stage Human Eye Flow");
    expect(manifest.instructions).toContain("Immediate Visceral Impression");
    expect(manifest.instructions).toContain("Responsive Narrative Walkthrough");
    expect(manifest.instructions).toContain("Clear Verdict & Concrete Guidance");

    // Invariants governing human perception and defect separation
    expect(manifest.invariants).toContain("FORMLESS_HUMAN_PERCEPTION_MANDATE");
    expect(manifest.invariants).toContain("TWO_TIER_DEFECT_SEPARATION_INVARIANT");
    expect(manifest.invariants).toContain("FOUR_VIEWPORT_MANDATORY_INSPECTION");
    expect(manifest.invariants).toContain("THREE_STRIKE_ARBITRATION_INVARIANT");
    expect(manifest.invariants).toContain("PAYLOAD_BUDGET_EXCEEDED_PREVENTION");
  });

  it("dynamically resolves personas from target repository policy without hardcoding SaaS roles", () => {
    // Prohibit hardcoding specific SaaS RBAC personas in manifest instructions and permissions
    const hardcodedSaaSPersonas = ["admin", "standard_user", "invited_member", "guest"];
    for (const persona of hardcodedSaaSPersonas) {
      expect(manifest.instructions).not.toContain(`**${persona}**:`);
      expect(rawYaml).not.toContain(persona);
    }

    // Verify dynamic policy-driven persona requirement
    expect(manifest.instructions).toMatch(
      /dynamically declared in the target repository's `\.olt\/policy\.json`/i,
    );
    expect(manifest.instructions).toMatch(/demo_users/);
    expect(manifest.instructions).toMatch(/personas/);
    expect(manifest.instructions).toMatch(/test_profiles/);
    expect(manifest.instructions).toMatch(/authentic goals, technical fluency, and intent/i);
    expect(manifest.instructions).toMatch(
      /natural, first-time human user visiting the product to accomplish its primary objective/i,
    );

    const hasPersonaPerm = manifest.permissions.may.some((rule) =>
      /Inhabit active user personas dynamically declared in the target repository's \.olt\/policy\.json/i.test(
        rule,
      ),
    );
    expect(hasPersonaPerm).toBe(true);
  });

  it("enforces the Anti-Token-Echo Invariant and experiential persona focus", () => {
    // Verifies prohibition against echoing static auth tokens/permissions
    const hasAntiTokenEchoMustNot = manifest.permissions.must_not.some((rule) =>
      /Anti-Token-Echo Invariant|Echo raw persona authentication tokens/i.test(rule),
    );
    expect(hasAntiTokenEchoMustNot).toBe(true);

    // Verifies instructions mandate experiential need state focus rather than token echoing
    expect(manifest.instructions).toContain("Anti-Token-Echo Invariant");
    expect(manifest.instructions).toMatch(
      /NEVER echo static policy permissions or authentication tokens/i,
    );
    expect(manifest.instructions).toMatch(/Embody the persona experientially/i);
    expect(manifest.instructions).toMatch(/authentic goals, technical fluency, and intent/i);
  });

  it("enforces 4 mandatory viewports and headful view_file inspection", () => {
    const viewports = ["390", "768", "1440", "1920"];
    for (const vp of viewports) {
      expect(manifest.instructions).toContain(vp);
    }

    const hasViewportMay = manifest.permissions.may.some(
      (rule) =>
        rule.includes("view_file") &&
        rule.includes("390") &&
        rule.includes("768") &&
        rule.includes("1440") &&
        rule.includes("1920"),
    );
    expect(hasViewportMay).toBe(true);

    const hasHeadfulInvariant =
      manifest.invariants.includes("FOUR_VIEWPORT_MANDATORY_INSPECTION") &&
      manifest.invariants.includes("HEADFUL_VISUAL_SCREENSHOT_REVIEW_MANDATE");
    expect(hasHeadfulInvariant).toBe(true);
  });

  it("differentiates Tier A blocking defects from Tier B advisory polish", () => {
    expect(manifest.instructions).toContain("Tier A (Blocking Defects)");
    expect(manifest.instructions).toContain("Tier B (Advisory Polish)");
    expect(manifest.instructions).toContain("Falsifiable Citation Tuple");

    const hasTierSeparationPerm = manifest.permissions.may.some(
      (rule) => /Tier A/i.test(rule) && /Tier B/i.test(rule),
    );
    expect(hasTierSeparationPerm).toBe(true);

    const hasDefectInflationBan = manifest.permissions.must_not.some((rule) =>
      /Inflate subjective aesthetic preferences into blocking Tier A rejections/i.test(rule),
    );
    expect(hasDefectInflationBan).toBe(true);
  });

  it("enforces substantive volume floor (>= 250 words) and unambiguous PASS/FAIL verdicts", () => {
    // Substantive volume floor in permissions and instructions
    const hasVolumeFloorMay = manifest.permissions.may.some((rule) => />=\s*250 words/i.test(rule));
    expect(hasVolumeFloorMay).toBe(true);
    expect(manifest.instructions).toMatch(/minimum 250 words/i);
    expect(manifest.instructions).toContain("Substantive Volume & Prose Depth");

    // Unambiguous PASS/FAIL verdict command mappings
    expect(manifest.instructions).toMatch(/PASS \(`task:review`\)/);
    expect(manifest.instructions).toMatch(/FAIL \(`task:reject`\)/);
    expect(manifest.instructions).toContain("task:review --advisory");

    const hasVerdictPerm = manifest.permissions.may.some((rule) =>
      /Issue unambiguous verdicts: emit `task:review`.*emit falsifiable Tier A rejections \(`task:reject`\)/i.test(
        rule,
      ),
    );
    expect(hasVerdictPerm).toBe(true);
  });

  it("enforces mailbox_ipc, zero_json, and doctor:verify mandatory turn completion", () => {
    expect(manifest.communication_contract?.protocol).toBe("mailbox_ipc");
    expect(manifest.communication_contract?.ban_raw_jsonl_reading).toBe(true);
    expect(manifest.communication_contract?.forbid_native_messaging).toBe(true);
    expect(manifest.protocol.zero_json).toBe(true);

    const hasDoctorVerifyAction =
      manifest.communication_contract &&
      "mandatory_turn_completion_actions" in manifest.communication_contract;
    // Check raw YAML communication_contract for mandatory_turn_completion_actions
    expect(rawYaml).toContain("mandatory_turn_completion_actions:");
    expect(rawYaml).toContain('- "doctor:verify"');
  });
});
