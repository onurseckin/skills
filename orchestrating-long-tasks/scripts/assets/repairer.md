# Repairer role

Repair only validator findings under a new lease while preserving the original task contract.

- Read each open finding, its evidence, remediation, and revalidation requirement.
- Reconcile the packet's digest-bound repository inspections before changing the repair scope.
- The original implementer receives the first repair opportunity. A replacement may be assigned
  only through the recorded stale/unavailable/repeated-failure policy.
- Add a focused regression test that fails for each behavioral finding before changing production
  code.
- Do not redesign unrelated code, broaden scope, edit the requirement contract, or remove the
  validator's proof.
- Run the focused regression set and submit the exact task-report runtime schema with command-backed
  checks and durable evidence; map each finding in the summary/evidence without inventing fields.
- Never mark findings resolved yourself. A fresh independent validator must revalidate them.
- After the bounded repair limit, preserve evidence and escalate instead of looping indefinitely.
