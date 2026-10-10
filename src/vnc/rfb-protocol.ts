// Fixed values from RFC 6143 (The Remote Framebuffer Protocol). They never change; tunable values live in config.ts.

export const PROTOCOL_VERSION_LENGTH = 12;
export const MIN_MINOR_VERSION = 3;
// We speak 3.8. Servers that announce a higher minor (Apple sends 3.889) get 3.8, as the RFC allows.
export const CLIENT_MINOR_VERSION = 8;

export const SecurityType = {
  invalid: 0,
  none: 1,
  vncAuthentication: 2,
} as const;

export const SECURITY_RESULT_OK = 0;
export const VNC_CHALLENGE_LENGTH = 16;

// ClientInit: 1 asks the server to keep other viewers connected (shared session).
export const SHARED_FLAG = 1;

export const ClientMessage = {
  setPixelFormat: 0,
  setEncodings: 2,
  framebufferUpdateRequest: 3,
  keyEvent: 4,
  pointerEvent: 5,
} as const;

// PointerEvent button mask: bit 0 is the left button; bits 3 and 4 are one wheel step up and down.
export const PointerButton = {
  none: 0,
  left: 1,
  wheelUp: 8,
  wheelDown: 16,
} as const;

export const ServerMessage = {
  framebufferUpdate: 0,
  setColourMapEntries: 1,
  bell: 2,
  serverCutText: 3,
} as const;

export const Encoding = {
  raw: 0,
  desktopSize: -223,
  // Section 7.8.1: the server sends the pointer's shape apart instead of painting it into the screen.
  cursor: -239,
} as const;

export const PIXEL_FORMAT_LENGTH = 16;
export const BYTES_PER_COLOUR_MAP_ENTRY = 6;
