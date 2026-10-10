import type { Action } from './actions.ts';
import type { CommitGuard } from './commit-guard.ts';
import type { RowLedger } from './row-ledger.ts';
import type { Estado } from './run-task.ts';

// Plain code decides whether the model's finish is accepted. A refused finish goes back to the model with the reason.
// fallida is always accepted: an honest failure is never blocked.

type Finish = Extract<Action, { kind: 'finish' }>;
export type TaskEnd = { estado: Estado; summary: string; answer?: string | undefined };
export type FinishDecision = { accepted: true; end: TaskEnd } | { accepted: false; reason: string };

export function checkFinish(action: Finish, ledger: RowLedger, guard: CommitGuard): FinishDecision {
  if (action.estado === 'fallida') return { accepted: true, end: { estado: 'fallida', summary: action.summary } };
  const pending = guard.pendingVerification;
  if (pending) return { accepted: false, reason: `the commit on "${pending}" is not verified; read the stored record` };
  const hasAnswer = action.answer !== undefined && action.answer.trim() !== '';
  // Run 5: rows were read for a question, then terminada came with no count and no answer, and was accepted.
  if (!action.count && !hasAnswer && ledger.hasRows) {
    return { accepted: false, reason: 'rows were read with read_rows but the finish has no count and no answer' };
  }
  if (!action.count) {
    return { accepted: true, end: { estado: 'terminada', summary: action.summary, answer: action.answer } };
  }
  return checkCount(action, action.count, ledger);
}

function checkCount(action: Finish, count: NonNullable<Finish['count']>, ledger: RowLedger): FinishDecision {
  const { table, where } = count;
  const result = ledger.count(table, where);
  if (result.rowsRead === 0) return { accepted: false, reason: `no rows were read into "${table}" with read_rows` };
  if (result.missingColumns.length > 0) {
    return { accepted: false, reason: `no row read has the column(s) ${result.missingColumns.join(', ')}` };
  }
  // Run 5: three full pages were counted and nothing proved there was no fourth.
  if (!ledger.endOfListEvidence(table)) {
    return {
      accepted: false,
      reason:
        'nothing proves every page was read: read the last page (it is usually shorter), give the total the app ' +
        'shows in total_shown, or press next and read the page again with after_next',
    };
  }
  const conditions = Object.entries(where)
    .map(([column, value]) => `${column} = "${value}"`)
    .join(' and ');
  const summary = `${action.summary} Counted by code: ${result.count} of ${result.rowsRead} rows read where ${conditions}.`;
  return { accepted: true, end: { estado: 'terminada', summary, answer: String(result.count) } };
}
