# UI design checklist
Domain: ui-design

Drawn whenever a task's write scope touches a UI surface (B12.2): a `.tsx`, `.css`, `.html` or
equivalent template file. The owner's worked example (B12.1) is this checklist's reason to exist —
a validator checking only the task confirms the asked-for change and misses a sibling's text size
breaking the repo's own convention. Flag standing-standard violations found in the touched area as
adjacent findings even when nobody asked about them.

## UI-LAYOUT-001

rule: A new element's spacing (margin, padding, gap) uses the design system's scale, not an arbitrary pixel value
rationale: An off-scale value is invisible in isolation and becomes a visible seam the moment it sits next to a scale-following sibling
how-to-check: Grep the diff's styles for numeric literals not present in the token scale (e.g. `13px`, `7px` in an 4/8-based scale)
severity: minor
sources:
  - Refactoring UI (Adam Wathan & Steve Schoger), "Working with a Type Scale" and spacing chapters

## UI-LAYOUT-002

rule: A layout that must hold at the narrowest supported viewport is verified there, not only at the design's default width
rationale: A layout that only degrades gracefully at desktop width regularly breaks completely at phone width
how-to-check: Check the changed component's CSS for fixed widths or `nowrap` without a corresponding narrow-viewport rule
severity: important
sources:
  - web.dev, "Responsive Web Design Basics"

## UI-TYPE-001

rule: A sibling element at the same hierarchical level (another item in the same list, another card in the same grid) shares its type size and weight unless the content justifies a difference
rationale: This is the owner's own worked example: an inconsistent text size nobody asked to change is still a defect a standing checklist must catch
how-to-check: Compare the new or touched element's font-size/font-weight against its nearest sibling in the same component
severity: important
sources:
  - Refactoring UI (Adam Wathan & Steve Schoger), "Establish a Type Scale"

## UI-TYPE-002

rule: Body text does not fall below the platform's minimum legible size, and a line of text does not exceed roughly 75 characters at its widest
rationale: Text below the legibility floor or lines that run too wide both cost the reader measurable comprehension
how-to-check: Check computed font-size against the platform floor (16px web body text as a common baseline) and measure line length at the container's max width
severity: minor
sources:
  - WCAG 2.2, Success Criterion 1.4.4 (Resize Text); typography convention on line length (~45–75 characters)

## UI-COLOR-001

rule: Text against its background meets WCAG contrast: 4.5:1 for normal text, 3:1 for large text (18pt+/14pt+ bold) and UI component boundaries
rationale: Contrast below the threshold is unreadable for a meaningful share of users, not a stylistic preference
how-to-check: Compute the contrast ratio between the element's resolved foreground and background colors; compare against the threshold for its text size
severity: important
sources:
  - WCAG 2.2, Success Criterion 1.4.3 (Contrast Minimum) and 1.4.11 (Non-text Contrast)

## UI-COLOR-002

rule: Color is never the only signal for state (error, success, required, selected); a second cue (icon, label, shape) carries the same information
rationale: Color-only signaling is invisible to colorblind users and to anyone in a low-contrast viewing environment
how-to-check: For each state that changes only a color, confirm an accompanying icon, text label, or border-style change exists
severity: important
sources:
  - WCAG 2.2, Success Criterion 1.4.1 (Use of Color)

## UI-SPACE-001

rule: Interactive targets (buttons, links, form controls) are at least 24x24 CSS pixels, or have enough surrounding spacing to reach that effective size
rationale: A target below this size increases mis-taps disproportionately for users with motor impairments or on touch devices
how-to-check: Measure the touched control's rendered bounding box, including padding, against the 24x24 floor
severity: important
sources:
  - WCAG 2.2, Success Criterion 2.5.8 (Target Size Minimum)

## UI-SPACE-002

rule: Related fields and controls are grouped with tighter spacing than the spacing between unrelated groups
rationale: Spacing is the primary way a layout communicates grouping before a user reads a single label
how-to-check: Compare the gap within a logical group against the gap to the next group; the within-group gap should be visibly smaller
severity: minor
sources:
  - Refactoring UI (Adam Wathan & Steve Schoger), "The Power of Proximity"

## UI-RESP-001

rule: An image, video or embed sets `max-width: 100%` (or the framework equivalent) so it cannot force the page to scroll horizontally
rationale: A single oversized media element breaks the whole page's responsiveness, not just its own container
how-to-check: Grep the diff's new media elements for a missing max-width constraint
severity: minor
sources:
  - web.dev, "Responsive Images"

## UI-RESP-002

rule: A wide element that cannot reflow (a data table, a code block, a diagram) scrolls inside its own container; the page body itself never scrolls horizontally
rationale: A page-level horizontal scrollbar hides content off both edges and is easy to miss during a narrow-viewport review
how-to-check: At the narrowest supported viewport, check whether `document.body` or the page root has horizontal overflow rather than the specific wide element
severity: important
sources:
  - web.dev, "Avoid Horizontal Scrolling"

## UI-MOTION-001

rule: An animation or transition longer than momentary respects `prefers-reduced-motion` by shortening or removing non-essential motion
rationale: Motion-triggered vestibular symptoms are a real accessibility harm, not an aesthetic edge case
how-to-check: Grep the diff's CSS/JS for new `@keyframes`, `transition`, or animation libraries and confirm a reduced-motion branch exists
severity: minor
sources:
  - WCAG 2.2, Success Criterion 2.3.3 (Animation from Interactions)

## UI-MOTION-002

rule: A transition's duration and easing match the design system's motion tokens, not a value picked by feel for this one component
rationale: Inconsistent motion timing is felt even when it cannot be easily named, the same way inconsistent type sizes are seen
how-to-check: Compare new `transition-duration`/`animation-duration` values against the system's documented motion tokens
severity: minor
sources:
  - Material Design, "Motion — Duration and Easing"

## UI-A11Y-001

rule: Every interactive element is reachable and operable by keyboard alone, with a visible focus indicator
rationale: A mouse-only interaction excludes keyboard and switch-device users entirely, not partially
how-to-check: Tab through the changed surface; confirm every clickable element receives focus in a sensible order and shows a visible focus ring
severity: critical
sources:
  - WCAG 2.2, Success Criterion 2.1.1 (Keyboard) and 2.4.7 (Focus Visible)

## UI-A11Y-002

rule: A non-text control (icon button, image button) has an accessible name via `aria-label`, `alt`, or equivalent — never left to an icon alone
rationale: A screen reader announces nothing useful for an unlabeled icon, so the control is effectively invisible to that user
how-to-check: Grep new icon-only buttons and images for a missing `aria-label`/`alt` attribute
severity: important
sources:
  - WCAG 2.2, Success Criterion 4.1.2 (Name, Role, Value); WAI-ARIA Authoring Practices Guide

## UI-A11Y-003

rule: A custom interactive widget (dropdown, tabs, modal, combobox) follows the matching WAI-ARIA Authoring Practices pattern for roles, states and keyboard behaviour
rationale: A hand-rolled widget that looks right visually routinely omits the `role`/`aria-*` wiring assistive technology depends on
how-to-check: Compare the new widget's markup and keyboard handling against the corresponding APG pattern for that widget type
severity: important
sources:
  - WAI-ARIA Authoring Practices Guide (APG)

## UI-FORM-001

rule: Every form field has a visible, programmatically associated label — a placeholder alone is never the label
rationale: Placeholder text disappears the moment the user types, and is not reliably read as a label by assistive technology
how-to-check: Grep new form fields for a `<label for>`/`aria-labelledby` association; flag any field with only a `placeholder`
severity: important
sources:
  - WCAG 2.2, Success Criterion 1.3.1 (Info and Relationships); WAI-ARIA Authoring Practices Guide

## UI-FORM-002

rule: A validation error names the field and the specific problem, appears next to that field, and is announced to assistive technology
rationale: A generic top-of-page "there were errors" message forces the user to hunt for what actually failed
how-to-check: Trigger a validation failure on the changed form; confirm the message text is field-specific and lives near the field, with `aria-describedby` or a live region wiring it to assistive tech
severity: important
sources:
  - WCAG 2.2, Success Criterion 3.3.1 (Error Identification) and 3.3.3 (Error Suggestion)

## UI-STATE-001

rule: A view that loads data defines its empty, loading, error and partial-data states explicitly, not only its happy path
rationale: The states nobody designed are the ones users hit first in production — a network blip or a genuinely empty result
how-to-check: For a new or touched data-driven view, exercise each of the four states directly (throttle network, force an error, return zero rows)
severity: important
sources:
  - Nielsen Norman Group, "Visibility of System Status" (Usability Heuristic #1)

## UI-STATE-002

rule: A destructive or hard-to-reverse action (delete, discard, send) requires confirmation or offers undo, proportional to its cost
rationale: An accidental single click destroying unrecoverable work is a severe, entirely preventable failure mode
how-to-check: For every new destructive action, confirm a confirmation step or an undo window exists
severity: important
sources:
  - Nielsen Norman Group, "User Control and Freedom" (Usability Heuristic #3)

## UI-NAV-001

rule: The currently active section or step is visually indicated in navigation, not left to the user to infer from the page content alone
rationale: Without an active-state indicator, a user who navigates away and back loses their place
how-to-check: Compare the navigation element's styling for the current route against its styling for other routes
severity: minor
sources:
  - Nielsen Norman Group, "Visibility of System Status" (Usability Heuristic #1)

## UI-NAV-002

rule: A page reachable only by direct action within the app (a detail view, a modal-turned-page) still behaves correctly on reload and back/forward navigation
rationale: A view that only works when arrived at via in-app click breaks the moment a user reloads, shares the link, or uses the browser back button
how-to-check: Reload the changed route directly and use browser back/forward; confirm state is not lost or the page does not error
severity: minor
sources:
  - web.dev, "Application State and the Back Button"

## UI-DARK-001

rule: A color introduced for this component is defined as a token that resolves correctly in both light and dark themes, never a single hard-coded value assumed to work in both
rationale: A color tuned by eye in one theme is very often illegible or jarring in the other, and this is invisible unless both are checked
how-to-check: Toggle the theme (or check `prefers-color-scheme`) and inspect the new component in both states
severity: important
sources:
  - web.dev, "prefers-color-scheme: Hello Darkness, My Old Friend"

## UI-LAYOUT-003

rule: A grid or flex layout's alignment (start/center/end, baseline) is intentional and consistent with sibling layouts of the same kind elsewhere in the product
rationale: An arbitrary alignment choice for one instance of a repeated pattern reads as a mistake next to every other instance
how-to-check: Compare the new layout's alignment properties against the nearest existing instance of the same layout pattern
severity: minor
sources:
  - Refactoring UI (Adam Wathan & Steve Schoger) — layout and alignment

## UI-LAYOUT-004

rule: A fixed-height container that can hold variable-length content (a card, a list item) either grows with its content or explicitly truncates it, rather than clipping content silently
rationale: Silent clipping without truncation styling loses content the user never knows is missing
how-to-check: Fill the changed container with unusually long content and check whether it grows, shows a visible truncation affordance (ellipsis, "show more"), or silently cuts off
severity: minor
sources:
  - Refactoring UI (Adam Wathan & Steve Schoger)

## UI-TYPE-003

rule: A heading hierarchy (h1 through h6, or an equivalent type-scale level) is used in visual and semantic order, not skipped or chosen purely for a look
rationale: A skipped heading level breaks both the visual scan pattern and the document outline assistive technology relies on
how-to-check: List the new surface's heading levels in document order and confirm no level is skipped
severity: minor
sources:
  - WCAG 2.2, Success Criterion 1.3.1 (Info and Relationships) — heading structure

## UI-TYPE-004

rule: Line height for body text falls in a readable range relative to its font size (roughly 1.4-1.6x for typical body copy), not compressed to fit a design mockup exactly
rationale: Tight line height measurably reduces reading comprehension and speed, especially for longer passages
how-to-check: Compute the ratio of `line-height` to `font-size` for new body-text blocks
severity: minor
sources:
  - WCAG 2.2, Success Criterion 1.4.8 (Visual Presentation) — line spacing guidance

## UI-COLOR-003

rule: A brand or accent color used at low contrast against its background for decorative purposes is not also relied on to convey required information
rationale: A color chosen for aesthetics rather than contrast frequently fails the threshold the moment it also has to carry meaning
how-to-check: For each new use of a low-contrast color, confirm it is purely decorative and not the sole carrier of state or required information
severity: minor
sources:
  - WCAG 2.2, Success Criterion 1.4.1 (Use of Color)

## UI-SPACE-003

rule: Padding inside an interactive element scales consistently with its visual size variant (small/medium/large), not a fixed pixel value applied to every size
rationale: A fixed padding value on a scaled-up variant produces a cramped or lopsided control instead of a proportionally larger one
how-to-check: Compare the padding-to-size ratio across the component's declared size variants
severity: minor
sources:
  - Refactoring UI (Adam Wathan & Steve Schoger)

## UI-RESP-003

rule: A touch target does not rely on a hover-only affordance (tooltip, hover-reveal menu) to be discoverable or operable on a touch device
rationale: Touch has no hover state, so a hover-only affordance is simply absent for a touch user
how-to-check: For a new hover-triggered UI element, confirm an equivalent tap/focus-triggered path exists
severity: important
sources:
  - WCAG 2.2, Success Criterion 2.1.1 (Keyboard) and general touch-target guidance

## UI-RESP-004

rule: Text does not overflow its container or get cut off at any width between the narrowest and widest supported viewport, not only at the two extremes
rationale: A layout can work at both breakpoint extremes and still break at an intermediate width nobody checked
how-to-check: Resize the changed surface continuously across the supported range, not only jumping between the smallest and largest breakpoint
severity: minor
sources:
  - web.dev, "Responsive Web Design Basics"

## UI-MOTION-003

rule: A loading or transition animation has a defined maximum duration and does not loop indefinitely once the underlying operation has actually completed
rationale: An animation still running after its operation finished reads as the system still being busy when it is not
how-to-check: Trigger the changed operation to completion and confirm its animation stops at or shortly after that point, not continuing on a fixed loop
severity: minor
sources:
  - Nielsen Norman Group, "Visibility of System Status" (Usability Heuristic #1)

## UI-A11Y-004

rule: A live region (`aria-live`, a toast, a status update) announces a meaningful change to screen reader users without needing focus to move there
rationale: A visually-obvious status change is invisible to a screen reader user unless the DOM change is wired to an announcement mechanism
how-to-check: Trigger the changed status update with a screen reader running and confirm it is announced without manual navigation to the message
severity: important
sources:
  - WAI-ARIA Authoring Practices Guide — live regions

## UI-A11Y-005

rule: Content conveyed by an image (a chart, a diagram, an icon carrying meaning) has an equivalent text alternative that states what the image communicates, not just that an image is present
rationale: `alt="image"` or an empty alt on a meaningful image gives a screen reader user nothing about what the image actually conveys
how-to-check: Read each new meaningful image's alt text and confirm it states the image's actual informational content, not a generic label
severity: important
sources:
  - WCAG 2.2, Success Criterion 1.1.1 (Non-text Content)

## UI-A11Y-006

rule: The reading and focus order implied by the DOM matches the visual order on screen; CSS is not used to visually reorder content in a way that scrambles the tab or screen-reader order
rationale: A mismatched visual and DOM order means keyboard and screen-reader users experience the content in a different sequence than sighted mouse users see
how-to-check: Tab through the changed surface while watching focus move, and compare the sequence against the visual left-to-right, top-to-bottom reading order
severity: important
sources:
  - WCAG 2.2, Success Criterion 1.3.2 (Meaningful Sequence)

## UI-A11Y-007

rule: Text scales correctly when the user increases browser zoom or OS text size up to 200%, without content being clipped or overlapping
rationale: Users with low vision routinely rely on browser zoom, and a layout that breaks there excludes them from an otherwise-accessible feature
how-to-check: Set browser zoom to 200% on the changed surface and check for clipped, overlapping, or unreachable content
severity: important
sources:
  - WCAG 2.2, Success Criterion 1.4.4 (Resize Text)

## UI-FORM-003

rule: A form field's expected format (date, phone, card number) is stated before the user submits, not only revealed after a failed attempt
rationale: Discovering the required format only after a rejected submission wastes a round trip the label or a hint could have prevented
how-to-check: Read the field's label/hint text for a stated format expectation before triggering a validation error
severity: minor
sources:
  - Nielsen Norman Group, "Error Prevention" (Usability Heuristic #5)

## UI-FORM-004

rule: A disabled submit button explains why it is disabled (a hint, an inline validation state) rather than leaving the user to guess what is missing
rationale: A disabled control with no explanation is a dead end the user cannot resolve without trial and error
how-to-check: Reach the disabled state of the changed submit control and check for a visible reason near it
severity: minor
sources:
  - Nielsen Norman Group, "Visibility of System Status" (Usability Heuristic #1)

## UI-STATE-003

rule: A skeleton loading state's shape approximates the real content's layout, rather than a generic placeholder unrelated to what will actually appear
rationale: A skeleton that does not resemble the eventual content causes a visible layout jump the moment real content replaces it
how-to-check: Compare the skeleton's block shapes and proportions against the loaded content's actual layout
severity: minor
sources:
  - web.dev — perceived performance and layout stability (Cumulative Layout Shift)

## UI-STATE-004

rule: A component's disabled visual state is distinguishable from its normal-but-inactive or loading state at a glance
rationale: Visually identical disabled and loading states leave the user unable to tell whether to wait or that the action is simply unavailable
how-to-check: Compare the component's disabled, loading, and default states side by side for a visibly distinct treatment
severity: minor
sources:
  - Nielsen Norman Group, "Visibility of System Status" (Usability Heuristic #1)

## UI-NAV-003

rule: A breadcrumb or back action returns the user to the actual prior context (including applied filters or scroll position), not merely to a fresh instance of the parent view
rationale: A "back" that discards the user's prior filtering/scroll state makes navigation feel like starting over rather than going back
how-to-check: Apply a filter or scroll on a list view, drill into a detail, then navigate back and confirm the filter/scroll state is preserved
severity: minor
sources:
  - Nielsen Norman Group, "User Control and Freedom" (Usability Heuristic #3)

## UI-ICON-001

rule: An icon used to convey meaning follows an established convention for that meaning (a trash can for delete, a pencil for edit) rather than an idiosyncratic choice the user must learn
rationale: A novel icon for a common action forces every user to learn a symbol the rest of the product already trained them to recognize differently
how-to-check: Compare a new icon's meaning against the icon already used for the same action elsewhere in the product or against widely recognized conventions
severity: minor
sources:
  - Nielsen Norman Group, "Standard Icons" guidance

## UI-DARK-002

rule: An image, illustration, or screenshot embedded in the UI (not a themed icon) remains legible against both the light and dark background it can appear on
rationale: A white-background screenshot or a low-contrast illustration can become illegible or jarring the instant the surrounding theme switches
how-to-check: Toggle the theme and inspect the new embedded image's contrast and legibility against its actual surrounding background in both states
severity: minor
sources:
  - web.dev, "prefers-color-scheme: Hello Darkness, My Old Friend"

## UI-OVERFLOW-001

rule: A dropdown, tooltip, or popover positions itself to stay within the viewport, flipping side when it would otherwise render off-screen or under a fixed header
rationale: A popover that renders off-screen or behind another fixed element is invisible or unusable exactly when triggered near an edge
how-to-check: Trigger the changed popover from an element near each edge of the viewport and confirm it repositions to stay visible
severity: minor
sources:
  - web.dev — popover positioning and viewport collision handling
