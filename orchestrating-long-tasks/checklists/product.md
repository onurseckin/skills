# Product value checklist
Domain: product

Judges whether a change delivers the user-visible value the prompt actually asked for, whether the
resulting flow is coherent, and whether every state a real user hits — not just the happy path — is
handled as a product, not merely as code that compiles. Drawn whenever a task changes user-facing
behaviour, copy, or a flow's shape.

## PROD-FLOW-001

rule: The change is verified from the entry point a real user would use, not only from the internal function or API that implements it
rationale: A correct implementation reachable only through a test harness delivers no value to an actual user until the entry point is confirmed too
how-to-check: Trace the path from the actual UI action, CLI invocation, or API call a user makes through to the changed code
severity: important
sources:
  - Shape Up (Ryan Singer), "Hill Charts" — chapter on defining done by the user-facing outcome

## PROD-FLOW-002

rule: A multi-step flow leaves the user able to go back, correct an earlier answer, or abandon cleanly, without losing unrelated progress
rationale: A flow that only moves forward punishes an ordinary mistake with a full restart
how-to-check: Walk the flow forward, then attempt to go back one step and change an earlier input; confirm later, unrelated state survives
severity: important
sources:
  - Nielsen Norman Group, "User Control and Freedom" (Usability Heuristic #3)

## PROD-VALUE-001

rule: The delivered change matches what the requester actually asked for, including scope — not a superset that changes unrelated behaviour, nor a subset that leaves the ask half-done
rationale: Both over-delivery and under-delivery break trust in what "done" means for the next request
how-to-check: Re-read the original ask sentence by sentence against the diff; each clause should map to a specific change, with nothing extra unaccounted for
severity: critical
sources:
  - This repository's own worked example (B12.1): checking only the stated task is necessary but not sufficient

## PROD-VALUE-002

rule: A change that removes or hides a capability confirms nothing else in the product still depends on it
rationale: A capability that looks unused from the removal site alone can still be relied on by a report, an integration, or a downstream automation
how-to-check: Grep the wider codebase and any generated exports/APIs for references to the removed capability before treating removal as safe
severity: important
sources:
  - This repository's B33 (wire vs delete) — the same discipline applies to product-level capabilities

## PROD-STATE-001

rule: Empty state (zero data, first use) explains what the user is looking at and what to do next, rather than showing a bare blank area
rationale: An unexplained blank screen reads as broken, not as "nothing here yet"
how-to-check: Force the zero-data condition and read the resulting screen as a first-time user would
severity: minor
sources:
  - Nielsen Norman Group, "Empty States" guidance

## PROD-STATE-002

rule: A partial failure (some items loaded, some failed; some steps succeeded, some did not) reports precisely what succeeded and what did not, rather than a single all-or-nothing status
rationale: A blanket failure message on a partial success hides real progress and can cause a user to needlessly retry a completed step
how-to-check: Force a partial failure (e.g. one of several parallel requests erroring) and confirm the UI attributes success/failure per item
severity: important
sources:
  - Nielsen Norman Group, "Visibility of System Status" (Usability Heuristic #1)

## PROD-COPY-001

rule: User-facing copy uses the vocabulary the user already has, not internal system, code, or database terminology
rationale: A user-facing error naming an internal entity ("Foo record constraint violated") gives the user nothing they can act on
how-to-check: Read every new or changed user-facing string for internal type names, error codes, or implementation vocabulary
severity: minor
sources:
  - Nielsen Norman Group, "Match Between System and the Real World" (Usability Heuristic #2)

## PROD-COPY-002

rule: An error message tells the user what happened, why (if known), and what they can do about it — not just that something failed
rationale: "Something went wrong" gives the user no path forward and generates a support request for information the system already had
how-to-check: Read every new error string against the three parts: what, why, next step
severity: important
sources:
  - Nielsen Norman Group, "Help Users Recognize, Diagnose, and Recover from Errors" (Usability Heuristic #9)

## PROD-EDGE-001

rule: The change is checked against the boundary conditions of its own domain: the first item, the last item, zero items, and the maximum the system allows
rationale: Boundary conditions are where off-by-one and truncation defects live, and they are cheap to check directly
how-to-check: Exercise the changed flow with zero, one, and the stated maximum number of the relevant entity
severity: important
sources:
  - The Pragmatic Programmer, "Programming by Coincidence" — boundary-condition testing

## PROD-EDGE-002

rule: A change to a shared flow is checked against an existing user's current data and state, not only against a fresh account or fixture
rationale: A flow that only works for a freshly seeded fixture regularly breaks against the messier shape real accumulated data takes
how-to-check: Run the changed flow against a representative existing dataset or account state, not only the test fixture
severity: important
sources:
  - Continuous Delivery (Humble & Farley) — backward-compatibility testing against production-shaped data

## PROD-CONSIST-001

rule: A new flow follows the same interaction pattern (confirmation style, terminology, ordering of actions) as existing comparable flows in the product, unless the difference is deliberate and stated
rationale: An unannounced inconsistency forces the user to relearn a pattern they already knew from elsewhere in the same product
how-to-check: Compare the new flow's key interactions against the nearest existing comparable flow
severity: minor
sources:
  - Nielsen Norman Group, "Consistency and Standards" (Usability Heuristic #4)

## PROD-CONSIST-002

rule: A change to a shared component's behaviour is checked against every other place that component is used, not only the screen the task named
rationale: A shared component changed for one caller's benefit can silently break the assumptions of every other caller
how-to-check: Grep for other usages of the touched shared component and confirm none of them relied on the changed behaviour
severity: important
sources:
  - This repository's own worked example (B12.1) — a change's effects extend past the task's stated target

## PROD-ONBOARD-001

rule: A new feature a returning user has not seen before is discoverable without requiring release notes or tribal knowledge
rationale: A feature only the author knows exists delivers value to nobody until it is found
how-to-check: Without prior knowledge of the change, attempt to find and use the new capability from the product's normal navigation
severity: minor
sources:
  - Nielsen Norman Group, "Recognition Rather than Recall" (Usability Heuristic #6)

## PROD-SCOPE-001

rule: A change behind a flag, experiment, or partial rollout is checked in both the on and off state, and the off state matches prior behaviour exactly
rationale: An incomplete flag implementation is a shipped bug waiting for the flag to flip, and the off-state regression is the one nobody tests
how-to-check: Exercise the flow with the flag both enabled and disabled; diff the disabled-state behaviour against the pre-change baseline
severity: important
sources:
  - Continuous Delivery (Humble & Farley) — feature-flag testing discipline

## PROD-SCOPE-002

rule: A change's rollback path is at least as safe as its rollout path: reverting the code does not strand data or state in a shape the old code cannot read
rationale: A rollout that is easy to ship but impossible to cleanly revert converts every incident into a forward-only fix under pressure
how-to-check: Confirm what the previous version of the code would do if pointed at data or state the new version produced
severity: important
sources:
  - Google SRE Workbook, "Change Management" — safe rollback as a release requirement

## PROD-FEEDBACK-001

rule: An action that takes longer than roughly one second gives the user a visible acknowledgment (spinner, progress, disabled state) rather than silence
rationale: Silence after an action reads as "nothing happened" and invites a duplicate submission
how-to-check: Trigger the action under a throttled or slow-network condition and observe whether feedback appears before the result does
severity: minor
sources:
  - Nielsen Norman Group, "Visibility of System Status" (Usability Heuristic #1); Jakob Nielsen's response-time limits (0.1/1/10 second thresholds)
