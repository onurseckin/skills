import { existsSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import type { AgentGrantRecord, JsonValue } from "../../core/contracts/index.ts";
import { atomicWriteJson } from "../../core/durable-write.ts";
import { readRegularFileNoFollow } from "../../core/no-follow.ts";
import { HarnessError } from "../../core/errors/index.ts";
import {
  DEFAULT_MIND_BUDGET,
  parseCharter,
  type ParsedCharter,
} from "../../mind/lifecycle/charter/index.ts";
import { bootstrapRepoGovernance, type RepoGovernanceStatus } from "../../mind/governance/index.ts";
import { initRun, loadRun, transact } from "../../engine/store/index.ts";
import { integerFlag, textFlag, type CommandContext, type Flags } from "../options.ts";
import { resolveCapsulesDir } from "../../core/shared/paths.ts";
import { PolicyDiscoveryEngine } from "../../engine/policy-discovery.ts";
import { writeAgentLedger } from "../../workflow/agents/ledger.ts";
import { formatMindInitBrief } from "./mind-init-brief.ts";

export type MindInitGovernanceStatus = RepoGovernanceStatus;

export interface MindInitResult {
  markdown: string;
  run_root: string;
  mind_id: string;
  generation: number;
  charter_sha256: string;
  charter: {
    source_path: string;
    goals: readonly string[];
    repo_roots: readonly string[];
  };
  manifest: unknown;
  governance: RepoGovernanceStatus;
}

export { formatMindInitBrief } from "./mind-init-brief.ts";
export { mindObserveCommand } from "./mind-observe.ts";
export { mindPulseCommand } from "./mind-pulse.ts";
export { mindPulseOpenCommand } from "./mind-pulse-open.ts";
export { mindQuiesceCommand } from "./mind-quiesce.ts";
export { mindRotateCommand } from "./mind-rotate.ts";
export { mindWakeCommand } from "./mind-wake.ts";
export { mindHaltCommand } from "./mind-halt.ts";
export { mindCandidateCommand } from "./mind-candidate.ts";
export { mindAdmitCommand, mindDeclineCommand } from "./mind-admit.ts";
export { mindEscalateCommand } from "./mind-escalate.ts";
export { mindRoundOpenCommand, mindRoundCloseCommand } from "./mind-round.ts";
export { mindAuditStartCommand, mindAuditReportCommand } from "./mind-audit.ts";
export { mindAuditLiveCommand } from "./mind-audit-live.ts";
export { mindInitCommand } from "./mind-init.ts";
