// Maps text and key names to X11 keysyms, the key codes VNC sends (RFC 6143 section 7.5.4).
// Source: X11 keysymdef.h. Latin-1 characters use their own code point as keysym; any other Unicode character uses
// 0x01000000 plus its code point.

export const NAMED_KEYS = {
  Enter: 0xff0d,
  Tab: 0xff09,
  Escape: 0xff1b,
  Backspace: 0xff08,
  Delete: 0xffff,
  Home: 0xff50,
  End: 0xff57,
  PageUp: 0xff55,
  PageDown: 0xff56,
  ArrowLeft: 0xff51,
  ArrowUp: 0xff52,
  ArrowRight: 0xff53,
  ArrowDown: 0xff54,
  Control: 0xffe3,
  Shift: 0xffe1,
  Alt: 0xffe9,
} as const;

export type KeyName = keyof typeof NAMED_KEYS;

const UNICODE_KEYSYM_OFFSET = 0x01000000;

export function isKeyName(name: string): name is KeyName {
  return Object.hasOwn(NAMED_KEYS, name);
}

// Example: "a" is 0x61, "ñ" is 0xf1, "€" is 0x10020ac, a line break is Enter.
export function keysymForCharacter(character: string): number {
  if (character === '\n') return NAMED_KEYS.Enter;
  if (character === '\t') return NAMED_KEYS.Tab;
  const codePoint = character.codePointAt(0);
  const isSingleCharacter = codePoint !== undefined && String.fromCodePoint(codePoint) === character;
  if (!isSingleCharacter) throw new Error(`Expected one character, got ${JSON.stringify(character)}`);
  const isPrintableLatin1 = (codePoint >= 0x20 && codePoint <= 0x7e) || (codePoint >= 0xa0 && codePoint <= 0xff);
  if (isPrintableLatin1) return codePoint;
  if (codePoint < 0xa0) throw new Error(`Cannot type control character U+${codePoint.toString(16).padStart(4, '0')}`);
  return UNICODE_KEYSYM_OFFSET + codePoint;
}
