import { describe, it, expect, mock, beforeEach } from "bun:test";
import { taskClaimCommand } from "../../../src/cli/commands/task-claim.ts";

// Mocking dependencies is tricky with bun:test without module mocks, so I'll patch the real imports or just mock the required parts.
// Actually, since I'm modifying `task-claim.ts`, I can just check if `formatExactAnchorBriefingMarkdown` output is included.
// But wait, the task requires `taskClaimCommand` to return markdown.
// To avoid `bun test` module mock issues, let me use `mock.module` from `bun:test` if possible.

// But for simplicity, I can just write a test that verifies the output contains the exact-anchor briefing if we pass fake parameters to taskClaimCommand.

import * as storePorts from "../../../src/integration/store-ports.ts";
import * as claimModule from "../../../src/workflow/lease/claim.ts";
import * as roleGrant from "../../../src/packets/role-grant.ts";
import * as paths from "../../../src/core/shared/paths.ts";
import * as hostTelemetryProbe from "../../../src/cli/host-telemetry-probe.ts";
import * as paths2 from "../../../src/engine/store/index.ts";

mock.module("../../../src/integration/store-ports.ts", () => ({
  workflowPort: () => ({
    read: () => ({
      tasks: {
        "task-1": {
          id: "task-1",
          label: "Test Task",
          write_scope: ["some-file.ts"],
        },
      },
    }),
  }),
}));

mock.module("../../../src/workflow/lease/claim.ts", () => ({
  claimTask: () => ({
    token: "test-token",
    state: {
      tasks: {
        "task-1": {
          id: "task-1",
          label: "Test Task",
          write_scope: ["some-file.ts"],
          lease: {
            attempt: 1,
            duration_seconds: 3600,
            expires_at: "2026-08-23T19:00:00Z",
          },
        },
      },
    },
  }),
}));

mock.module("../../../src/packets/role-grant.ts", () => ({
  publishTaskRolePacket: async () => ({
    record: { id: "packet-1" },
    markdownPath: "/test/path.md",
    packet: { metadata: { role_contract_sha256: "sha256" } },
  }),
}));

mock.module("../../../src/cli/host-telemetry-probe.ts", () => ({
  probeAgentTelemetry: () => ({}),
  withHostTelemetryConflicts: (data: any, conflicts: any) => data,
}));

mock.module("../../../src/engine/store/index.ts", () => ({
  loadRun: () => ({
    state: {},
  }),
}));

describe("taskClaimCommand exact-anchor briefing injection", () => {
  it("injects exact-anchor briefing into the markdown output", async () => {
    const result = await taskClaimCommand(
      {
        run: "/test/run",
        task: "task-1",
        agent: "implementer_task-1",
        role: "implementer",
      } as any,
      {
        repositoryGitCommand: () => ({ status: 0, bytes: Buffer.from("fake-sha") }) as any,
      },
    );

    expect(result.markdown).toContain("### 🌌 Zero-Exploration Exact-Anchor Briefing");
  });
});
