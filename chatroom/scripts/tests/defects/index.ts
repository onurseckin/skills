export { cursorDefectTestsSuite } from "./cursor/index.ts";

export const defectTestsSuite = [
  "defect_D1_no_advance_without_confirmation",
  "defect_D2_stdout_write_is_not_delivery",
  "defect_D3_filter_cannot_discard",
  "defect_D4_cursor_is_per_reader",
  "defect_D5_cas_prevents_lost_update",
  "defect_D6_one_identity_path",
  "defect_D7_typo_cannot_misroute",
  "defect_D8_liveness_has_cli_surface",
  "defect_D9_every_flag_registered",
  "defect_D10_corruption_fails_closed",
] as const;
