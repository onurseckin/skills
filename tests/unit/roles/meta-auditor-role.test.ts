import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  parseAgentManifest,
  parseMarkdownFrontmatter,
  parseRoleContract,
  parseYaml,
  type AgentManifest,
  type RoleContract,
} from "../../../orchestrating-long-tasks/scripts/src/authority/manifest-parser.ts";
import {
  ROOT_CAUSE_CATEGORIES,
  FORENSICS_SEVERITIES,
} from "../../../orchestrating-long-tasks/scripts/src/mind/meta-auditor.ts";

describe("Meta-Auditor Role & Agent Persona Test Suite", () => {
  const rootDir = resolve(import.meta.dir, "../../..");
  const skillDir = join(rootDir, "orchestrating-long-tasks");
  const roleFilePath = join(skillDir, "roles", "meta-auditor.md");
  const agentUnderscoreYamlPath = join(skillDir, "agents", "meta_auditor.yaml");
  const agentHyphenYamlPath = join(skillDir, "agents", "meta-auditor.yaml");

  // -------------------------------------------------------------------------
  // 1. Role Contract Document Structure & Frontmatter (roles/meta-auditor.md)
  // -------------------------------------------------------------------------
  describe("roles/meta-auditor.md Role Contract", () => {
    test("role file exists at expected location", () => {
      expect(existsSync(roleFilePath)).toBe(true);
    });

    test("YAML frontmatter contains exact role, tier, and domain specifications", () => {
      const rawContent = readFileSync(roleFilePath, "utf-8");
      const { frontmatter } = parseMarkdownFrontmatter<Record<string, unknown>>(rawContent);

      expect(frontmatter["role"]).toBe("meta-auditor");
      expect(frontmatter["tier"]).toBe(2);
      expect(frontmatter["domain"]).toBe("forensics");
      expect(Array.isArray(frontmatter["may"])).toBe(true);
      expect(Array.isArray(frontmatter["must_not"])).toBe(true);
      expect(Array.isArray(frontmatter["commands"])).toBe(true);
      expect(Array.isArray(frontmatter["spawns"])).toBe(true);
      expect(frontmatter["spawns"]).toEqual([]);
    });

    test("parses successfully via authority manifest-parser", () => {
      const rawContent = readFileSync(roleFilePath, "utf-8");
      const parsed: RoleContract = parseRoleContract(rawContent, roleFilePath);

      expect(parsed.role).toBe("meta-auditor");
      expect(parsed.tier).toBe(2);
      expect(parsed.domain).toBe("forensics");
      expect(parsed.spawns).toEqual([]);
      expect(parsed.may.length).toBeGreaterThanOrEqual(10);
      expect(parsed.mustNot.length).toBeGreaterThanOrEqual(7);
      expect(parsed.commands.length).toBeGreaterThanOrEqual(6);
    });

    test("capability contract 'may' grants core behavioral forensics responsibilities", () => {
      const rawContent = readFileSync(roleFilePath, "utf-8");
      const endFence = rawContent.indexOf("---", 3);
      const frontmatterText = rawContent.slice(0, endFence);

      // 1. Transcript and capsule inspection
      expect(frontmatterText).toContain(
        "Inspect transcripts, tool calls, events, and run capsules across wave executions",
      );
      // 2. Behavioral forensics and telemetry extraction
      expect(frontmatterText).toContain(
        "Run deep behavioral forensics and extract empirical telemetry across agent runs",
      );
      // 3. Root causes detection (all 7 core heuristics)
      expect(frontmatterText).toContain(
        "Detect root causes: token burning, false serialization, role boundary deviations, polling waste, context overflow, ghost leases, and straggler tasks",
      );
      // 4. Efficiency score computation
      expect(frontmatterText).toContain(
        "Compute deterministic behavioral efficiency scores (0.0% - 100.0%) and quantitative operational metrics",
      );
      // 5. Remediation synthesis
      expect(frontmatterText).toContain(
        "Synthesize actionable remediation proposals and directives from detected forensics incidents",
      );
      // 6. Feedback queue injection
      expect(frontmatterText).toContain(
        "Inject remediation items autonomously into the canonical feedback queue (`.capsules/FEEDBACK_QUEUE.jsonl`) and mind candidate pool",
      );
      // 7. Structured reports
      expect(frontmatterText).toContain(
        "Generate and output structured markdown and JSON deep behavioral forensics reports",
      );
      // 8. Zero-exploration briefings
      expect(frontmatterText).toContain(
        "Issue zero-exploration exact-anchor task briefings to prevent exploratory tool calling and token burning",
      );
      // 9. Reporting to orchestrator and mind
      expect(frontmatterText).toContain(
        "Record and report forensics findings to parent orchestrator and mind supervisory loop",
      );
      // 10. Standardized naming
      expect(frontmatterText).toContain(
        "Register and operate under standardized agent naming (`meta-auditor_<run-or-phase-slug>`)",
      );
    });

    test("capability contract 'must_not' strictly enforces persona boundaries and prohibitions", () => {
      const rawContent = readFileSync(roleFilePath, "utf-8");
      const parsed: RoleContract = parseRoleContract(rawContent, roleFilePath);
      const mustNotText = parsed.mustNot.join("\n");

      // 1. Zero direct code modifications
      expect(mustNotText).toContain("Make direct application source code edits");
      expect(mustNotText).toContain("claim code write leases");
      expect(mustNotText).toContain("delegate to Tier 3 implementers");

      // 2. No rubber-stamping or unevidenced confidence summaries
      expect(mustNotText).toContain("Rubber-stamp approvals");
      expect(mustNotText).toContain("issue superficial passes");
      expect(mustNotText).toContain("unevidenced confidence summaries");

      // 3. Zero direct test execution (delegates to Mechanic Validators)
      expect(mustNotText).toContain("Execute raw repo-wide tests or task tests directly");
      expect(mustNotText).toContain("delegate to Tier 3 Mechanic Validators");

      // 4. Hierarchy preservation (Tier 2 Forensics role)
      expect(mustNotText).toContain("Bypass hierarchical reporting or violate 4-tier hierarchy");
      expect(mustNotText).toContain("Tier 2 Forensics role");

      // 5. Cognitive detachment from subjective narratives
      expect(mustNotText).toContain("Read or consume implementer self-grading narratives");
      expect(mustNotText).toContain("confidence prose");

      // 6. Non-suppression of detected anomalies
      expect(mustNotText).toContain("Suppress or ignore detected root cause incidents");

      // 7. Security invariant: zero credential echoing
      expect(mustNotText).toContain("Echo, log, copy, or persist sensitive tokens or credentials");
    });

    test("commands list grants authorized CLI commands and forbids write/lease mutations", () => {
      const rawContent = readFileSync(roleFilePath, "utf-8");
      const parsed: RoleContract = parseRoleContract(rawContent, roleFilePath);

      // Expected authorized commands
      const expectedCommands = [
        "meta-audit",
        "task:brief",
        "todo:add",
        "mind:candidate",
        "agent:report",
        "whoami",
      ];
      for (const cmd of expectedCommands) {
        expect(parsed.commands).toContain(cmd);
      }

      // Valid CLI command format (no flag arguments, correct regex pattern)
      for (const cmd of parsed.commands) {
        expect(cmd).toMatch(/^[a-z][a-z-]*(?::[a-z][a-z-]*)*$/u);
      }

      // Prohibited code mutation / execution lease commands
      const forbiddenCommands = [
        "task:claim",
        "task:submit",
        "task:validate-start",
        "branch:open",
        "branch:claim",
        "branch:submit",
        "branch:collect",
        "branch:abandon",
      ];
      for (const forbidden of forbiddenCommands) {
        expect(parsed.commands).not.toContain(forbidden);
      }
    });

    test("markdown prose codifies the 7 behavioral heuristics with empirical detection rules", () => {
      const rawContent = readFileSync(roleFilePath, "utf-8");

      // 1. TOKEN_BURNING
      expect(rawContent).toContain("### 1. Token Burning (`TOKEN_BURNING`)");
      expect(rawContent).toContain("more than 5 consecutive exploratory read/browse tool calls");
      expect(rawContent).toContain("ratio exceeds 10:1");

      // 2. FALSE_SERIALIZATION
      expect(rawContent).toContain("### 2. False Serialization (`FALSE_SERIALIZATION`)");
      expect(rawContent).toContain("disjoint write scopes");
      expect(rawContent).toContain("Brent Work/Span concurrency");

      // 3. ROLE_BOUNDARY_DEVIATION
      expect(rawContent).toContain("### 3. Role Boundary Deviation (`ROLE_BOUNDARY_DEVIATION`)");
      expect(rawContent).toContain("Tier 1 or Tier 2 supervisory roles");
      expect(rawContent).toContain("Cognitive validators execute direct code write operations");

      // 4. POLLING_WASTE
      expect(rawContent).toContain("### 4. Polling Waste (`POLLING_WASTE`)");
      expect(rawContent).toContain("count $\\ge 4$");
      expect(rawContent).toContain("WaitMsBeforeAsync: 10000");

      // 5. CONTEXT_OVERFLOW
      expect(rawContent).toContain("### 5. Context Saturation & Overflow (`CONTEXT_OVERFLOW`)");
      expect(rawContent).toContain(">150,000");

      // 6. GHOST_LEASE
      expect(rawContent).toContain("### 6. Ghost Leases (`GHOST_LEASE`)");
      expect(rawContent).toContain("status is already `released` or dead");

      // 7. STRAGGLER
      expect(rawContent).toContain("### 7. Straggler Tasks (`STRAGGLER`)");
      expect(rawContent).toContain("exceeds $3\\times$ the run's average");
    });

    test("markdown prose defines the deterministic efficiency scoring model and penalty tiers", () => {
      const rawContent = readFileSync(roleFilePath, "utf-8");

      expect(rawContent).toContain("Deterministic Efficiency Scoring Model");
      expect(rawContent).toContain("0.0\\%");
      expect(rawContent).toContain("100.0\\%");
      expect(rawContent).toContain("CRITICAL Incident**: $-25.0$");
      expect(rawContent).toContain("HIGH Incident**: $-15.0$");
      expect(rawContent).toContain("MEDIUM Incident**: $-8.0$");
      expect(rawContent).toContain("LOW Incident**: $-3.0$");
    });

    test("markdown prose specifies 5-dimensional Socratic reflexive self-questioning", () => {
      const rawContent = readFileSync(roleFilePath, "utf-8");

      expect(rawContent).toContain("Socratic Reflexive Self-Questioning");
      expect(rawContent).toContain("1. **Premise Verification**");
      expect(rawContent).toContain("2. **Edge Case Exploration**");
      expect(rawContent).toContain("3. **Failure Mode Analysis**");
      expect(rawContent).toContain("4. **Hierarchy & Invariant Preservation**");
      expect(rawContent).toContain("5. **Quantitative Empirical Proof**");
    });

    test("markdown prose specifies Closed-Loop Feedback Injection & Zero-Exploration Protocol", () => {
      const rawContent = readFileSync(roleFilePath, "utf-8");

      expect(rawContent).toContain("Plan & Feedback Injection Protocols");
      expect(rawContent).toContain(".capsules/FEEDBACK_QUEUE.jsonl");
      expect(rawContent).toContain("Zero-Exploration Integration & Exact-Anchor Protocol");
      expect(rawContent).toContain("task:brief");
    });
  });

  // -------------------------------------------------------------------------
  // 2. Agent Personas (meta_auditor.yaml & meta-auditor.yaml)
  // -------------------------------------------------------------------------
  describe("Agent Personas (agents/meta_auditor.yaml & agents/meta-auditor.yaml)", () => {
    const yamlPaths = [
      { path: agentUnderscoreYamlPath, expectedName: "meta_auditor" },
      { path: agentHyphenYamlPath, expectedName: "meta-auditor" },
    ];

    for (const { path, expectedName } of yamlPaths) {
      describe(`Persona: ${expectedName} (${path.split("/").pop()})`, () => {
        test("YAML file exists on disk", () => {
          expect(existsSync(path)).toBe(true);
        });

        test("parses as a valid AgentManifest object", () => {
          const rawContent = readFileSync(path, "utf-8");
          const parsedManifest: AgentManifest = parseAgentManifest(rawContent, path);

          expect(parsedManifest.name).toBe(expectedName);
          expect(parsedManifest.role).toBe("meta-auditor");
          expect(parsedManifest.tier).toBe(1);
          expect(parsedManifest.provider).toEqual([
            "antigravity",
            "agy",
            "claude",
            "codex",
            "cursor",
            "generic",
          ]);
        });

        test("enforces tool prohibitions (enable_subagent_tools: false, enable_write_tools: false)", () => {
          const rawContent = readFileSync(path, "utf-8");
          const parsed = parseYaml(rawContent) as Record<string, unknown>;

          // Top-level tools configuration
          const tools = parsed["tools"] as Record<string, unknown>;
          expect(tools).toBeDefined();
          expect(tools["enable_subagent_tools"]).toBe(false);
          expect(tools["enable_write_tools"]).toBe(false);

          // Interface level tools configuration
          const iface = parsed["interface"] as Record<string, unknown>;
          expect(iface).toBeDefined();
          const ifaceTools = iface["tools"] as Record<string, unknown>;
          expect(ifaceTools).toBeDefined();
          expect(ifaceTools["enable_subagent_tools"]).toBe(false);
          expect(ifaceTools["enable_write_tools"]).toBe(false);
        });

        test("declares meta_auditor_invariants in interface configuration", () => {
          const rawContent = readFileSync(path, "utf-8");
          const parsed = parseYaml(rawContent) as Record<string, unknown>;
          const iface = parsed["interface"] as Record<string, unknown>;
          const invariants = iface["meta_auditor_invariants"] as Record<string, boolean>;

          expect(invariants).toBeDefined();
          expect(invariants["zero_source_code_edits"]).toBe(true);
          expect(invariants["deterministic_forensics_telemetry"]).toBe(true);
          expect(invariants["autonomous_plan_injection"]).toBe(true);
          expect(invariants["exact_anchor_enforcement"]).toBe(true);
        });

        test("declares protocol settings binding to roles/meta-auditor.md", () => {
          const rawContent = readFileSync(path, "utf-8");
          const parsedManifest: AgentManifest = parseAgentManifest(rawContent, path);

          expect(parsedManifest.protocol).toBeDefined();
          expect(parsedManifest.protocol?.role_contract).toBe("roles/meta-auditor.md");
          expect(parsedManifest.protocol?.zero_json).toBe(true);
          expect(parsedManifest.protocol?.cli).toBe(
            "bun ~/.agents/skills/orchestrating-long-tasks/scripts/harness.ts",
          );
        });

        test("instructions and system_prompt contain complete behavioral forensics guidelines", () => {
          const rawContent = readFileSync(path, "utf-8");
          const parsed = parseYaml(rawContent) as Record<string, unknown>;

          const protocol = parsed["protocol"] as Record<string, unknown>;
          const instructions = String(protocol["instructions"]);
          const systemPrompt = String(parsed["system_prompt"]);

          for (const text of [instructions, systemPrompt]) {
            // Role & contract definition
            expect(text).toContain("Tier 1 Meta-Auditor");
            expect(text).toContain("roles/meta-auditor.md");

            // Naming conventions
            expect(text).toContain("meta-auditor_<run-or-audit-slug>");

            // 3 Non-Negotiable Invariants
            expect(text).toContain("Zero Direct Code Modifications");
            expect(text).toContain("Empirical Fact-Based Evidence");
            expect(text).toContain("Cognitive Independence");

            // All 7 root cause categories
            for (const category of ROOT_CAUSE_CATEGORIES) {
              expect(text).toContain(category);
            }

            // Heuristic details
            expect(text).toContain("TOKEN_BURNING");
            expect(text).toContain("FALSE_SERIALIZATION");
            expect(text).toContain("ROLE_BOUNDARY_DEVIATION");
            expect(text).toContain("POLLING_WASTE");
            expect(text).toContain("CONTEXT_OVERFLOW");
            expect(text).toContain("GHOST_LEASE");
            expect(text).toContain("STRAGGLER");

            // Zero exploration
            expect(text).toContain("Zero-Exploration Exact-Anchor Integration");

            // CLI workflow
            expect(text).toContain("meta-audit --run <run-root>");
            expect(text).toContain("--inject");
            expect(text).toContain(".capsules/FEEDBACK_QUEUE.jsonl");
          }
        });
      });
    }
  });

  // -------------------------------------------------------------------------
  // 3. Cross-Contract Coherence & Invariants Validation
  // -------------------------------------------------------------------------
  describe("Cross-Contract Coherence & Static Invariants", () => {
    test("root cause taxonomy in roles/meta-auditor.md matches ROOT_CAUSE_CATEGORIES constant exactly", () => {
      const rawContent = readFileSync(roleFilePath, "utf-8");

      for (const cat of ROOT_CAUSE_CATEGORIES) {
        expect(rawContent).toContain(`\`${cat}\``);
      }
    });

    test("severity levels in roles/meta-auditor.md match FORENSICS_SEVERITIES constant exactly", () => {
      const rawContent = readFileSync(roleFilePath, "utf-8");

      for (const sev of FORENSICS_SEVERITIES) {
        expect(rawContent).toContain(`**${sev} Incident**`);
      }
    });

    test("no persona or role document violates host-neutrality with hardcoded invoke_subagent calls", () => {
      const rawRole = readFileSync(roleFilePath, "utf-8");
      const rawUnderscore = readFileSync(agentUnderscoreYamlPath, "utf-8");
      const rawHyphen = readFileSync(agentHyphenYamlPath, "utf-8");

      expect(rawRole).not.toContain("invoke_subagent(");
      expect(rawUnderscore).not.toContain("invoke_subagent(");
      expect(rawHyphen).not.toContain("invoke_subagent(");
    });

    test("role document and agent personas have zero TypeScript compiler suppressions", () => {
      const targetPaths = [roleFilePath, agentUnderscoreYamlPath, agentHyphenYamlPath];

      for (const filePath of targetPaths) {
        const content = readFileSync(filePath, "utf-8");
        expect(content).not.toContain("@ts-ignore");
        expect(content).not.toContain("@ts-expect-error");
        expect(content).not.toContain("eslint-disable");
      }
    });
  });
});
