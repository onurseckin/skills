export type {
  ApcaBadgeInfo,
  ApcaContrastCompliance,
  AuditedDefect,
  DefectAuditCommandResult,
  DefectAuditSummary,
  DefectFileDiscovery,
  DefectStatus,
  RGBColor,
} from "./types.ts";

export {
  calculateApcaLightnessContrast,
  getApcaBadgeInfo,
  renderApcaContrastBadge,
  renderAsciiDefectTable,
} from "./apca.ts";

export { discoverDefectFiles, parseDefectsFromFile } from "./discovery.ts";

export { formatDefectAuditReport } from "./formatter.ts";

export { defectAuditCommand } from "./command.ts";
