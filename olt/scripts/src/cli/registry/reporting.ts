import type { CommandSpec } from "./types.ts";
import { CORE_REPORT_SPECS } from "../commands/reporting/specs.ts";
import { SERVICE_REPORT_SPECS } from "../commands/reporting/service-specs.ts";
import { reportDagCommand } from "../commands/reporting/report-dag.ts";
import { reportUnifiedCommand } from "../commands/reporting/report-unified.ts";

export { reportDagCommand, reportUnifiedCommand };

export const REPORTING_COMMANDS: readonly CommandSpec[] = [
  ...CORE_REPORT_SPECS,
  ...SERVICE_REPORT_SPECS,
];
