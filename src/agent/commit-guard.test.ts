import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CommitGuard } from './commit-guard.ts';

test('the first commit on a record is allowed', () => {
  assert.deepEqual(new CommitGuard().checkCommit('client CL-0007'), { allowed: true });
});

test('the same record is never committed twice, even after verifying', () => {
  const guard = new CommitGuard();
  guard.recordCommit('client CL-0007', 860, 380);
  guard.markVerified();
  assert.equal(guard.checkCommit('Client  CL-0007').allowed, false);
});

test('a second record waits until the first commit is verified', () => {
  const guard = new CommitGuard();
  guard.recordCommit('client CL-0007', 860, 380);
  assert.equal(guard.checkCommit('client CL-0008').allowed, false);
  guard.markVerified();
  assert.equal(guard.checkCommit('client CL-0008').allowed, true);
});

test('an unflagged click on the same button as an unverified commit is refused', () => {
  const guard = new CommitGuard();
  guard.recordCommit('new client Papelería Los Andes', 860, 380);
  assert.equal(guard.checkClick(865, 376).allowed, false);
  assert.equal(guard.checkClick(200, 48).allowed, true);
  guard.markVerified();
  assert.equal(guard.checkClick(865, 376).allowed, true);
});
