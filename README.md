# Operator agent for apps with no API

An agent that takes a task in plain language and a remote desktop (VNC over a websocket), operates an app it has
never seen through screenshots, mouse and keyboard, and reports `terminada` or `fallida` with a summary. The
challenge brief is [docs/README-reto.md](docs/README-reto.md); our plan is [docs/design-doc.md](docs/design-doc.md);
measurements and experiments are in [NOTES.md](NOTES.md).

## Run it from a clean clone

Needs Node 24 and pnpm (`corepack enable`).

```sh
pnpm install
cp .env.example .env        # then fill in the desktop, tokens and OpenRouter key
pnpm check                  # format, typecheck, unit tests (no network, no cost)
pnpm probe:screenshot       # connects to the desktop, prints its size, saves a PNG under artifacts/
pnpm eval                   # resets the desktop and runs the cases in pruebas/ (spends model budget)
pnpm start                  # the HTTP entrypoint on PORT (default 3000)
```

Other tools: `pnpm probe:input -- click:120,48 "type:texto"` drives the desktop by hand and saves a screenshot per
step; `pnpm pointing` compares models on the marked targets in `evals/pointing/`.

Every task leaves a trace in `artifacts/`: a screenshot per step and `trace.jsonl` with each model call (tokens, cost,
time), each action and its effect on the screen. Secrets are redacted before anything is written.

## Code map

| Folder        | Job                                                                                 |
| ------------- | ----------------------------------------------------------------------------------- |
| `src/vnc`     | The VNC protocol (RFC 6143): login, live copy of the screen, mouse and key messages |
| `src/desktop` | The hands: click, type, keys, scroll, and waiting until the screen stops changing   |
| `src/agent`   | The loop: look, ask the model for one action, act, record; and the summary          |
| `src/server`  | The HTTP entrypoint from the brief                                                  |
| `scripts`     | Probes, the eval runner and the pointing test                                       |

## Decisions

| Choice                                                                            | Why                                                                                                                 | Discarded                                                                                  | Where                                |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------ |
| Our own VNC client over Node's built-in WebSocket                                 | Every failure becomes a normal error with a timeout; libraries threw uncatchable errors that would crash the server | `rfb2` with a stream adapter (fallback); `vnc-rfb-client` (TCP only, DES disabled in Node) | `src/vnc`                            |
| Own DES and PNG writer                                                            | Node's OpenSSL 3 has no DES; a PNG is 30 lines with `node:zlib`                                                     | `pngjs`; re-enabling legacy OpenSSL ciphers                                                | `src/vnc/des.ts`, `src/image/png.ts` |
| Live screen copy with incremental updates, pointer sent apart                     | Screenshots cost no network trip; "screen stopped changing" is local state; the pointer never hides text            | A full 4 MB screen per action (1.6 s each)                                                 | `src/vnc/vnc-client.ts`              |
| Click held 120 ms; accented keys typed at 80 ms, plain ASCII at 15 ms             | The brief ignores clicks under 100 ms; accented letters were lost at 15 ms (NOTES E3)                               | 80 ms for every key (4x slower typing)                                                     | `src/desktop/config.ts`              |
| An action ends when the screen is still for 400 ms, or after 1.5 s with no change | Repaints take up to 1 s; "no change" flags a click that missed                                                      | Fixed sleeps                                                                               | `src/desktop/desktop.ts`             |
| One model call per step, one tool whose schema comes from Zod                     | The schema validates the reply and is what the model sees; they cannot drift                                        | Free text parsed by hand                                                                   | `src/agent/actions.ts`               |
| Code writes the `respuesta:` line and redacts secrets                             | Exact format; a leaked secret fails the task                                                                        | The model writing the whole summary                                                        | `src/agent/run-task.ts`              |
| Model as one config value, chosen by measurement                                  | Pointing test: Sonnet 5.5 and Haiku 5.5 hit 22/22 (NOTES E4)                                                        | Choosing by reputation                                                                     | `src/agent/config.ts`                |
| File names in kebab-case                                                          | Windows ignores case and Linux does not; lowercase names cannot break in deployment                                 | camelCase                                                                                  | everywhere                           |
| Node 24, TypeScript run directly, pnpm                                            | No build step; pnpm refuses freshly published packages by default                                                   | Node 22; npm                                                                               | `package.json`, `Dockerfile`         |
| Task routes need the team token, compared in constant time; `/health` is open     | The brief says calls carry the token; `/health` exposes nothing                                                     | Token on `/health` too                                                                     | `src/server/http-server.ts`          |
| Every task received is logged with steps, cost and the key's remaining budget     | Shows what a validation spent and how many tasks it had                                                             | Counting from the OpenRouter dashboard                                                     | `src/server/request-log.ts`          |
