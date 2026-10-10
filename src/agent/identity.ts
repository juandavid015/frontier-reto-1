// Who is the task about? Plain code decides from the candidates the model copied from a search result.
// 1. Only candidates whose identifiers include every other identifier the task gives (document, id) stay.
// 2. An exact name match wins: "Comercial Alba" picks "Comercial Alba", not "Comercial Alba Norte".
// 3. With no exact match, a task may give a shorter form of a name (fewer surnames): exactly one candidate whose name
//    contains every word of the task's name is that record. Two or more is ambiguous.
// Names compare as whole words, ignoring case and accents. Nothing is chosen unless the whole result list was seen.

export type Candidate = { record_id: string; full_name: string; identifiers: string[] };

export type IdentityRequest = {
  name: string;
  other_identifiers: string[];
  candidates: Candidate[];
  list_complete: boolean;
};

export type IdentityDecision =
  { chosen: Candidate; how: 'exact name' | 'shorter form of the name' } | { chosen: undefined; reason: string };

export function resolveIdentity(request: IdentityRequest): IdentityDecision {
  if (!request.list_complete) {
    return { chosen: undefined, reason: 'the whole result list was not seen; scroll or page through it first' };
  }
  const wanted = words(request.name);
  if (wanted.length === 0) return { chosen: undefined, reason: 'the task gives no name to match' };
  const pool = request.candidates.filter((candidate) => hasAllIdentifiers(candidate, request.other_identifiers));
  if (pool.length === 0) return { chosen: undefined, reason: `no candidate matches ${describeTask(request)}` };

  const exact = pool.filter((candidate) => sameWords(words(candidate.full_name), wanted));
  if (exact.length === 1) return { chosen: exact[0]!, how: 'exact name' };
  if (exact.length > 1) return { chosen: undefined, reason: `ambiguous: ${list(exact)}` };

  const longer = pool.filter((candidate) => containsAll(words(candidate.full_name), wanted));
  if (longer.length === 1) return { chosen: longer[0]!, how: 'shorter form of the name' };
  if (longer.length > 1) return { chosen: undefined, reason: `ambiguous: ${list(longer)}` };
  return { chosen: undefined, reason: `no candidate matches ${describeTask(request)}` };
}

function hasAllIdentifiers(candidate: Candidate, required: string[]): boolean {
  const own = new Set([candidate.record_id, ...candidate.identifiers].map(compact));
  return required
    .map(compact)
    .filter((id) => id !== '')
    .every((id) => own.has(id));
}

// "Ríos  Vargas," -> ["rios", "vargas"]
function words(text: string): string[] {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== '');
}

// Identifiers compare without spaces, dots or dashes: "41.222.333" equals "41222333".
function compact(identifier: string): string {
  return identifier.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

function sameWords(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((word, index) => word === b[index]);
}

function containsAll(haystack: string[], needles: string[]): boolean {
  return needles.every((needle) => haystack.includes(needle));
}

function list(candidates: Candidate[]): string {
  return candidates.map((candidate) => `${candidate.full_name} (${candidate.record_id})`).join('; ');
}

function describeTask(request: IdentityRequest): string {
  const ids = request.other_identifiers.length > 0 ? ` with ${request.other_identifiers.join(', ')}` : '';
  return `"${request.name}"${ids}`;
}
