// Last line of defence before anything is printed or logged: replaces every known secret value with a marker.
// Our own messages never include secrets; this catches text we do not control, like a server's error message.
// Even a very short secret is replaced: garbled text costs less than a leaked password.

const REDACTED = '[redacted]';

export function redact(text: string, secrets: ReadonlyArray<string | undefined>): string {
  return secrets
    .filter((secret): secret is string => secret !== undefined && secret.length > 0)
    .reduce((result, secret) => result.replaceAll(secret, REDACTED), text);
}
