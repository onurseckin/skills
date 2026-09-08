import type { CommandSpec } from "./types.ts";
import { CORE_REPORT_SPECS } from "../commands/reporting/index.ts";
import { SERVICE_REPORT_SPECS } from "../commands/reporting/index.ts";
import { reportDagCommand } from "../commands/reporting/index.ts";
import { reportUnifiedCommand } from "../commands/reporting/index.ts";

export { reportDagCommand, reportUnifiedCommand };

export const REPORTING_COMMANDS: readonly CommandSpec[] = [
  ...CORE_REPORT_SPECS,
  ...SERVICE_REPORT_SPECS,
];
