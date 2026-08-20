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

## PROD-FLOW-003

rule: A multi-step flow shows the user's current position (step X of Y, a progress indicator) when the flow has more than two steps
rationale: An unbounded-feeling flow reads as longer than it is and increases abandonment before the user reaches value
how-to-check: Count the flow's steps; for three or more, confirm a position indicator is visible at each step
severity: minor
sources:
  - Nielsen Norman Group, "Progress Indicators Improve Perception of Wait Time"

## PROD-VALUE-003

rule: Every acceptance criterion stated in the task maps to a specific, identifiable change in the diff
rationale: A criterion with no corresponding change is either forgotten or was never actually delivered despite the task reading as complete
how-to-check: List each acceptance criterion from the task; for each, point to the exact file/line that satisfies it
severity: critical
sources:
  - This repository's own worked example (B12.1)

## PROD-STATE-003

rule: A loading state expected to take more than a couple of seconds shows progress or a time estimate rather than an indefinite spinner
rationale: An indefinite spinner past a few seconds reads as frozen, and a user cannot distinguish "still working" from "stuck"
how-to-check: Trigger the changed operation under a throttled condition and observe whether the wait state communicates progress past the two-second mark
severity: minor
sources:
  - Nielsen Norman Group, "Progress Indicators Improve Perception of Wait Time"

## PROD-COPY-003

rule: New user-facing copy matches the product's existing tone and voice, not a noticeably different register introduced for this one flow
rationale: A tone shift between screens reads as though two different products were stitched together
how-to-check: Compare the new copy's formality, person (first/second), and sentence length against copy in an adjacent, established screen
severity: minor
sources:
  - Nielsen Norman Group, "Consistency and Standards" (Usability Heuristic #4)

## PROD-EDGE-003

rule: A flow acting on a shared resource is checked for what happens when two users (or two tabs of the same user) act on it at the same time
rationale: A flow that assumes exclusive access silently corrupts state or loses one user's change the first time it is not exclusive
how-to-check: Open the changed flow in two sessions against the same resource and perform the action from both; confirm the result is coherent, not silently lost
severity: important
sources:
  - Designing Data-Intensive Applications (Martin Kleppmann), ch. 7 "Transactions"

## PROD-CONSIST-003

rule: The same concept is named with the same word everywhere it appears in user-facing copy — never "delete" in one place and "remove" in another for the identical action
rationale: Inconsistent terminology for one concept forces the user to verify two words mean the same thing instead of recognizing a pattern
how-to-check: Grep new and existing copy for near-synonym pairs (delete/remove, cancel/dismiss, edit/update) describing the same user action
severity: minor
sources:
  - Nielsen Norman Group, "Consistency and Standards" (Usability Heuristic #4)

## PROD-ONBOARD-002

rule: A permission or paywall gate explains why access is denied and what the user can do about it, not a bare blocked state
rationale: An unexplained block reads as a bug and drives a support request the copy could have prevented
how-to-check: Trigger the gated state as an unauthorized user and read the resulting message for a reason and a next step
severity: minor
sources:
  - Nielsen Norman Group, "Help Users Recognize, Diagnose, and Recover from Errors" (Usability Heuristic #9)

## PROD-FEEDBACK-002

rule: A successful action shows a confirmation distinguishable from doing nothing — the user can tell the action actually happened without having to re-check
rationale: An action with no visible confirmation is indistinguishable from a silent failure, and invites a duplicate attempt
how-to-check: Trigger the changed action and confirm a distinct, positive signal (toast, state change, updated count) appears
severity: minor
sources:
  - Nielsen Norman Group, "Visibility of System Status" (Usability Heuristic #1)

## PROD-A11Y-001

rule: The flow is completable start to finish using assistive technology (keyboard only, or a screen reader), not merely built from individually accessible components
rationale: Individually accessible components can still compose into a flow that traps or loses a keyboard/screen-reader user between steps
how-to-check: Walk the entire flow using only the keyboard (or a screen reader) from entry to completion, not spot-checking one screen
severity: important
sources:
  - WAI-ARIA Authoring Practices Guide — composite widget and flow testing

## PROD-PERM-001

rule: A user is never shown an action in the UI that their permissions do not allow them to complete
rationale: A visible-but-blocked action costs the user a wasted attempt and a confusing error, when it could simply not have been shown
how-to-check: View the changed screen as a lower-privileged user and check for an action that is visible but fails or is hidden only after the click
severity: minor
sources:
  - Nielsen Norman Group, "Match Between System and the Real World" (Usability Heuristic #2)

## PROD-RECOVER-001

rule: When an action fails for a reason outside the user's control (network drop, timeout, server error), the user's already-entered input is preserved, not wiped
rationale: Losing entered input on a transient failure punishes the user for a problem they did not cause
how-to-check: Fill a form, force a network failure on submit, and confirm the entered values remain in the fields afterward
severity: important
sources:
  - Nielsen Norman Group, "User Control and Freedom" (Usability Heuristic #3)

## PROD-METRIC-001

rule: "Done" for the task is defined as the measurable user-facing outcome the prompt described, not merely that the code shipped and typechecks
rationale: Code that ships without moving the actual user outcome has not delivered the value the task was asked for, whatever its test suite reports
how-to-check: Re-state the task's outcome in one sentence about the user; confirm the diff, exercised end to end, actually produces that outcome
severity: important
sources:
  - Shape Up (Ryan Singer) — defining done by the user-facing outcome

## PROD-COST-001

rule: An irreversible or high-impact action (bulk delete, non-refundable charge, mass notification) shows the user the scale of what it affects before it executes
rationale: A user who cannot see the blast radius of an irreversible action cannot give informed consent to it
how-to-check: Trigger the changed bulk/irreversible action and confirm the confirmation step states what and how much it will affect
severity: important
sources:
  - Nielsen Norman Group, "User Control and Freedom" (Usability Heuristic #3)

## PROD-EMPTY-001

rule: A list or search result with zero matches distinguishes "nothing exists yet" from "your filter/search matched nothing," each with a different next action
rationale: The two zero-result cases have opposite correct next steps — create the first one, or loosen the filter — and a single generic message serves neither
how-to-check: Trigger a zero-result state via an empty dataset and again via an over-narrow filter; confirm the copy and offered action differ
severity: minor
sources:
  - Nielsen Norman Group, "Empty States" guidance

## PROD-INPUT-001

rule: A form does not lose or reset a field's value because of an unrelated validation error elsewhere on the same form
rationale: Wiping a correct field because a different field failed validation punishes the user for someone else's mistake on the same form
how-to-check: Submit a form with one deliberately invalid field among several valid ones; confirm the valid fields' values survive the failed submit
severity: important
sources:
  - Nielsen Norman Group, "Error Prevention" (Usability Heuristic #5)

## PROD-DEFAULT-001

rule: A default value or pre-filled selection matches what most users actually want, not merely what was easiest to hardcode
rationale: A poorly chosen default is a tax every single user pays on every use of the flow
how-to-check: For a new default/pre-selected value, confirm it matches the most common real case rather than an arbitrary first option
severity: minor
sources:
  - Nielsen Norman Group, "Recognition Rather than Recall" (Usability Heuristic #6)

## PROD-CROSSDEVICE-001

rule: A flow that can reasonably be started on one device/session and finished on another does not strand state that only exists client-side
rationale: A user who switches devices mid-flow because of a phone call or a crash should not lose all progress if the product otherwise supports resuming
how-to-check: Start the flow, then reload in a fresh session before completing it; confirm meaningful progress is either resumable or clearly restarted, not silently lost
severity: minor
sources:
  - web.dev, "Application State and the Back Button"

## PROD-TIME-001

rule: A relative or absolute time shown to the user matches their own local timezone, or explicitly states which timezone it is in
rationale: An unlabeled time in an unexpected timezone silently causes a user to arrive late, miss a deadline, or misread a log
how-to-check: Check new timestamp displays for either automatic local-timezone conversion or an explicit timezone label
severity: minor
sources:
  - Nielsen Norman Group, "Match Between System and the Real World" (Usability Heuristic #2)

## PROD-TRUST-001

rule: A number shown to the user as a count, total, or measurement is accurate at the moment it is displayed, not a cached or stale value presented as current
rationale: A visibly wrong count is one of the fastest ways a user loses trust in the rest of the product's data
how-to-check: Trigger the underlying change (add/remove an item) and confirm the displayed count updates without requiring a manual refresh
severity: minor
sources:
  - Nielsen Norman Group, "Visibility of System Status" (Usability Heuristic #1)
