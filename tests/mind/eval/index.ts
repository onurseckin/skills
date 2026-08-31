/**
 * @file index.ts
 * Facade for Mind Eval domain
 */

export { EVAL_META_SUITES } from "./meta/index.ts";
export { EVAL_COGNITIVE_SUITES } from "./cognitive/index.ts";
export { EVAL_AUDITING_SUITES } from "./auditing/index.ts";
export { EVAL_SCANNER_SUITES } from "./scanner/index.ts";

export const EVAL_DOMAINS = [
  "meta",
  "cognitive",
  "auditing",
  "scanner",
] as const;
