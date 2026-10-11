# Operator agent for apps with no API

An agent that takes a task in plain language and a remote desktop (VNC over a websocket), operates an app it has
never seen through screenshots, mouse and keyboard, and reports `terminada` or `fallida` with a summary.

- The challenge brief: [docs/README-reto.md](docs/README-reto.md)
- Our plan: [docs/design-doc.md](docs/design-doc.md)
- Measurements, experiments, decisions and the incident: [NOTES.md](NOTES.md)

## Results on the practice cases

Five practice cases, one per task type, with the organizers' `/__check` for the app state and our own check of the
state and summary. Every run's traces are kept under `artifacts/eval/`.

| Run | App version | Model      | Correct | False successes | Cost   | What changed                        |
| --- | ----------- | ---------- | ------- | --------------- | ------ | ----------------------------------- |
| 1   | v3.9        | Sonnet 5.5 | 4/5     | 1               | $0.84  | First agent loop                    |
| 2   | v3.9        | Haiku 5.5  | 4/5     | 0               | $0.034 | Same code, cheaper model            |
| 3   | v4.2        | Haiku 5.5  | 4/5     | 1               | $0.048 | Incident: new theme, no code change |
| 4   | v4.2        | Haiku 5.5  | 4/5     | 0               | $0.044 | Code counts rows; commit rules      |
| 5   | v4.2        | Haiku 5.5  | 4/5     | 1               | $0.068 | Filter first; not deployed          |
| 6   | v4.2        | Haiku 5.5  | 4/5     | 0               | $0.064 | Proof that a list ended             |
| 7   | v4.2        | Haiku 5.5  | **5/5** | **0**           | $0.072 | Identity by code, notes; deployed   |

The question type ("how many overdue invoices") was the hard one: the model's own counting gave wrong answers
(runs 1 and 3), and counting an incomplete list gave another (run 5). Code now counts the rows the model copies and
accepts a count only with proof that the list ended. Run 7 (`4ac8bfe`) is the deployed version. See NOTES.md,
"Eval runs", "Incident FR-0153" and "Validation 1".

**Hidden set (validation 1, 56 tasks):** it started on `816642c` and switched to `4ac8bfe` at 18:20:32 Bogotá time,
so the score mixes two versions. Final: 56 tasks, 27 terminada and 28 fallida (1 lost at the switch), $0.87 in total. The diagnosis of the first 15 hidden tasks, in general terms, is in NOTES.md:
the main cause of failure was the agent giving up early because our prompt showed the time left from step 1.

## Run it from a clean clone

Needs Node 24 (`.nvmrc`) and pnpm (`corepack enable`).

```sh
pnpm install --frozen-lockfile
pnpm check                  # format, typecheck, unit tests: no network, no cost, no .env needed
cp .env.example .env        # then fill in the values below
pnpm probe:screenshot       # connects to the desktop, prints its size, saves a PNG under artifacts/
pnpm eval                   # resets the desktop and runs pruebas/ (spends model budget, about $0.01 per case)
pnpm start                  # the HTTP entrypoint on PORT (default 3000), host 0.0.0.0
```

| Variable             | What it is                                                  | Used by               |
| -------------------- | ----------------------------------------------------------- | --------------------- |
| `DESKTOP_WS_URL`     | The practice desktop's websocket, `wss://<host>/websockify` | probes, eval          |
| `DESKTOP_PASSWORD`   | The desktop's VNC password                                  | probes, eval          |
| `DESKTOP_TOKEN`      | Bearer token for the desktop's `/__reset` and `/__check`    | eval, remote test     |
| `TEAM_TOKEN`         | Bearer token callers send to our agent                      | the server            |
| `OPENROUTER_API_KEY` | The model key                                               | the agent, the server |

Other tools:

- `pnpm eval --model=anthropic/claude-sonnet-5.5 [folder] [case id]`: run with another model or one case.
- `pnpm remote <agent URL> <case id>`: send a practice case to a deployed agent as the evaluator would, then check it.
- `pnpm budget`: what the OpenRouter key has spent and has left (free).
- `pnpm probe:input -- click:120,48 "type:texto" keys:Enter`: drive the desktop by hand, a screenshot per step.
- `pnpm pointing`: compare models on the marked targets in `evals/pointing/`.

Every task leaves a trace in `artifacts/`: a screenshot per step and `trace.jsonl` with each model call (tokens,
cost, time, why the reply stopped), each action and its effect on the screen, and each rule that refused something.
Secrets are redacted before anything is written.

## Deploy (Railway)

The service is a long-running container built from the `Dockerfile`; `railway.json` turns sleeping off and uses
`/health` as the health check. With the Railway CLI, logged in with `railway login`:

```sh
railway init --name frontier-reto-1
railway add --service agent
railway variable set TEAM_TOKEN --stdin --service agent --skip-deploys          # paste the value, then end input
railway variable set OPENROUTER_API_KEY --stdin --service agent --skip-deploys
railway up --detach --service agent
railway domain --service agent
```

Railway sets `PORT`. Each task the service receives is logged as one JSON line on stdout when it arrives and when it
ends, with its steps, cost and the key's remaining budget (`railway logs --service agent`). Tasks live in memory: do
not redeploy while an evaluation is running.

## How it works

Each step: take the screenshot (free, the client keeps a live copy of the screen), send it with the task and the
history to the model, get one action back through a single tool whose schema comes from Zod, let plain code check it,
act, record. Plain code enforces the rules the model might forget:

- **Counting:** the model copies the rows it sees (`read_rows`); code keeps them by id across pages and counts exact
  matches. A row read twice counts once; a longer name that contains the searched one does not count. A count is
  accepted only with proof the list ended: a shorter last page, a total shown by the app equal to the rows read, or
  "next" showing the same page again. A question that read rows cannot end `terminada` without an answer.
- **Identity:** the model copies the candidates of a search (`resolve_identity`); code chooses. An exact name wins;
  a shorter form of a name picks the only record containing all its words, only after the whole result list was
  seen and if any other identifier the task gives matches. Two or more candidates end `fallida`, naming them.
- **Commits:** a save, create, export or delete is never repeated on the same record, and a new commit or a
  `terminada` waits until the previous commit was verified by reading the stored record.
- **The clock:** the agent stops at 4:30, reports and closes the connection; nothing is left `en_curso`.
- **The summary:** code writes the `respuesta:` line, names the record it chose, removes every secret it was given
  and anything shaped like a key the model may have copied from the screen.
- **Memory and time:** facts the model notes (`remember`) are shown at every step of the same task; the time left is
  shown only in the last minute, because shown from the start it made the model give up early.

## Code map

| Folder        | Job                                                                                    |
| ------------- | -------------------------------------------------------------------------------------- |
| `src/vnc`     | The VNC protocol (RFC 6143): login, live copy of the screen, mouse and key messages    |
| `src/desktop` | The hands: click, type, keys, scroll, and waiting until the screen stops changing      |
| `src/agent`   | The loop, the model call, the counting ledger, the commit guard, the trace, the prompt |
| `src/server`  | The HTTP entrypoint from the brief and its request log                                 |
| `scripts`     | Probes, the eval runner, the remote test, the pointing test, the budget                |

## Decisions

| Choice                                                                                     | Why                                                                                                                        | Discarded                                                                                  | Where                                                  |
| ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------ |
| Our own VNC client over Node's built-in WebSocket                                          | Every failure becomes a normal error with a timeout; the libraries threw uncatchable errors that would crash the server    | `rfb2` with a stream adapter (fallback); `vnc-rfb-client` (TCP only, DES disabled in Node) | `src/vnc`                                              |
| Own DES and PNG writer                                                                     | Node's OpenSSL 3 has no DES; a PNG is 30 lines with `node:zlib`                                                            | `pngjs`; re-enabling legacy OpenSSL ciphers                                                | `src/vnc/des.ts`, `src/image/png.ts`                   |
| Live screen copy with incremental updates, pointer sent apart                              | Screenshots cost no network trip; "screen stopped changing" is local state; the pointer never hides text                   | A full 4 MB screen per action (1.6 s each)                                                 | `src/vnc/vnc-client.ts`                                |
| Click held 120 ms; accented keys typed at 80 ms, plain ASCII at 15 ms                      | The brief ignores clicks under 100 ms; accented letters were lost at 15 ms (NOTES E3)                                      | 80 ms for every key (4x slower typing)                                                     | `src/desktop/config.ts`                                |
| An action ends when the screen is still for 400 ms, or after 1.5 s with no change          | Repaints take up to 1 s; "no change" flags an exploring click that missed                                                  | Fixed sleeps                                                                               | `src/desktop/desktop.ts`                               |
| One model call per step, one tool whose schema comes from Zod                              | The schema validates the reply and is what the model sees; they cannot drift                                               | Free text parsed by hand                                                                   | `src/agent/actions.ts`                                 |
| A stringified action is parsed; observation and plan are optional                          | Haiku sometimes sends the action as a JSON string; one task was lost to it (run 4)                                         | Rejecting the reply                                                                        | `src/agent/actions.ts`                                 |
| Haiku 5.5 by default, the model as one config value                                        | Same pass rate as Sonnet 5.5, no false success, 1/25 of the cost, 22/22 in the pointing test (NOTES E4, runs 1 and 2)      | Sonnet 5.5; choosing by reputation                                                         | `src/agent/config.ts`                                  |
| Code counts the rows the model copies                                                      | The model's own counts were wrong in runs 1 and 3, both false successes                                                    | Better prompting of the count                                                              | `src/agent/row-ledger.ts`                              |
| Never commit the same record twice; a verifying read before the next commit or `terminada` | On v4.2 a good save leaves the form open; a second click would duplicate (incident FR-0153)                                | One save per task (too strict for two changes); trusting how the form reacts               | `src/agent/commit-guard.ts`                            |
| "No visible change" kept for exploring clicks, dropped for commits                         | It still catches missed clicks; after a commit it would invite a duplicate                                                 | Dropping it everywhere                                                                     | `src/agent/run-task.ts`                                |
| Code writes the `respuesta:` line and redacts secrets                                      | Exact format; a leaked secret fails the task                                                                               | The model writing the whole summary                                                        | `src/agent/run-task.ts`                                |
| A test fails if a practice-app name appears in `src/`                                      | The agent must not be fitted to the practice app; it found five, one in the schema the model sees                          | Review by eye                                                                              | `src/no-practice-names.test.ts`                        |
| The 4:30 clock is the limit, not a step count                                              | A correct task finished on step 29 of 30 (run 1)                                                                           | A tight step cap                                                                           | `src/agent/config.ts`                                  |
| Task routes need the team token, compared in constant time; `/health` is open              | The brief says calls carry the token; `/health` exposes nothing and serves as the health check                             | Token on `/health` too                                                                     | `src/server/http-server.ts`                            |
| Every task received is logged with steps, cost and the key's remaining budget              | Shows how many tasks a validation had and what it spent                                                                    | Counting from the OpenRouter dashboard                                                     | `src/server/request-log.ts`                            |
| Railway, from the Dockerfile, sleeping off                                                 | A long-running server; a task holds an open connection for up to 5 minutes                                                 | Serverless functions                                                                       | `Dockerfile`, `railway.json`                           |
| A count needs proof the list ended; a question that read rows needs an answer              | Run 5 counted three full pages with no proof of a fourth and ended `terminada` with no answer                              | Trusting the model to have read every page                                                 | `src/agent/finish-rules.ts`, `src/agent/row-ledger.ts` |
| Identity chosen by code; a shorter name form allowed with four conditions                  | Two hidden tasks gave a shorter name than the record; the exact-name rule refused them. Exact still wins over longer names | Exact match only; letting the model decide                                                 | `src/agent/identity.ts`                                |
| Time left shown only in the last 60 s                                                      | Shown from step 1, it made the model give up with a third of the clock left (4 of 15 hidden tasks)                         | Showing it every step                                                                      | `src/agent/prompt.ts`                                  |
| Summaries drop key-shaped tokens, besides our own secrets                                  | A hidden task asked to copy a key from the screen; a prompt rule alone was not enough                                      | Prompt rule only                                                                           | `src/secrets/redact.ts`                                |
| Notes (`remember`) per task                                                                | A hidden task failed because data read earlier was gone from the history                                                   | Sending every past observation                                                             | `src/agent/notes.ts`                                   |
| File names in kebab-case                                                                   | Windows ignores case and Linux does not; lowercase names cannot break in deployment                                        | camelCase                                                                                  | everywhere                                             |
| Node 24, TypeScript run directly, pnpm                                                     | No build step; pnpm refuses freshly published packages by default                                                          | Node 22; npm                                                                               | `package.json`, `Dockerfile`                           |

## Limits and next steps

- **A save that did not store cannot be retried:** the commit guard blocks a second commit on a record even when a
  read shows the first did not store (2 hidden tasks). The fix needs to tell a confirmation dialog from a validation
  error first; not built.
- **Hypothesis, not proven:** commits that need a confirmation dialog are dropped, because after a commit the agent
  is told to verify by reading instead of clicking again. Evidence: 5 hidden tasks with the same pattern (one commit,
  old value still stored). See NOTES.md.
- **Counting is correct but can be slow** on long lists: the prompt asks to filter first. Next: read copied text from
  the remote clipboard, if it reaches us (not tested).
- **Dates:** "today" comes from the app's screen; the parsing rules and their cases are in NOTES.md, not built yet.
- **Hardening tests** for the VNC client (fake server, reconnect once mid-task) are planned in NOTES.md, not built yet.
- **Validation 1 mixes two versions** (switch at 18:20:32); the request log does not record summaries.
- `railway.json` is deprecated by Railway in favour of `.railway/railway.ts`; it keeps working until 2026-12-01.
