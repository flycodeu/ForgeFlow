import assert from 'node:assert/strict';
import { test } from 'node:test';
import { currentLocalReviewVerdict, latestRun, runVerificationLabel, runVerificationTone, taskImplementationLabel } from './evidence-status.ts';

const report = (overrides = {}) => ({
  id: 'run-1', taskId: 'task-1', actorType: 'AI_TOKEN', status: 'SUBMITTED', createdAt: '2026-09-30T00:00:00Z',
  designSnapshotStatus: 'CURRENT', verificationSummary: {
    status: 'PASS', reportedStatus: 'PASS', origin: 'AI_REPORTED', evidenceStatus: 'REPORTED', summary: 'AI says tests passed',
  }, ...overrides,
});
const task = { id: 'task-1', status: 'DONE' };

test('AI PASS is a report, never a current independent pass', () => {
  const current = report();
  const stale = report({ designSnapshotStatus: 'STALE' });
  assert.match(runVerificationLabel(current), /AI 自报通过.*待独立核验/);
  assert.equal(runVerificationTone(current), '');
  assert.equal(currentLocalReviewVerdict(current), null);
  assert.match(runVerificationLabel(stale), /^历史 · AI 自报通过/);
  assert.equal(runVerificationTone(stale), '');
});

test('historical CI marker stays untrusted; only current local review contributes a pass', () => {
  const ci = report({ verificationSummary: { ...report().verificationSummary, origin: 'CI', evidenceStatus: 'VERIFIED', trustStatus: 'HISTORICAL_UNATTESTED' } });
  const local = report({ verificationSummary: { ...report().verificationSummary, manualReview: {
    decision: 'PASS', summary: 'Checked linked source', evidenceRefs: [{ kind: 'HTTPS_URL', url: 'https://example.com/evidence' }], recordedBy: 'LOCAL_WEB', recordedAt: '2026-10-01T00:00:00Z',
  } } });
  assert.equal(currentLocalReviewVerdict(ci), null);
  assert.equal(runVerificationTone(ci), '');
  assert.match(runVerificationLabel(ci), /CI 标记通过.*来源未核验/);
  assert.equal(currentLocalReviewVerdict(local), 'PASS');
  assert.equal(runVerificationTone(local), 'pass');
  assert.match(runVerificationLabel(local), /本机复核通过.*原报告：AI 自报通过/);
  assert.equal(runVerificationTone({ ...local, designSnapshotStatus: 'STALE' }), '');
  assert.equal(runVerificationTone({ ...local, verificationSummary: { ...local.verificationSummary, manualReview: {
    ...local.verificationSummary.manualReview, recordedBy: 'IMPORTED',
  } } }), '');
});

test('a later unreported run supersedes an earlier pass', () => {
  const newer = report({ id: 'run-2', createdAt: '2026-10-01T00:00:00Z', verificationSummary: null });
  assert.equal(latestRun([newer, report()])?.id, 'run-2');
  assert.equal(runVerificationLabel(newer), '最近执行未报告');
});

test('DONE task with no run is a state entry; AI run remains a reported implementation', () => {
  assert.equal(taskImplementationLabel([task], []), '状态已登记，缺实施证据');
  assert.equal(taskImplementationLabel([task], [report()]), 'AI 报告已实施 · 待复核');
  assert.equal(taskImplementationLabel([task], [report({ designSnapshotStatus: 'STALE' })]), 'AI 报告已实施 · 设计已变更');
});
