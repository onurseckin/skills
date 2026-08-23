import {
  blunderAuditCommand,
  calculateApcaLightnessContrast,
  discoverBlunderFiles,
  formatBlunderAuditReport,
  getApcaBadgeInfo,
  renderApcaContrastBadge,
  renderAsciiBlunderTable,
  type ApcaBadgeInfo,
  type ApcaContrastCompliance,
  type AuditedBlunder,
  type BlunderAuditCommandResult,
  type BlunderAuditSummary,
  type BlunderStatus,
  type RGBColor,
} from "../cli/commands/blunder-audit.ts";
import type { CommandContext, Flags } from "../cli/options.ts";

export {
  blunderAuditCommand,
  calculateApcaLightnessContrast,
  discoverBlunderFiles,
  formatBlunderAuditReport,
  getApcaBadgeInfo,
  renderApcaContrastBadge,
  renderAsciiBlunderTable,
  type ApcaBadgeInfo,
  type ApcaContrastCompliance,
  type AuditedBlunder,
  type BlunderAuditCommandResult,
  type BlunderAuditSummary,
  type BlunderStatus,
  type RGBColor,
};

export function executeBlunderAudit(
  flags: Flags,
  context?: CommandContext,
): BlunderAuditCommandResult {
  return blunderAuditCommand(flags, context);
}
