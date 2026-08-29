import { basename } from "node:path";
import type { JsonObject } from "../../../../core/contracts/index.ts";
import { loadRun, transact } from "../../../../engine/store/index.ts";
import { readAgentLedger } from "../../../../workflow/agents/ledger.ts";
import { releaseAgentGrant } from "../../../../workflow/agents/grants.ts";
import type { Clock } from "../../../../workflow/types.ts";
import type { Rung3Result } from "../types.ts";

export function executeRung3(params: {
  readonly liveRunRoots: readonly string[];
  readonly mindRunRoot: string;
  readonly actor: string;
  readonly nowMs: number;
  readonly grantIdleSeconds: number;
  readonly clock: Clock;
  readonly actionsTaken: string[];
}): Rung3Result {
  const { liveRunRoots, mindRunRoot, actor, nowMs, grantIdleSeconds, clock, actionsTaken } = params;
  const deadAgentsReleased: {
    runId: string;
    agentId: string;
    role: string;
    idleSeconds: number;
  }[] = [];

  const runsToCheckForAgents = [...liveRunRoots, mindRunRoot];

  for (const runPath of runsToCheckForAgents) {
    const runId = basename(runPath);
    try {
      const loadedRun = loadRun(runPath, false);
      const ledger = readAgentLedger(loadedRun.state);
      const activeGrants = ledger.filter((g) => g.status === "active");

      for (const grant of activeGrants) {
        const attributableEvents = loadedRun.events.filter(
          (e) =>
            e.actor === grant.id ||
            (typeof e.payload === "object" &&
              e.payload !== null &&
              ((e.payload as Record<string, unknown>).agent_id === grant.id ||
                (e.payload as Record<string, unknown>).validator_id === grant.id ||
                (e.payload as Record<string, unknown>).critic_id === grant.id)),
        );

        let latestActivityMs: number;
        if (attributableEvents.length > 0) {
          const timestamps = attributableEvents
            .map((e) => Date.parse(e.timestamp))
            .filter((t) => Number.isFinite(t));
          latestActivityMs =
            timestamps.length > 0 ? Math.max(...timestamps) : Date.parse(grant.granted_at);
        } else {
          latestActivityMs = Date.parse(grant.granted_at);
        }

        const idleSeconds = Math.max(0, Math.floor((nowMs - latestActivityMs) / 1000));
        if (idleSeconds > grantIdleSeconds) {
          transact(
            runPath,
            actor,
            "agent-released",
            {
              agent_id: grant.id,
              released_at: new Date(nowMs).toISOString(),
              reason: "presumed_dead",
            },
            (draft) => {
              const workingState = draft as Record<string, unknown>;
              const workingAgents = Array.isArray(workingState.agents)
                ? (workingState.agents as Record<string, unknown>[])
                : [];
              const agentIndex = workingAgents.findIndex((a) => a.id === grant.id);
              if (agentIndex >= 0) {
                workingAgents[agentIndex] = {
                  ...workingAgents[agentIndex],
                  status: "released",
                  released_at: new Date(nowMs).toISOString(),
                  release_reason: "presumed_dead",
                };
                workingState.agents = workingAgents as unknown as JsonObject[];
              }
            },
          );

          try {
            releaseAgentGrant({
              runRoot: runPath,
              agentId: grant.id,
              actor,
              reason: "presumed_dead",
            });
          } catch {
            // best-effort
          }

          deadAgentsReleased.push({
            runId,
            agentId: grant.id,
            role: grant.role,
            idleSeconds,
          });
          actionsTaken.push(
            `Rung 3: released presumed dead agent ${grant.id} (${grant.role}) in ${runId} (idle ${idleSeconds}s > ${grantIdleSeconds}s limit)`,
          );
        }
      }
    } catch {
      // ignore individual run agent check failure
    }
  }

  return { deadAgentsReleased };
}
