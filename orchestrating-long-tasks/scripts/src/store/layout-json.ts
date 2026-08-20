import { isRecord } from "../requirements/predicates.ts";

/**
 * The generic JSON primitives the layout checks share. `state.json` is read independently and
 * tolerantly here (see `readState` in `layout-integrity.ts`) rather than through the typed
 * `WorkflowState` in `workflow/types.ts` — `store/` never depends on `workflow/`, so these checks
 * treat the packets, commands and tasks maps as plain, untrusted JSON and extract only the fields
 * each check needs. `isRecord` is re-exported from `requirements/predicates.ts` rather than
 * redeclared, since a plain object guard is the same fact everywhere it is checked.
 */
export type JsonRecord = Record<string, unknown>;

export { isRecord };

export function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
