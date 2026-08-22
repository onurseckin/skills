import { describe, expect, it } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDualChannelAudit, dualChannelRefusalMessage } from "./task-review-support.ts";
import { taskReviewCommand } from "./task-review.ts";
import { initRun, transact } from "../../store/index.ts";
import { ingestScreenshots } from "../../reporting/screenshot-ingestion.ts";
import { tokenDigest } from "../../workflow/lease/token.ts";
import { publishTaskRolePacket } from "../../packets/role-grant.ts";
import { workflowPort } from "../../integration/store-ports.ts";
import { runAndRecordCommand } from "../../integration/record-command.ts";
import { HarnessError } from "../../errors/harness-error.ts";
import type { TaskRecord } from "../../workflow/types.ts";
import type { ScreenshotRecord } from "../../reporting/screenshot-types.ts";
import type { CompanionManifestData } from "../../validation/dual-channel-types.ts";

describe("Task Review Dual-Channel Audit & Companion Manifest Integration", () => {
  const dummyTask: TaskRecord = {
    id: "task-01",
    label: "Implement UI button component",
    lane: 0,
    requirement_ids: ["req-01"],
    dependencies: [],
    write_scope: ["src/components/Button.tsx"],
    acceptance: [{ id: "acc-01", statement: "Renders button" }],
    status: "running",
    attempts: [],
    history: [],
    repair_round: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const validScreenshots: ScreenshotRecord[] = [
    {
      kind: "screenshot",
      name: "button-desktop.png",
      path: "/mock/button-desktop.png",
      sha256: "sha-desktop",
      bytes: 2048,
      blob_path: "/mock/blobs/sha-desktop",
      storage: "copy",
      original_path: "/mock/button-desktop.png",
    },
    {
      kind: "screenshot",
      name: "button-tablet.png",
      path: "/mock/button-tablet.png",
      sha256: "sha-tablet",
      bytes: 1536,
      blob_path: "/mock/blobs/sha-tablet",
      storage: "copy",
      original_path: "/mock/button-tablet.png",
    },
    {
      kind: "screenshot",
      name: "button-mobile.png",
      path: "/mock/button-mobile.png",
      sha256: "sha-mobile",
      bytes: 1200,
      blob_path: "/mock/blobs/sha-mobile",
      storage: "copy",
      original_path: "/mock/button-mobile.png",
    },
  ];

  it("fails audit and generates refusal message when screenshot is < 1024 bytes", () => {
    const stubScreenshot: ScreenshotRecord = {
      kind: "screenshot",
      name: "button-desktop.png",
      path: "/mock/button-desktop.png",
      sha256: "dummy-sha",
      bytes: 67, // Stub!
      blob_path: "/mock/blobs/dummy-sha",
      storage: "copy",
      original_path: "/mock/button-desktop.png",
    };

    const audit = runDualChannelAudit("/mock/runRoot", dummyTask, [stubScreenshot], []);
    expect(audit.isUiTask).toBe(true);
    expect(audit.passed).toBe(false);
    expect(audit.mode).toBe("rejected");

    const refusal = dualChannelRefusalMessage(dummyTask.id, audit);
    expect(refusal).toContain("cannot pass task-01");
    expect(refusal).toContain("Anti-Mocking Invariant Violation");
    expect(refusal).toContain("< 1024 bytes");
  });

  it("fails audit and generates actionable refusal message when companion manifest contains shallow/boilerplate evidence under requireSemanticDepth: true", () => {
    const shallowManifest: CompanionManifestData = {
      schema: "companion.manifest.v1",
      screenId: "button-preview",
      viewport: "desktop",
      criteria: [
        {
          id: "CRIT-MECH-APCA",
          pillar: "mechanical",
          name: "APCA Contrast",
          passed: true,
          details: "looks good", // boilerplate
          evidence: "pass", // boilerplate
        },
        {
          id: "CRIT-COGN-STATES",
          pillar: "cognitive",
          name: "UI States FSM",
          passed: true,
          details: "ok", // boilerplate
          evidence: "verified", // boilerplate
        },
        {
          id: "CRIT-PROD-GEIST-TOKENS",
          pillar: "product",
          name: "Geist Tokens",
          passed: true,
          details: "valid", // boilerplate
          evidence: "as expected", // boilerplate
        },
        {
          id: "CRIT-UX-STATE-LAYERS",
          pillar: "ux",
          name: "State Layers",
          passed: true,
          details: "done", // boilerplate
          evidence: "fine", // boilerplate
        },
      ],
    };

    const audit = runDualChannelAudit(
      "/mock/runRoot",
      dummyTask,
      validScreenshots,
      [shallowManifest],
      { requireSemanticDepth: true },
    );

    expect(audit.isUiTask).toBe(true);
    expect(audit.passed).toBe(false);
    expect(audit.mode).toBe("rejected");

    const refusal = dualChannelRefusalMessage(dummyTask.id, audit);
    expect(refusal).toContain("cannot pass task-01");
    expect(refusal).toContain(
      "Dual-Channel Validator Protocol mandate not satisfied (mode rejected)",
    );
    expect(refusal).toContain("boilerplate_evidence");
    expect(refusal).toContain("looks good");
  });

  it("fails audit and generates actionable refusal message when companion manifest contains superficial evidence (< 12 chars)", () => {
    const superficialManifest: CompanionManifestData = {
      schema: "companion.manifest.v1",
      screenId: "button-preview",
      viewport: "desktop",
      criteria: [
        {
          id: "CRIT-MECH-APCA",
          pillar: "mechanical",
          name: "APCA Contrast",
          passed: true,
          details: "Short text", // 10 chars (< 12)
          evidence: "APCA Lc=78.4 across 25 nodes",
        },
        {
          id: "CRIT-COGN-STATES",
          pillar: "cognitive",
          name: "UI States FSM",
          passed: true,
          details: "All UI interaction states implemented cleanly",
          evidence: "5 states ok", // 11 chars (< 12)
        },
        {
          id: "CRIT-PROD-GEIST-TOKENS",
          pillar: "product",
          name: "Geist Tokens",
          passed: true,
          details: "Conforms to typography and spacing tokens throughout",
          evidence: "42 token usages validated",
        },
        {
          id: "CRIT-UX-STATE-LAYERS",
          pillar: "ux",
          name: "State Layers",
          passed: true,
          details: "State layers calibrated against Material 3 specs",
          evidence: "Hover opacity 0.08 tested",
        },
      ],
    };

    const audit = runDualChannelAudit(
      "/mock/runRoot",
      dummyTask,
      validScreenshots,
      [superficialManifest],
      { requireSemanticDepth: true },
    );

    expect(audit.isUiTask).toBe(true);
    expect(audit.passed).toBe(false);
    expect(audit.mode).toBe("rejected");

    const refusal = dualChannelRefusalMessage(dummyTask.id, audit);
    expect(refusal).toContain("cannot pass task-01");
    expect(refusal).toContain("superficial_evidence");
    expect(refusal).toContain("CRIT-MECH-APCA");
  });

  it("fails audit and generates actionable refusal message when companion manifest evidence lacks quantitative metrics", () => {
    const noMetricsManifest: CompanionManifestData = {
      schema: "companion.manifest.v1",
      screenId: "button-preview",
      viewport: "desktop",
      criteria: [
        {
          id: "CRIT-MECH-APCA",
          pillar: "mechanical",
          name: "APCA Contrast",
          passed: true,
          details: "Contrast ratios adhere to web accessibility standards.",
          evidence: "Verified that text contrast appears distinct and legible over background.", // No metrics
        },
        {
          id: "CRIT-COGN-STATES",
          pillar: "cognitive",
          name: "UI States FSM",
          passed: true,
          details: "State machine transitions between hover and active states without glitches.",
          evidence: "All states transition smoothly when clicked or hovered.", // No metrics
        },
        {
          id: "CRIT-PROD-GEIST-TOKENS",
          pillar: "product",
          name: "Geist Tokens",
          passed: true,
          details: "Design system tokens are used consistently across components.",
          evidence: "Validated tokens for typography and colors across all widgets.", // No metrics
        },
        {
          id: "CRIT-UX-STATE-LAYERS",
          pillar: "ux",
          name: "State Layers",
          passed: true,
          details: "Interactive layer opacity responds to user touch and focus state changes.",
          evidence: "Opacity shifts visibly on hover and press events.", // No metrics
        },
      ],
    };

    const audit = runDualChannelAudit(
      "/mock/runRoot",
      dummyTask,
      validScreenshots,
      [noMetricsManifest],
      { requireSemanticDepth: true },
    );

    expect(audit.isUiTask).toBe(true);
    expect(audit.passed).toBe(false);
    expect(audit.mode).toBe("rejected");

    const refusal = dualChannelRefusalMessage(dummyTask.id, audit);
    expect(refusal).toContain("cannot pass task-01");
    expect(refusal).toContain("missing_evidence_metrics");
    expect(refusal).toContain("quantitative measurements");
  });

  it("passes audit when valid screenshots >= 1024 bytes and deeply evidenced 4-pillar companion manifests are present", () => {
    const deepManifest: CompanionManifestData = {
      schema: "companion.manifest.v1",
      screenId: "button-preview",
      viewport: "desktop",
      criteria: [
        {
          id: "CRIT-MECH-APCA",
          pillar: "mechanical",
          name: "APCA Contrast",
          passed: true,
          details: "Passes APCA Lc lightness contrast thresholds across all button variants.",
          evidence: "APCA Lc=78.4 exceeds threshold 60.0 on 25 inspected button nodes.",
        },
        {
          id: "CRIT-COGN-STATES",
          pillar: "cognitive",
          name: "UI States FSM",
          passed: true,
          details: "All UI interaction states (idle, hover, active, focus, disabled) implemented.",
          evidence: "5 distinct interactive states verified with 120ms animation transitions.",
        },
        {
          id: "CRIT-PROD-GEIST-TOKENS",
          pillar: "product",
          name: "Geist Tokens",
          passed: true,
          details: "Conforms to typography, spacing, and border-radius token scales.",
          evidence: "42 design tokens validated: 16px font-size, 8px padding, 4px radius.",
        },
        {
          id: "CRIT-UX-STATE-LAYERS",
          pillar: "ux",
          name: "State Layers",
          passed: true,
          details: "State layers calibrated against Material 3 state layer specifications.",
          evidence: "Hover opacity 0.08, active opacity 0.12 tested with 0 origin orphans.",
        },
      ],
    };

    const audit = runDualChannelAudit(
      "/mock/runRoot",
      dummyTask,
      validScreenshots,
      [deepManifest],
      { requireSemanticDepth: true },
    );
    expect(audit.isUiTask).toBe(true);
    expect(audit.passed).toBe(true);
    expect(audit.mode).toBe("screenshot_gap_filled");
    expect(
      audit.proofs.some((p) => p.verifiedInvariants.includes("manifest_4_pillars_certified")),
    ).toBe(true);
  });
});

describe("task:review CLI Command Dual-Channel & Semantic Depth Refusal Enforcement", () => {
  let testDir: string;
  let runRoot: string;

  const setupTestCapsule = async (): Promise<{
    runPath: string;
    taskId: string;
    validatorToken: string;
    checkId: string;
  }> => {
    testDir = join(
      tmpdir(),
      `test-task-review-dual-channel-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testDir, { recursive: true });
    execSync("git init -b main", { cwd: testDir });
    execSync("git config user.name 'Test Runner'", { cwd: testDir });
    execSync("git config user.email 'test@example.com'", { cwd: testDir });
    writeFileSync(join(testDir, "README.md"), "# Test\n");
    execSync("git add README.md && git commit -m 'initial commit'", { cwd: testDir });

    const promptBytes = new TextEncoder().encode("Test prompt for dual-channel validation");
    runRoot = initRun(testDir, "test-run", promptBytes, "file", true);

    const token = "mock-validation-token-12345678";
    const taskId = "task-ui-01";
    const digest = tokenDigest(token);

    transact(runRoot, "setup", "state-init", {}, (draft) => {
      draft.graph = {
        revision: 1,
        gates: [
          {
            id: "gate-01",
            command: ["echo", "validation-check-ok"],
            cwd: ".",
            scope: "task",
            mandatory: true,
            requirement_ids: ["REQ-01"],
          },
        ],
      };
      draft.gate_proofs = [
        {
          task_id: taskId,
          gate_argv: ["echo", "validation-check-ok"],
          write_scope: ["src/components/Card.tsx"],
          base: "HEAD",
          falsifiable: true,
          exit_code: 1,
          timed_out: false,
          proved_at: new Date().toISOString(),
          actor: "val-01",
        },
      ];
      draft.requirements = {
        requirements: [
          {
            id: "REQ-01",
            statement: "Component renders card",
            disposition: "actionable",
            status: "planned",
            evidence: [],
          },
        ],
      };
      draft.commands = {};
      draft.tasks = {
        [taskId]: {
          id: taskId,
          label: "Build accessible UI card component",
          lane: 0,
          requirement_ids: ["REQ-01"],
          dependencies: [],
          write_scope: ["src/components/Card.tsx"],
          acceptance: [{ id: "acc-01", statement: "Renders card" }],
          status: "validating",
          validation_token: token,
          validations: [
            {
              validator_id: "val-01",
              domain: "ui-design",
              token_digest: digest,
              attempt: 1,
              started_at: new Date().toISOString(),
              deadline_at: new Date(Date.now() + 10_000_000).toISOString(),
            },
          ],
          attempts: [
            {
              attempt: 1,
              role: "implementer",
              agent_id: "worker-01",
              started_at: new Date().toISOString(),
              status: "submitted",
            },
          ],
          history: [],
          repair_round: 0,
          probe_round: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      };
      return draft;
    });

    await publishTaskRolePacket({
      runRoot,
      port: workflowPort(runRoot),
      role: "validator",
      agentId: "val-01",
      attempt: 1,
      token,
      taskId,
      validatorDomain: "ui-design",
    });

    const cmdResult = await runAndRecordCommand(runRoot, {
      actor: "val-01",
      argv: ["echo", "validation-check-ok"],
      cwd: testDir,
      commandDir: join(runRoot, "commands"),
      taskId,
      gateId: "gate-01",
    });
    const checkId = cmdResult.record.id;

    // Create valid screenshots and ingest them cleanly into capsule
    const screenshotsDir = join(testDir, "screenshots");
    mkdirSync(screenshotsDir, { recursive: true });
    const p1 = join(screenshotsDir, "card-desktop.png");
    const p2 = join(screenshotsDir, "card-tablet.png");
    const p3 = join(screenshotsDir, "card-mobile.png");
    writeFileSync(p1, Buffer.alloc(2048, 1));
    writeFileSync(p2, Buffer.alloc(1536, 2));
    writeFileSync(p3, Buffer.alloc(1200, 3));

    ingestScreenshots({
      runRoot,
      taskId,
      actor: "val-01",
      searchDirs: [screenshotsDir],
      explicitPaths: [p1, p2, p3],
    });

    return {
      runPath: runRoot,
      taskId,
      validatorToken: token,
      checkId,
    };
  };

  const cleanupTestCapsule = (): void => {
    if (testDir) {
      try {
        rmSync(testDir, { recursive: true, force: true });
      } catch {}
    }
  };

  it("taskReviewCommand throws HarnessError and refuses pass when companion manifest is shallow under --require-semantic-depth", async () => {
    const { runPath, taskId, validatorToken, checkId } = await setupTestCapsule();
    try {
      // Write a shallow companion manifest to captures directory
      const capturesDir = join(runPath, "captures");
      mkdirSync(capturesDir, { recursive: true });

      const shallowManifest = {
        schema: "companion.manifest.v1",
        screenId: "card-preview",
        viewport: "desktop",
        criteria: [
          {
            id: "CRIT-MECH-APCA",
            pillar: "mechanical",
            passed: true,
            details: "ok",
            evidence: "pass",
          },
          {
            id: "CRIT-COGN-STATES",
            pillar: "cognitive",
            passed: true,
            details: "ok",
            evidence: "pass",
          },
          {
            id: "CRIT-PROD-TOKENS",
            pillar: "product",
            passed: true,
            details: "ok",
            evidence: "pass",
          },
          { id: "CRIT-UX-FOCUS", pillar: "ux", passed: true, details: "ok", evidence: "pass" },
        ],
      };
      writeFileSync(
        join(capturesDir, "card-desktop.manifest.json"),
        JSON.stringify(shallowManifest, null, 2),
      );

      let threw = false;
      try {
        await taskReviewCommand({
          run: runPath,
          task: taskId,
          validator: "val-01",
          token: validatorToken,
          status: "pass",
          checks: checkId,
          summary: "All validation checks pass",
          "require-semantic-depth": true,
        });
      } catch (error) {
        threw = true;
        expect(error instanceof HarnessError).toBe(true);
        const harnessErr = error as HarnessError;
        expect(harnessErr.code).toBe("INVALID_STATE");
        expect(harnessErr.message).toContain(`cannot pass ${taskId}`);
        expect(harnessErr.message).toContain("boilerplate_evidence");
      }
      expect(threw).toBe(true);
    } finally {
      cleanupTestCapsule();
    }
  });

  it("taskReviewCommand passes and records review when companion manifest contains deep quantitative evidence under --require-semantic-depth", async () => {
    const { runPath, taskId, validatorToken, checkId } = await setupTestCapsule();
    try {
      // Write a deep companion manifest to captures directory
      const capturesDir = join(runPath, "captures");
      mkdirSync(capturesDir, { recursive: true });

      const deepManifest = {
        schema: "companion.manifest.v1",
        screenId: "card-preview",
        viewport: "desktop",
        criteria: [
          {
            id: "CRIT-MECH-APCA",
            pillar: "mechanical",
            name: "APCA Contrast",
            passed: true,
            details: "All text elements meet APCA Lc lightness contrast thresholds.",
            evidence: "APCA Lc=78.4 exceeds threshold 60.0 across 25 inspected text nodes.",
          },
          {
            id: "CRIT-COGN-STATES",
            pillar: "cognitive",
            name: "UI States FSM",
            passed: true,
            details:
              "All UI interaction states (idle, hover, active, focus, disabled) implemented.",
            evidence: "5 distinct interactive states verified with 120ms animation transitions.",
          },
          {
            id: "CRIT-PROD-TOKENS",
            pillar: "product",
            name: "Geist Tokens",
            passed: true,
            details: "Conforms to typography, spacing, and border-radius token scales.",
            evidence: "42 design tokens validated: 16px font-size, 8px padding, 4px radius.",
          },
          {
            id: "CRIT-UX-FOCUS",
            pillar: "ux",
            name: "WAI-ARIA Focus Trap",
            passed: true,
            details: "Modal and dialog containers constrain tab cycle traversal.",
            evidence: "0 overflow across 390x844 canvas with 4 focusable elements trapped.",
          },
        ],
      };
      writeFileSync(
        join(capturesDir, "card-desktop.manifest.json"),
        JSON.stringify(deepManifest, null, 2),
      );

      const reviewResult = await taskReviewCommand({
        run: runPath,
        task: taskId,
        validator: "val-01",
        token: validatorToken,
        status: "pass",
        checks: checkId,
        summary: "All validation checks pass with deep evidence",
        "require-semantic-depth": true,
      });

      expect(reviewResult).toBeDefined();
      expect(reviewResult.verdict).toBe("pass");
      const audit = reviewResult.dual_channel_audit as { passed: boolean; mode: string };
      expect(audit.passed).toBe(true);
      expect(audit.mode).toBe("screenshot_gap_filled");
    } finally {
      cleanupTestCapsule();
    }
  });

  it("preserves backward compatibility: taskReviewCommand passes shallow manifest when --require-semantic-depth is omitted", async () => {
    const { runPath, taskId, validatorToken, checkId } = await setupTestCapsule();
    try {
      const capturesDir = join(runPath, "captures");
      mkdirSync(capturesDir, { recursive: true });

      const shallowManifest = {
        schema: "companion.manifest.v1",
        screenId: "card-preview",
        viewport: "desktop",
        criteria: [
          {
            id: "CRIT-MECH-APCA",
            pillar: "mechanical",
            passed: true,
            details: "Valid",
            evidence: "Tested",
          },
          {
            id: "CRIT-COGN-STATES",
            pillar: "cognitive",
            passed: true,
            details: "Valid",
            evidence: "Tested",
          },
          {
            id: "CRIT-PROD-TOKENS",
            pillar: "product",
            passed: true,
            details: "Valid",
            evidence: "Tested",
          },
          { id: "CRIT-UX-FOCUS", pillar: "ux", passed: true, details: "Valid", evidence: "Tested" },
        ],
      };
      writeFileSync(
        join(capturesDir, "card-desktop.manifest.json"),
        JSON.stringify(shallowManifest, null, 2),
      );

      const reviewResult = await taskReviewCommand({
        run: runPath,
        task: taskId,
        validator: "val-01",
        token: validatorToken,
        status: "pass",
        checks: checkId,
        summary: "All validation checks pass",
      });

      expect(reviewResult).toBeDefined();
      expect(reviewResult.verdict).toBe("pass");
    } finally {
      cleanupTestCapsule();
    }
  });
});

describe("Static Invariant Verification: Zero TypeScript any & Zero Suppressions", () => {
  it("verifies task review dual channel test and support files contain zero any and zero suppressions", () => {
    const filesToAudit = [
      "/Users/onurseckinsenoglu/repos/skills/orchestrating-long-tasks/scripts/src/cli/commands/task-review-support.ts",
      "/Users/onurseckinsenoglu/repos/skills/orchestrating-long-tasks/scripts/src/cli/commands/task-review.ts",
      "/Users/onurseckinsenoglu/repos/skills/orchestrating-long-tasks/scripts/src/cli/commands/task-review-dual-channel.test.ts",
    ];

    const anyPattern = /:\s*any\b|as\s+any\b|<any>/;
    const suppressionPattern =
      /@ts-ignore|@ts-expect-error|@ts-nocheck|eslint-disable|oxlint-disable/;

    for (const filePath of filesToAudit) {
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        // Skip comment lines in invariant check itself
        if (line.includes("anyPattern") || line.includes("suppressionPattern")) continue;

        expect(anyPattern.test(line)).toBe(false);
        expect(suppressionPattern.test(line)).toBe(false);
      }
    }
  });
});
