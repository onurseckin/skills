import type { CommandSpec } from "./types.ts";
import {
  CORE_REPORT_SPECS,
  SERVICE_REPORT_SPECS,
  reportDagCommand,
  reportUnifiedCommand,
} from "../commands/reporting/index.ts";
import {
  reportDecisionsCommand,
  reportGraphCommand,
  reportGraphJsonCommand,
  reportHealthCommand,
  reportLeasesCommand,
} from "../commands/unified-reporting.ts";
import { summaryViewCommand } from "../commands/summary-ops.ts";
import { reportGetCommand } from "../commands/inspection-ops.ts";
import { streamEventsCommand } from "../commands/stream-events.ts";
import { exportGraphJsonCommand } from "../commands/graph-export.ts";
import { dagViewCommand } from "../commands/dag-view.ts";
import { dagRenderCommand, dagTraceCommand } from "../commands/dag.ts";
import { usageReportCommand } from "../commands/usage-report.ts";
import { quotaCheckCommand } from "../commands/quota-check.ts";
import { quotaFreezeCommand } from "../commands/quota-freeze.ts";
import { quotaResumeCommand } from "../commands/quota-resume.ts";
import { skillAuditLiveCommand } from "../commands/skill-audit-live.ts";
import { notifyPhaseCommand, notifyTestCommand } from "../commands/notify-ops.ts";

export {
  reportUnifiedCommand,
  reportDagCommand,
  reportGraphCommand,
  reportGraphJsonCommand,
  reportHealthCommand,
  reportLeasesCommand,
  reportDecisionsCommand,
  summaryViewCommand,
  reportGetCommand,
  streamEventsCommand,
  exportGraphJsonCommand,
  dagViewCommand,
  dagRenderCommand,
  dagTraceCommand,
  usageReportCommand,
  quotaCheckCommand,
  quotaFreezeCommand,
  quotaResumeCommand,
  skillAuditLiveCommand,
  notifyPhaseCommand,
  notifyTestCommand,
};

export const REPORTING_COMMANDS: readonly CommandSpec[] = [
  ...CORE_REPORT_SPECS,
  ...SERVICE_REPORT_SPECS,
];
