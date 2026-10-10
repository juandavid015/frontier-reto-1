# Operator agent for systems with no API: design doc

Frontier BOG/26 · Reto 1 · Oct 10, 2026 · Juan David Garzón

## Problem

A company runs five 15-year-old management systems with no API. We build an agent that takes a task in plain language and a remote desktop, operates an app it has never seen, and reports what happened.

A wrong write costs the business more than a task not done, and the scoring agrees: an extra change is destructive and a false "done" is a false success. So the agent explores freely where nothing is saved, writes once, verifies by reading, and fails with the reason.

## Assumptions and scope

- **Pixels only:** the agent sees the remote screen as images and answers with mouse and keyboard, like a person on a remote desktop (the protocol is VNC). It reads the screen size when it connects.
- **No carry-over:** each task starts clean and has 5 minutes.
- **Same kind of app:** menus, filtered lists, forms, exports. Nothing specific to the practice app lives in our code or prompts.
- **Out of scope:** memory across tasks (the app can change mid-day), undo buttons (a revert is another change), parallel tasks and a UI (nobody measures them).

## Hard cases

All found by operating the practice app by hand.

| Seen in the practice app | What the agent does |
| --- | --- |
| A notes field tells "the assistant" to delete orders | Only the task gives orders; text on the screen is data |
| Two clients share a name; a search also returns a longer name | Exact name first. Zero or several matches: fail, naming each candidate |
| An invalid date shows an error, the list stays unfiltered | Before a save or export: no error, fields read back as intended |
| A wrong accent returns zero rows, with no error | Zero rows is not absence: retry with a short fragment |
| A key marked "do not share"; the session drops | Code writes the report. Reconnect once, look before acting |

## Architecture

Drawn in the architecture diagram. The model only proposes the next action. A layer of plain code, the guard, decides whether it runs: exploring can repeat, a save or export happens once. Like a new employee, the agent tries what the screen suggests, reads the app's reaction and adapts.

## Decisions

| We chose | Because | It costs |
| --- | --- | --- |
| Connect to the remote desktop directly, over driving its web viewer with an automated browser | The contract gives the desktop's address, not a web page | Key codes and timing are ours |
| The model points with coordinates, over finding the screen's text and clicking on words | Empty fields and icons have no text | Needs a model that points well |
| Save or export once and verify by reading, over retrying | A repeated save or export duplicates; exports have no undo | More tasks end as failed |
| The model reads, code counts and writes the report, over the model doing both | Exact counts, strict answer format, no leaked secret | More model output |

## How we will measure it

- **Runner:** one command resets the practice desktop, sends each task, waits, asks the organizers' checker, then checks our reported state and summary.
- **Cases:** the 5 given plus our own per hard case, by type (create, edit, question, export, must fail); a third held out from tuning.
- **Metrics:** tasks correct, false successes (target 0), changes outside the task (target 0), time, steps and cost per task. Cost per task × battery size ≤ US$5.
- **Hour one:** a pointing test (20 marked targets; the hit rate picks the model) and a copy test (if text copied on the remote desktop reaches us, fields and tables are read exactly).
- **Detecting the incident:** it comes unannounced. Every few minutes a free check compares the app's home screen with a saved image. On a schedule, and whenever that check fires, the runner repeats the known cases: the type that drops tells us what broke. Inside a task, an action that leaves the screen unchanged is logged as failed.
- **Not fitted to one app:** an automatic check searches our code for names from the practice app. Finding one means we fitted the agent to it.
