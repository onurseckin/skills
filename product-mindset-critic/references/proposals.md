# Writing proposals and reviews

## The shape of a proposal

1. **Observation.** What is on the surface, where, in neutral words.
2. **Evidence.** How you know, and at what level (seen on the surface, seen in raw data, or read in code only): what you saw on the running product (a screenshot path, the command and its output), the code that renders it (file and line), the real values. Evidence comes from the real product, not a guess about it.
3. **Impact on the job.** Which user, doing which job, is slowed, misled or blocked, and how often. A daily annoyance outranks a rare one; an untrue value or a destructive surprise is serious even when rare.
4. **Cause and reach.** Why it happened (for example "every action was given the same weight" or "the table mirrors the stored record instead of the job") and every other place where the same cause shows up.
5. **Proposal.** The concrete result: what moves where, what merges, the new label or output text, the new default. Describe it well enough that someone could build it without asking.
6. **Trade-off.** What the change costs (an extra click for a minority, lost discoverability, scripts to update) and the alternative you considered.

A weak proposal says "the table is cluttered, consider simplifying". It names no job, no evidence, no cause, nothing to build and no cost.

## Example: an invoicing product

- _Observation._ The invoice list has eight columns (invoice number, customer, created, sent, due, amount, currency, status) and five buttons on every row: View, Edit, Duplicate, Send reminder, Void.
- _Evidence._ Doing the job "find who owes money this week and chase them" took four steps: sort by due date, scan the status text on every row, compare amounts in mixed currencies, and press Send reminder row by row. Draft invoices with no lines show `0.00`, from a fallback in the amount formatter.
- _Impact._ The person chasing payments does this every week. Overdue invoices do not stand out, mixed currencies cannot be compared, drafts look like zero-value debts, and Void sits beside Send reminder, so a destructive action is one slip away during a routine task.
- _Cause and reach._ The table mirrors the database record and gives every action equal weight. The customer page has the same cause: it lists every stored field in storage order.
- _Proposal._ Lead with customer and amount due in the account currency, original currency as secondary text. Add an Overdue filter with a count as the default view for this role. Show drafts as "Draft, no items". Make the whole row open the invoice; keep Send reminder as the only row action and add a bulk "Send reminders" for selected rows; move Edit, Duplicate and Void into a row overflow menu, with a typed confirmation for Void. Drop created and sent dates from the default columns, still available as optional columns.
- _Trade-off._ People who duplicate invoices daily lose a click; if usage shows that is common, Duplicate stays inline. Converted amounts need a stated rate and date in the header so they are not presented as exact.

## Example: a command-line tool

- _Observation._ `deploy-app --target-environment production_cluster` is the documented way to deploy; `deploy`, `push` and `ship` are hidden aliases.
- _Evidence._ The tool's help lists `deploy-app`; the command parser accepts all four names; the dashboard's "copy command" button prints `--target-environment production_cluster`.
- _Impact._ Every developer types this several times a day. Four names for one action make scripts and docs disagree; the long value is easy to mistype.
- _Cause and reach._ Names were chosen to describe the implementation, and old spellings were kept "for compatibility". The same pattern appears in `inspect-logs` and `--output-format`.
- _Proposal._ One command, `deploy`, with `--env prod`; remove the aliases; make the dashboard print the same command. Apply the same review to every command and flag.
- _Trade-off._ Existing scripts using old names break once; the error for an unknown command names its replacement.

## The review

1. **Users and jobs.** Who, which jobs, how often, what they must see first.
2. **Inventory.** Every element, with its purpose, who uses it, how often and your verdict: right as it is, or the proposal that changes it. Include elements that only appear in some states.
3. **Walkthrough.** The steps of each main job on the real surface, with where it was slow, confusing or untrue.
4. **Proposals,** ranked by frequency and cost to the job, each in the shape above.
5. **Generalized causes,** each with every place you checked for it and what you found there. Checking a sibling surface for the same cause is not a full review of that surface.
6. **Open questions** that need data you do not have.

When you change the product, add what you verified afterwards: what you looked at on the running surface, in which states, and what you saw.

## Explaining why an element exists

When asked to justify a finished surface, give each element one entry: what it is, the job it serves, who uses it and how often, why it sits where it does and at that depth, what it replaced or what was removed nearby and why, and what would make it change. Keep each entry short and concrete; "it helps the user" is not a reason.
