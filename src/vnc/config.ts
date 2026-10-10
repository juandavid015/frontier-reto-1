// Values we chose and may tune. Protocol constants live in rfb-protocol.ts.

export const vncConfig = {
  connectTimeoutMs: 10_000,
  handshakeTimeoutMs: 10_000,
  // A full 1280x800 raw frame is about 4 MB, so give a slow link time.
  screenshotTimeoutMs: 20_000,
  // No single read may be larger. A 4K screen is 33 MB; a server claiming more is broken or hostile, and holding it
  // in memory could crash the process.
  maxReadBytes: 64 * 1024 * 1024,
  // Some servers answer a request for changes at once with an empty update. Waiting before asking again keeps that
  // from becoming a busy loop over the network.
  emptyUpdateRetryMs: 50,
  // Empty means no subprotocol is offered. See NOTES.md, "Experiment log", for what the desktop accepts.
  webSocketSubprotocols: [] as string[],
  // We ask for 32-bit little-endian true colour, so each pixel arrives as blue, green, red, unused.
  pixelFormat: {
    bitsPerPixel: 32,
    depth: 24,
    bigEndian: false,
    trueColour: true,
    redMax: 255,
    greenMax: 255,
    blueMax: 255,
    redShift: 16,
    greenShift: 8,
    blueShift: 0,
  },
};
