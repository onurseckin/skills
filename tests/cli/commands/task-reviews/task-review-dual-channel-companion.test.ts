import { describe, expect, it, afterEach } from "bun:test";
import { execSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDualChannelAudit } from "../../../../olt/scripts/src/cli/commands/task-review-support.ts";
import { taskReviewCommand } from "../../../../olt/scripts/src/cli/commands/task-review.ts";
import { initRun, transact } from "../../../../olt/scripts/src/engine/store/index.ts";
import { ingestScreenshots } from "../../../../olt/scripts/src/reporting/screenshot-ingestion.ts";
import { tokenDigest } from "../../../../olt/scripts/src/workflow/lease/token.ts";
import { publishTaskRolePacket } from "../../../../olt/scripts/src/packets/role-grant.ts";
import { workflowPort } from "../../../../olt/scripts/src/integration/store-ports.ts";
import { runAndRecordCommand } from "../../../../olt/scripts/src/integration/record-command.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import type { TaskRecord } from "../../../../olt/scripts/src/workflow/types.ts";
import type { ScreenshotRecord } from "../../../../olt/scripts/src/reporting/screenshot-types.ts";
import type { CompanionManifestData } from "../../../../olt/scripts/src/validation/channels/index.ts";
import { createAgentMetadata, writeAgentMetadata } from "../../../../olt/scripts/src/runtime/index.ts";
import { createSyntheticPngBuffer } from "../../../../olt/scripts/src/capture/runners/live-capture-runner/index.ts";

const roots: string[] = [];
afterEach(() => {
  while (roots.length > 0) {
    const dir = roots.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function createValidScreenshotFixtures(label: string): ScreenshotRecord[] {
  const dir = mkdtempSync(join(tmpdir(), `dual-chan-${label}-`));
  roots.push(dir);
  const specs = [
    { name: "button-desktop.png", w: 1440, h: 900, bytes: 2048, sha: "sha-desktop" },
    { name: "button-tablet.png", w: 768, h: 1024, bytes: 1536, sha: "sha-tablet" },
    { name: "button-mobile.png", w: 390, h: 844, bytes: 1200, sha: "sha-mobile" },
  ];
  return specs.map(({ name, w, h, bytes, sha }) => {
    const path = join(dir, name);
    writeFileSync(path, createSyntheticPngBuffer(w, h, bytes));
    return {
      kind: "screenshot",
      name,
      path,
      sha256: sha,
      bytes,
      blob_path: `/mock/blobs/${sha}`,
      storage: "copy",
      original_path: path,
    };
  });
}

describe("Task Review Dual-Channel - Companion Manifests & Semantic Depth", () => {
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
  };

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
      createValidScreenshotFixtures("passes-audit-valid-screenshots"),
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

  const setupTestCapsule = async (): Promise<{
    runPath: string;
    taskId: string;
    validatorToken: string;
    checkId: string;
  }> => {
    const testDir = mkdtempSync(join(tmpdir(), "test-dual-chan-capsule-"));
    roots.push(testDir);
    execSync("git init -b main", { cwd: testDir });
    execSync("git config user.name 'Test Runner'", { cwd: testDir });
    execSync("git config user.email 'test@example.com'", { cwd: testDir });
    execSync("git config commit.gpgsign false", { cwd: testDir });
    writeFileSync(join(testDir, ".gitignore"), ".capsules/\n.olt/\nscreenshots/\n");
    writeFileSync(join(testDir, "README.md"), "# Test\n");
    execSync("git add .gitignore README.md && git commit -m 'initial commit'", { cwd: testDir });

    const promptBytes = new TextEncoder().encode("Test prompt for dual-channel validation");
    const runRoot = initRun(testDir, "test-run", promptBytes, "file", true);

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
          actor: "worker-01",
        },
      ];
      draft.requirements = [
        {
          id: "REQ-01",
          statement: "Component renders card",
          disposition: "actionable",
          status: "planned",
          evidence: [],
        },
      ];
      draft.gates = [
        {
          id: "gate-01",
          command: ["echo", "validation-check-ok"],
          cwd: ".",
          scope: "task",
          mandatory: true,
          requirement_ids: ["REQ-01"],
        },
      ];
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
              validator_id: "mech-01",
              domain: "code-quality",
              token_digest: "mech-digest",
              attempt: 2,
              started_at: new Date().toISOString(),
              deadline_at: new Date(Date.now() + 10_000_000).toISOString(),
              verdict: "pass",
            },
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
              submitted_at: new Date().toISOString(),
              status: "submitted",
            },
            {
              attempt: 2,
              role: "mechanic-validator",
              agent_id: "mech-01",
              started_at: new Date().toISOString(),
              submitted_at: new Date().toISOString(),
              status: "submitted",
            },
          ],
          report: {
            summary: "Implemented UI card component",
            files_changed: ["src/components/Card.tsx"],
          },
          history: [],
          repair_round: 0,
          probe_round: 5,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      };
      return draft;
    });

    for (const [agent_id, role] of [
      ["val-01", "validator"],
      ["mech-01", "mechanic-validator"],
      ["worker-01", "implementer"],
      ["critic-01", "critic"],
    ] as const) {
      writeAgentMetadata(createAgentMetadata({ agent_id, role, tier: 3 }), runRoot);
    }
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
      actor: "mech-01",
      argv: ["echo", "validation-check-ok"],
      cwd: testDir,
      commandDir: join(runRoot, "commands"),
      taskId,
      gateId: "gate-01",
    });
    const checkId = cmdResult.record.id;

    const screenshotsDir = join(testDir, "screenshots");
    mkdirSync(screenshotsDir, { recursive: true });
    const p1 = join(screenshotsDir, "card-desktop.png");
    const p2 = join(screenshotsDir, "card-tablet.png");
    const p3 = join(screenshotsDir, "card-mobile.png");
    writeFileSync(p1, createSyntheticPngBuffer(1440, 900, 2048));
    writeFileSync(p2, createSyntheticPngBuffer(768, 1024, 1536));
    writeFileSync(p3, createSyntheticPngBuffer(390, 844, 1200));

    ingestScreenshots({
      runRoot,
      taskId,
      actor: "worker-01",
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

  it("taskReviewCommand throws HarnessError and refuses pass when companion manifest is shallow under --require-semantic-depth", async () => {
    const { runPath, taskId, validatorToken, checkId } = await setupTestCapsule();
    const capturesDir = join(runPath, "captures");
    mkdirSync(capturesDir, { recursive: true });

    const shallowManifest = {
      schema: "companion.manifest.v1",
      screenId: "card-preview",
      viewport: "desktop",
      criteria: [
        { id: "CRIT-MECH-APCA", pillar: "mechanical", passed: true, details: "ok", evidence: "pass" },
        { id: "CRIT-COGN-STATES", pillar: "cognitive", passed: true, details: "ok", evidence: "pass" },
        { id: "CRIT-PROD-TOKENS", pillar: "product", passed: true, details: "ok", evidence: "pass" },
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
  }, 30_000);
});
