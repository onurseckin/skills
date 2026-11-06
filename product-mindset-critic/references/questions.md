# Questions to start from

These are prompts, not a checklist. Pick the ones that matter for the element in front of you, and add your own: the best question is usually one that only makes sense for this product and this user. An element can be a page, a section, a column, a chart, a button, a menu item, a tooltip line, a file, a command, a flag, an output line, an API field or a config key.

## Purpose and user

- Who uses this, in what situation, and what job does it help them finish?
- What decision does the user make after looking at it? Would that decision change if it were gone?
- Is it written for the user, or does it show how the system is built (internal IDs, storage paths, pipeline stages, enum values)?
- Is it there because the job needs it, or because the data happened to be available?
- Was it added as development scaffolding (test options, mock data, debug fields) that never should reach the user?
- Did a technical mechanism turn into a control? An internal key, version or grouping the system needs is not a reason to make the user choose it.

## Earlier decisions

- What has the product owner already said about this surface or this kind of element, in feedback, decision records or earlier reviews? Read it before judging.
- Does the current surface, or your proposal, quietly reverse an earlier decision? If so, name the decision and give the reason, or follow it.
- Was an earlier piece of feedback applied only to the page it was given on? Where else does its principle apply?

## Priority and frequency

- What does the eye meet first, and is that the most important thing for the job?
- How often is each action used: every visit, every week, once in the life of a project?
- Does a frequent action hide in a menu, a second tab or an obscure flag? Does a rare or destructive action take prime space?
- Would a rare capability be better one deliberate step deeper (overflow menu, settings tab, advanced section, flag), behind a label that says what is there?
- Is anything more than two levels deep? Is the same option reachable through several paths?
- Is this a measure the user needs, or an easy number that fills space?

## Placement and grouping

- Is it where the user needs it, or where it was easiest to build?
- Are things used together kept together? Does each control sit next to what it controls?
- Is a scope or filter set once above the data, or repeated on every row?
- Is this a reading surface or a configuring surface, and does the element belong to that kind?
- Does persistent space (page header, toolbar, sidebar) hold only what every view under it needs?
- Does each fact have exactly one home?
- Can the user see everything one comparison needs without scrolling, switching tabs or remembering values?
- Is detail opened in the right container: hover, inline expansion, side panel, dialog or its own page?

## Wording and naming

- Would the user use this word for this thing? Is it the domain's word or the team's internal word?
- Is the same concept named the same way on every page, in the CLI, the API and the docs? Do two concepts share one name?
- Is a label vague ("info", "details", "data") or does it carry a count or symbol the user must decode?
- Does an action label say what will happen?
- Are units part of the label or the value so a number cannot be misread?
- Is there explanatory text under a title that tells the user what they already know? Conversely, is a consequence or warning the user needs missing?

## Truth and completeness

- Is the value correct for what its label claims? Trace it to its source: measured, derived, estimated or defaulted?
- Is missing data shown as missing, or disguised as zero, an empty string or an invented name?
- Does the same value agree everywhere it appears (chart and table, dialog and report, label and the thing actually used)?
- Does a total mix quantities that belong to different owners or roles? Would the user need the parts, not only the total?
- Is there enough context to judge a number: a comparison, a baseline, the sample size behind an average?
- Is the precision honest and useful?
- Does the chart type match the comparison the user makes (ranking, trade-off, change over time, distribution)? Does the chart show a real comparison or collapse onto one line?
- Does every visual mark carry real data? A line between separate items suggests a continuum, a shaded zone suggests a threshold, and a connector suggests a relationship. Is any of them implied but not true?
- Is an average or per-item value measured per item, or derived by dividing a total? If it is derived, does the label say so, and could the system measure it instead?
- Is information the user needs to finish the task always visible, rather than only in a tooltip?
- Is the user told the consequence of their choices that they cannot see for themselves (a total, a count, a cost)?

## States and scale

- What does it show with no data, while loading, with one item, with thousands, with very long names, with partial data, after a failure, in progress and finished?
- Can the user tell "empty" from "still loading" from "failed"?
- Does an empty state say what belongs there and how to fill it?
- Does an error say what happened, where, and what to do next?
- Do labels, legends and columns stay readable when there are twenty series or two hundred rows?
- Does it handle the case where an optional thing does not exist without inventing a stand-in?
- Does it work for every kind of item the product handles, not only the one on screen? Consider other data types, outcome kinds (yes or no, a score, free text), file types (documents, images, audio), providers and sources.
- When items are grouped, can the user fold away the groups they do not need?

## Effort and flow

- How many steps, clicks, commands or context switches does the most common job take? Which can be removed or combined?
- Does the common case work with sensible defaults and no configuration?
- Does a control exist for something the system already does automatically?
- Is the user asked to decide something they cannot judge yet, or something the system could work out?
- Does confirmation match the risk of the action?

## Consistency

- Does the same kind of element look and behave the same on sibling pages?
- Does the same verb mean the same thing everywhere?
- Does this surface follow the patterns the rest of the product already established, unless there is a clear reason not to?

## Calm and space

- Where does the eye get tired? How many rows of controls, badges and buttons compete before the content starts?
- Is space spent on outcomes or on chrome, repeated labels and padding?
- Would merging, removing or moving deeper make the surface quieter without losing anything the job needs?

## Learning from the field

- Which well-known products serve the same job, and how do they present it? Look at what they show first, what they leave out, how they label things and how they chart them.
- What would fit this product's users, and what would not? Learn the principle; do not copy the look.
- Is this surface doing something unusual where the field has a settled convention users already know?

## Command-line tools

- Is each command and value short, obvious and easy to type? Does it drop words that carry no choice?
- Do subcommands follow one pattern, with the same verbs for similar objects? Are two commands confusingly similar? Does a command repeat its own name as a flag?
- Are flags named the standard way (`--json`, `--quiet`, `--force`, `--dry-run`)? Are hidden aliases and old spellings still accepted, keeping two names alive?
- Is the default output readable by people, with an opt-in machine format? Does output lead with what the user asked for?
- After a change, does the tool say what changed and suggest the likely next command?
- Does an error say what went wrong and what to do next? Does a missing argument show short help instead of a stack trace?
- Does help lead with examples and the most common use, in the user's words?

## APIs and configuration files

- Is each concept named once and the same way across endpoints, fields and files?
- Can a caller tell missing from zero or empty?
- Does a quantity or time field say its unit?
- Does a configuration file hold only what someone changes to run the thing? Do static description and provenance live elsewhere?
- Does each key have one name, without aliases?
