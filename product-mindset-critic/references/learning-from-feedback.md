# Learning from feedback and examples

Product owners teach through examples: "this button should not be here", "show the name with its count", "why is this column on this table?" The example is one instance of a way of thinking. Treat it like a worked exercise in a textbook: learn the method, then solve the other exercises with it.

## The four steps

1. **Restate the user's job behind the remark.** What was the person trying to do when the example bothered them?
2. **Name the reasoning, in general words.** Not "move Edit to the menu" but "place each capability by how often it is used". Not "show the suite with its case count" but "show what the user wants to know about a thing in one place, in the form they think of it, using the thing's real name". Check your statement: it should say nothing about the specific button, field or page.
3. **Apply it everywhere it fits.** Search every surface (other pages, tables, dialogs, the CLI, the API) for the same cause and fix each one on its own merits. The fix may look different in each place.
4. **Check the example's own edge cases.** The example usually shows the common case. Ask what happens when the thing does not exist, is empty, is very large, or has a different shape. The answer comes from the principle and from the truth of the data, never from copying the example's wording.

## Two ways to get it wrong

**Too literal.** Copying the example as a template or rule. If the owner says a playlist should read "Road trip (25)", a literal reader shows "Playlist: Default (0)" for a queue that has no playlist at all, inventing a name to fill the template. The principle was "show the real name and the size the user cares about"; for an unnamed queue the truthful display is just "25 songs". A literal reader also turns the example into a rule in a skill or guide, so the next reviewer applies it where it does not fit.

**Too broad.** Stretching the remark past what it meant. "Remove the description under the page title" does not mean deleting the warning in a delete dialog, which tells the user a consequence they need. "Filter by team, not by person" does not mean removing the people page. When a change would remove information, an entity or a safety message that the remark did not name, keep it and ask.

## More examples from different products

- _A note-taking app:_ "Why is there a Sync button? It syncs by itself." Principle: do not add controls for what the system already does; if the mechanism is unreliable, fix the mechanism. Elsewhere: Save buttons on auto-saving forms, a "refresh status" command when status already updates.
- _A flight search page:_ "I chose three passengers and two bags each; just tell me the total price, not a list of what I chose." Principle: do not echo the user's choices back; tell them the consequence they cannot see. Elsewhere: a deployment dialog that should state how many machines will restart, a bulk action that should state how many records it will change.
- _An analytics dashboard:_ "Why does the revenue table show which server computed it?" Principle: every column must help answer the question that table exists for; operational details belong with the operation. Elsewhere: retry counts in a results summary, job IDs on a leaderboard.
- _A banking app:_ "Fees and interest are added into one 'charges' number." Principle: a number has one owner and the user needs its parts when the parts lead to different decisions. Elsewhere: cost split by service, time split by stage, usage split between a worker and a reviewer.
- _A build tool:_ "Why is it `generate-artifact --mode production_release`?" Principle: names are short, obvious and easy to type; drop words that carry no choice. Elsewhere: every command, flag and value in the tool.

## When the feedback is about the reviewer

Sometimes the owner's remark is that the reviewer missed something: "you approved this page, but this field is wrong". Then the lesson is about method as well as product: which element was not inspected, which state was not opened, which value was not traced? Change how you review, then review again, before fixing the single item.

## Keeping feedback alive

Feedback is lost when it lives only in the conversation it was given in. Record each piece where the next reviewer and the next implementer will read it: a feedback log, decision record or planning note in the project. Write the principle, the surfaces it covers and the owner's own words. Read that record before every review and before every plan that touches those surfaces. Also check it at the moment of building: a later technical decision (a key, a version, a grouping the system needs) can quietly bring back something the owner rejected, as a control, column or label.
