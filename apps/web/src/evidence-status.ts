import type { AiRun, RunManualReview, Task } from '@forgeflow/contracts';

type VerificationTone = 'pass' | 'fail' | '';

const reportedStatusLabel = {
  PASS: '通过', FAIL: '失败', NOT_RUN: '未执行', SKIPPED: '已跳过', ERROR: '异常',
} as const;

export function latestRun(runs: readonly AiRun[]): AiRun | undefined {
  return runs.reduce<AiRun | undefined>((latest, run) =>
    !latest || Date.parse(run.createdAt) > Date.parse(latest.createdAt) ? run : latest, undefined);
}

function localManualReview(run: AiRun): RunManualReview | null {
  const review = run.verificationSummary?.manualReview;
  return review && ['OWNER', 'LOCAL_WEB'].includes(String(review.recordedBy))
    && Array.isArray(review.evidenceRefs) && review.evidenceRefs.length > 0 ? review : null;
}

export function hasCurrentLocalReview(run: AiRun): boolean {
  const review = localManualReview(run);
  return run.status === 'SUBMITTED' && run.designSnapshotStatus === 'CURRENT'
    && Boolean(review && (review.decision !== 'PASS' || run.verificationSummary?.reportedStatus === 'PASS'));
}

export function currentLocalReviewVerdict(run: AiRun): 'PASS' | 'FAIL' | null {
  if (!hasCurrentLocalReview(run)) return null;
  return localManualReview(run)!.decision;
}

export function runVerificationTone(run: AiRun): VerificationTone {
  const verdict = currentLocalReviewVerdict(run);
  if (verdict === 'PASS') return 'pass';
  if (verdict === 'FAIL') return 'fail';
  return '';
}

export function runVerificationLabel(run: AiRun): string {
  const evidence = run.verificationSummary;
  if (!evidence) return '最近执行未报告';

  const verdict = reportedStatusLabel[evidence.reportedStatus];
  const source = evidence.origin === 'AI_REPORTED' ? 'AI 自报'
    : evidence.origin === 'HUMAN' ? '人工报告'
      : evidence.origin === 'LOCAL_CAPTURED' ? '本地采集报告'
        : evidence.trustStatus === 'HISTORICAL_UNATTESTED' ? 'CI 标记' : 'CI 报告';
  const result = `${source}${verdict}`;
  const manualReview = localManualReview(run);
  const imported = evidence.manualReview?.recordedBy === 'IMPORTED';
  const conclusion = manualReview ? `本机复核${manualReview.decision === 'PASS' ? '通过' : '未通过'} · 原报告：${result}`
    : imported ? `导入复核标记（来源未核验） · 原报告：${result}` : result;
  const trustNote = evidence.trustStatus === 'HISTORICAL_UNATTESTED' && !manualReview && !imported ? ' · 来源未核验' : '';
  if (run.designSnapshotStatus === 'STALE') return `历史 · ${conclusion}${trustNote}`;
  if (run.designSnapshotStatus === 'UNKNOWN') return `${conclusion} · 版本未知${trustNote}`;
  if (manualReview) return conclusion;
  if (trustNote) return `${conclusion}${trustNote}`;
  return evidence.reportedStatus === 'PASS' ? `${conclusion} · 待独立核验` : conclusion;
}

export function runVerificationContext(run: AiRun, isLatest = true): string {
  if (!isLatest) return '较早执行 · 不计当前核验';
  if (run.designSnapshotStatus === 'STALE') return '设计已变更 · 不计当前核验';
  if (run.designSnapshotStatus === 'UNKNOWN') return '设计版本未知 · 不计当前核验';
  const review = localManualReview(run);
  if (review) return `当前设计 · 本机复核记录（${review.recordedBy === 'LOCAL_WEB' ? '本机操作' : 'Owner 凭据'}）`;
  if (run.verificationSummary?.manualReview?.recordedBy === 'IMPORTED') return '当前设计 · 导入记录来源未核验';
  if (run.verificationSummary?.trustStatus === 'HISTORICAL_UNATTESTED') return '当前设计 · CI 来源未核验';
  return '当前设计 · 尚无独立核验';
}

export function taskImplementationLabel(tasks: readonly Task[], runs: readonly AiRun[]): string {
  const done = tasks.filter((task) => task.status === 'DONE' || task.status === 'CONFIRMED');
  if (!done.length) return `0/${tasks.length} 任务`;
  const doneIds = new Set(done.map((task) => task.id));
  const run = latestRun(runs.filter((item) => doneIds.has(item.taskId)));
  const prefix = done.length === tasks.length ? '' : `${done.length}/${tasks.length} 任务 · `;
  if (!run) return `${prefix}状态已登记，缺实施证据`;
  if (run.actorType === 'AI_TOKEN' || run.verificationSummary?.origin === 'AI_REPORTED') {
    const reviewed = hasCurrentLocalReview(run) ? localManualReview(run) : null;
    if (run.designSnapshotStatus === 'STALE') return `${prefix}AI 报告已实施 · 设计已变更`;
    if (reviewed) return `${prefix}AI 报告已实施 · 本机复核${reviewed.decision === 'PASS' ? '通过' : '未通过'}`;
    return `${prefix}AI 报告已实施 · 待复核`;
  }
  return `${prefix}实施记录已登记 · 待核对`;
}
