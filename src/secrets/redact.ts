// Last line of defence before anything is printed, logged or reported: replaces every known secret value with a
// marker, and in summaries also anything shaped like a key or token. Our own messages never include secrets; this
// catches text we do not control, like a server's error message or a key the model copied from the screen.
// Even a very short secret is replaced: garbled text costs less than a leaked password.

const REDACTED = '[redacted]';

export function redact(text: string, secrets: ReadonlyArray<string | undefined>): string {
  return secrets
    .filter((secret): secret is string => secret !== undefined && secret.length > 0)
    .reduce((result, secret) => result.replaceAll(secret, REDACTED), text);
}

// A key or token: 8 or more characters of letters, digits, "-" or "_" where some dash-separated part has a letter right
// after a digit ("XYZ-7F3A-91QD", "sk-or-v1-0a1b2c"), or a long mixed run of 20 or more. Ordinary ids and user
// names put letters first and digits after ("INV-10218", "TRF-550217", "caja03") and are not touched, nor are dates,
// amounts or phone numbers.
const TOKEN = /[A-Za-z0-9_-]{8,}/g;
const MIXED_PART = /\d[A-Za-z]/;
const LONG_MIXED_RUN = 20;

export function redactKeyLikeTokens(text: string): string {
  return text.replace(TOKEN, (token) => (looksLikeKey(token) ? REDACTED : token));
}

function looksLikeKey(token: string): boolean {
  const parts = token.split(/[-_]/);
  const isLongMixedRun = token.length >= LONG_MIXED_RUN && /[A-Za-z]/.test(token) && /\d/.test(token);
  return isLongMixedRun || parts.some((part) => MIXED_PART.test(part));
}
