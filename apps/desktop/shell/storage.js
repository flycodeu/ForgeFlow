const $ = (id) => document.getElementById(id);
const invoke = (...args) => window.__TAURI__.core.invoke(...args);
let snapshot; let initialized = false; let submitting = false; let completed = false; let lastPayload = ''; let firstChoice = false;
const labels = { validating: '正在检查目录…', stopping: '正在保存并停止后台…', copying: '正在复制数据，原目录保持不变…', verifying: '正在校验文件与数据库…', starting: '正在验证新目录能否启动…', committing: '正在保存新位置…', rollback: '未能切换，正在恢复原目录…' };
function render(state) {
  const wasBusy = snapshot?.busy; snapshot = state;
  if (wasBusy && !state.busy && !state.error && state.ready) completed = true;
  const info = state.info; if (!info) return;
  const first = info.type === 'setup-required'; const busy = submitting || state.busy;
  $('heading').textContent = first ? '选择数据存储位置' : '数据存储位置';
  $('intro').textContent = first ? '首次使用，请先确定项目数据保存在哪里。' : '程序安装目录与项目数据目录相互独立。';
  $('current-section').hidden = first; $('current').textContent = info.dataPath || '';
  $('config').textContent = info.configPath || '由启动环境指定';
  if (!initialized) { $('target').value = first ? info.suggestedPath || '' : ''; initialized = true; }
  $('legacy-section').hidden = !first || !info.existingPath; $('legacy').textContent = info.existingPath || '';
  $('migration-ack').hidden = first; $('retention').hidden = first;
  $('submit').textContent = first ? '使用此目录' : '迁移到此目录';
  $('close').textContent = state.ready ? '返回项目' : '退出';
  for (const id of ['target','browse','submit','reuse','ack','use-legacy']) $(id).disabled = busy || !!info.override;
  $('close').disabled = busy;
  $('status').textContent = info.override ? '当前由启动环境指定目录，不能在此迁移。' : busy ? labels[state.stage] || '正在处理…' : completed ? firstChoice ? '数据目录已保存。' : '数据目录已切换，原目录仍保留。' : '';
  $('error').textContent = state.error || '';
}
async function refresh() {
  try { const state = await invoke('storage_snapshot'); const payload = JSON.stringify(state); if (payload !== lastPayload) { lastPayload = payload; render(state); } } catch (error) { $('error').textContent = String(error); }
}
$('browse').onclick = async () => { try { const path = await invoke('storage_pick'); if (path) $('target').value = path; } catch (error) { $('error').textContent = String(error); } };
$('use-legacy').onclick = () => { $('target').value = snapshot.info.existingPath; $('reuse').checked = false; };
$('storage-form').onsubmit = async (event) => {
  event.preventDefault(); if (!snapshot?.info || snapshot.busy || submitting) return;
  const first = snapshot.info.type === 'setup-required';
  firstChoice = first;
  if (!first && !$('ack').checked) { $('error').textContent = '请先确认已保存编辑内容，并同意迁移。'; return; }
  submitting = true; completed = false; render(snapshot);
  try { await invoke('storage_apply', { path: $('target').value.trim(), reuseExisting: first && $('reuse').checked }); }
  catch (error) { $('error').textContent = String(error); }
  finally { submitting = false; lastPayload = ''; await refresh(); }
};
$('close').onclick = () => invoke('storage_close').catch(error => { $('error').textContent = String(error); });
async function poll() { if (!document.hidden) await refresh(); setTimeout(poll, 700); }
void poll();
