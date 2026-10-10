# Notes

## Decisions

### Our own VNC client, not a library (Oct 10)

- **Choice:** a small VNC client of our own in TypeScript. It talks to the desktop's websocket through the WebSocket
  client built into Node. It follows RFC 6143, the VNC protocol spec. It has no runtime dependencies. We write the PNG
  files ourselves with Node's built-in `zlib`.
- **Why:** our server runs for hours and runs many tasks. Both libraries we checked throw errors inside network
  callbacks (`rfb2` `rfbclient.js:95`, `:141`, `:146`). Nothing can catch those errors, so one bad connection would
  crash the server and every task on it. `rfb2` also waits forever on a screen format it does not know (`:308`), and
  its hextile decoder has visible bugs (`:346`, `:433`). Our own client turns every failure into a normal error with a
  timeout, controls what gets logged (so the password cannot leak), and sends mouse and keyboard events with the
  timing the brief needs.
- **Discarded:**
  - `rfb2` 0.2.2 with a stream adapter. It accepts any stream, so it needs no bridge. Rejected for the crash risk. It
    stays the fallback: if we have no screenshot by 14:00, we switch to it.
  - `vnc-rfb-client` 0.2.0. It connects over TCP only, so it would need a local bridge. It also uses Node's DES, which
    fails here with `ERR_OSSL_EVP_UNSUPPORTED`. Making it work needs a startup flag that turns old ciphers back on for
    the whole process.
  - noVNC. It is a browser library and needs a page canvas to draw on.
  - `pngjs`. Writing a PNG takes about 30 lines with `zlib.deflateSync` and `zlib.crc32`.
- **Cost:** about 300 lines of protocol code plus about 80 lines of DES that we own, bugs included. At first we only
  support uncompressed screen updates, about 4 MB for a full 1280×800 screen. If that is slow over the internet,
  adding the zlib format is a small follow-up.

### File names in kebab-case (Oct 10)

- **Choice:** every file name is lowercase with hyphens: `vnc-client.ts`, `probe-screenshot.ts`.
- **Why:** Windows ignores letter case in file names and Linux, where we deploy, does not. An import written as
  `./VncClient.ts` works here and breaks in deployment; all-lowercase names cannot have that bug. Angular's style guide
  and Google's JavaScript style guide use the same rule.
- **Discarded:** camelCase (`vncClient.ts`), used by the TypeScript compiler itself.

### Node 24 everywhere (Oct 10)

- **Choice:** Node 24 locally and in deployment (`engines` and `.nvmrc`), `@types/node` pinned to 24. TypeScript
  files run directly on Node, with no build step.
- **Why:** it is the version installed here, so what we test locally is what runs in deployment.
- **Discarded:** Node 22, which would need a second Node install to test honestly.

## Ambiguities and what I decided

## Experiment log

### E1. Websocket subprotocol (Oct 10, 13:42)

- **Hypothesis:** the desktop's websockify accepts a connection that offers no subprotocol.
- **Why it matters:** Node's WebSocket follows the WHATWG spec. If we offer `binary` and the server does not choose
  it, the connection fails. If the server requires `binary` and we offer nothing, the server refuses us.
- **Probe:** `npm run probe:screenshot` with `webSocketSubprotocols: []` (`src/vnc/config.ts`). If it fails to open,
  repeat with `['binary']`.
- **Result:** confirmed. With no subprotocol offered, the websocket opened, the VNC login succeeded and the server
  sent a full 1280x800 screen (`artifacts/probe/screenshot-2026-10-10T18-42-42.977Z.png`, 24 KB as PNG). Colours are
  correct, so the pixel format we set is applied. Side finding: the server draws the mouse pointer into the image,
  where it can cover text. The Cursor pseudo-encoding (RFC 6143 section 7.8.1) would send it separately.
- **Timing (second run, 13:52, from Colombia to the Railway-hosted desktop):** login 1840 ms, one full raw screen
  1571 ms. A task has 5 minutes, so a full screen after every action costs real time. Asking only for changed areas
  (incremental updates) is the first thing to measure if steps turn out slow.
