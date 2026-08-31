import { describe, expect, it } from "bun:test";
import {
  AntigravityCollector,
  ClaudeCollector,
  CodexCollector,
  CursorCollector,
  type CollectorEnvironment,
} from "../../../olt/scripts/src/telemetry/collectors/index.ts";

describe("Collector External Cache Isolation", () => {
  it("isolates Claude storage cache when active host is Antigravity", async () => {
    const env: CollectorEnvironment = {
      activeHost: "antigravity",
      exec: async () => null,
      readFile: async (p) => {
        if (p.endsWith(".claude.json")) {
          return JSON.stringify({
            remainingPercentage: 0,
            cachedUsageUtilization: {
              utilization: {
                five_hour: { utilization: 100 },
              },
            },
          });
        }
        return null;
      },
    };

    const collector = new ClaudeCollector(env);
    const res = await collector.probe();

    expect(res.isDetected).toBe(true);
    expect(res.primaryTierUsed).toBe("tier2_local_storage");
    expect(res.reason).toContain("Isolated External Cache");
    expect(res.metrics[0]?.remainingPercentage).toBe(0);
  });

  it("isolates Codex storage cache when active host is Claude Code", async () => {
    const env: CollectorEnvironment = {
      activeHost: "claude_code",
      exec: async () => null,
      readFile: async (p) => {
        if (p.endsWith("usage.json") || p.endsWith("session.json")) {
          return JSON.stringify({ remainingPercentage: 10 });
        }
        return null;
      },
    };

    const collector = new CodexCollector(env);
    const res = await collector.probe();

    expect(res.isDetected).toBe(true);
    expect(res.primaryTierUsed).toBe("tier2_local_storage");
    expect(res.reason).toContain("Isolated External Cache");
  });

  it("isolates Cursor storage cache when active host is Codex", async () => {
    const env: CollectorEnvironment = {
      activeHost: "codex",
      exec: async () => null,
      readFile: async (p) => {
        if (p.endsWith("storage.json") || p.endsWith("state.json")) {
          return JSON.stringify({ remainingPercentage: 5 });
        }
        return null;
      },
    };

    const collector = new CursorCollector(env);
    const res = await collector.probe();

    expect(res.isDetected).toBe(true);
    expect(res.primaryTierUsed).toBe("tier2_local_storage");
    expect(res.reason).toContain("Isolated External Cache");
  });

  it("enriches active model in Antigravity collector when activeModel is configured", async () => {
    const env: CollectorEnvironment = {
      activeHost: "antigravity",
      activeModel: "gemini-3.7-flash-high",
      exec: async (cmd) => {
        if (cmd === "lsof") {
          return {
            stdout: "agy 100 1u IPv4 0x1 0t0 TCP 127.0.0.1:4000 (LISTEN)\n",
            stderr: "",
            exitCode: 0,
          };
        }
        return null;
      },
      fetchUserStatus: async () => ({
        userStatus: {
          quotaInfo: { remainingFraction: 0.9 },
          cascadeModelConfigData: {
            clientModelConfigs: [
              {
                label: "Gemini 3.7 Flash (High)",
                modelId: "gemini-3.7-flash-high",
                quotaInfo: { remainingFraction: 0.85 },
              },
              {
                label: "Claude Sonnet 4.6",
                modelId: "claude-sonnet-4.6",
                quotaInfo: { remainingFraction: 0.4 },
              },
            ],
          },
        },
      }),
    };

    const collector = new AntigravityCollector(env);
    const res = await collector.probe();

    expect(res.isDetected).toBe(true);
    expect(res.rawObservations.name).toBe("gemini-3.7-flash-high");
    const activeMetric = res.metrics.find((m) => m.rawMetricName === "Gemini 3.7 Flash (High)");
    expect((activeMetric?.rawPayload as Record<string, unknown>).name).toBe(
      "gemini-3.7-flash-high",
    );
  });
});
