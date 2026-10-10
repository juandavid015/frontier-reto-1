import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';

// AGENTS.md: nothing from the practice app lives in src/ or in prompts, or the agent is fitted to one app. This test
// gathers the practice app's names from pruebas/ (people, companies, ids, values, reason keys) and fails if any of
// them appears in our source, tests included.

const CASES_DIRECTORY = 'pruebas';
const SOURCE_DIRECTORY = 'src';
// Names seen on the practice app's screen, not in the cases. Kept outside src/ so this file holds no names itself.
const APP_NAMES_FILE = path.join('evals', 'practice-app-names.json');
// Two or more capitalized words, with lowercase connectors between them: "Tienda Sol", "Casa de la Moneda".
const PROPER_NAME = /\p{Lu}[\p{L}]+(?:\s+(?:(?:de|del|la|las|los|el|e|y)\s+)?\p{Lu}[\p{L}]+)+/gu;
const IGNORED_IDS = new Set(['nuevo', '*']);
const MIN_TERM_LENGTH = 4;

type Case = {
  instruccion: string;
  claves_razon?: string[];
  diff_esperado: Array<{ id?: unknown; valor?: unknown }>;
};

async function practiceTerms(): Promise<string[]> {
  const files = (await readdir(CASES_DIRECTORY)).filter((file) => file.endsWith('.json'));
  const terms = new Set(JSON.parse(await readFile(APP_NAMES_FILE, 'utf8')) as string[]);
  for (const file of files) {
    const evalCase = JSON.parse(await readFile(path.join(CASES_DIRECTORY, file), 'utf8')) as Case;
    for (const name of evalCase.instruccion.match(PROPER_NAME) ?? []) terms.add(name);
    for (const key of evalCase.claves_razon ?? []) terms.add(key);
    for (const change of evalCase.diff_esperado) {
      if (typeof change.id === 'string' && !IGNORED_IDS.has(change.id)) terms.add(change.id);
      if (typeof change.valor === 'string') terms.add(change.valor);
    }
  }
  return [...terms].filter((term) => term.length >= MIN_TERM_LENGTH);
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true, recursive: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => path.join(entry.parentPath, entry.name));
}

test('the practice cases yield the names this test guards against', async () => {
  const terms = await practiceTerms();
  // If parsing pruebas/ silently found nothing, the next test would pass for the wrong reason.
  assert.ok(terms.length >= 10, `only ${terms.length} terms found: ${terms.join(', ')}`);
});

test('no name from the practice app appears in src/', async () => {
  const terms = await practiceTerms();
  const found: string[] = [];
  for (const file of await sourceFiles(SOURCE_DIRECTORY)) {
    const text = await readFile(file, 'utf8');
    for (const term of terms) if (text.includes(term)) found.push(`${file}: "${term}"`);
  }
  assert.deepEqual(found, []);
});
