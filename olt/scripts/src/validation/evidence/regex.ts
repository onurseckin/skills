export const IGNITION_REGEX =
  /(?:ignition\s+(?:is\s+|was\s+)?complete|ignited\s+(?:successfully|pipeline|system)|pipeline\s+ignition\s+done|ignition\s+stage\s+complete|milestone:\s*ignition)/i;
export const INVARIANT_REGEX =
  /(?:invariants?\s+(?:were\s+|are\s+|was\s+)?(?:enforced|verified|satisfied|checked|asserted)|invariant\s+enforcement\s+passed|zero\s+violations\s+enforced)/i;
export const EXECUTION_REGEX =
  /(?:ran\s+command|executed\s+`([^`]+)`|command\s+execution\s+(?:complete|succeeded)|(\d+)\s+commands?\s+executed|executed\s+(\d+)\s+commands?)/i;
export const COMPLETION_REGEX =
  /(?:task\s+(?:is\s+|was\s+)?completed?|execution\s+finished|workflow\s+complete|milestone:\s*completion)/i;
export const TEST_PASS_REGEX =
  /(?:all\s+tests?\s+pass(?:ed|ing)?|100%\s+test\s+pass|(\d+)\s+tests?\s+passed|tests?:\s*pass)/i;
