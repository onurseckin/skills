/**
 * Dedicated Test Suite for Epistemic Supersession Index.
 *
 * Covers:
 * 1. Epistemic Status transitions & type guards (ACTIVE, SUPERSEDED, DEPRECATED).
 * 2. Directed lineage graph traversal (getSuccessorLineage, getTerminalSuccessor).
 * 3. Transitive chains (A -> B -> C -> Bedrock Invariant).
 * 4. Cycle detection & acyclicity validation (validateLineageAcyclicity, cycle path reporting, self-referencing nodes).
 * 5. Obsolete state checks (isObsolete).
 * 6. State export/import and JSON roundtrips.
 */

import { describe, expect, it } from "bun:test";
import {
  EPISTEMIC_STATUSES,
  isEpistemicStatus,
  type EpistemicStatus,
  type RegisterSupersessionNodeOptions,
  type SupersessionIndexState,
  type SupersessionNode,
  SupersessionIndex,
} from "../../../olt/scripts/src/mind/memory/index.ts";


