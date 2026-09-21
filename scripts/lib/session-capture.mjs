import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, realpathSync, statSync } from 'node:fs';
import { open, readdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { adaptRecord, belongsToWorkspace, hash, redact } from './session-adapters.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const defaults = { maxQueueBytes: 32 * 1024 * 1024, maxQueueItems: 10000 };
export function validateCaptureConfig(input) {
  if (!input || input.version !== 1 || typeof input.enabled !== 'boolean' || !UUID.test(input.projectId)) throw new Error('INVALID_CAPTURE_CONFIG');
  const url = new URL(input.serverUrl);
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('LOCAL_SERVER_URL_REQUIRED');
  if (!isAbsolute(input.workspaceRoot) || !Array.isArray(input.sources) || input.sources.length > 8) throw new Error('INVALID_CAPTURE_PATHS');
  if (input.enabled && input.sources.length === 0) throw new Error('SOURCE_DIRECTORY_REQUIRED');
  const sources = input.sources.map((source) => {
    if (!['codex', 'claude'].includes(source.kind) || typeof source.directory !== 'string' || !isAbsolute(source.directory)) throw new Error('INVALID_SOURCE');
    return { kind: source.kind, directory: resolve(source.directory) };
  });
  if (new Set(sources.map((source) => source.directory.toLowerCase())).size !== sources.length) throw new Error('DUPLICATE_SOURCE_DIRECTORY');
  const limits = { ...defaults };
  for (const key of Object.keys(limits)) if (input[key] !== undefined) {
    if (!Number.isInteger(input[key]) || input[key] < 1 || input[key] > defaults[key] * 4) throw new Error('INVALID_QUEUE_LIMIT');
    limits[key] = input[key];
  }
  if (input.includeHistory !== undefined && typeof input.includeHistory !== 'boolean') throw new Error('INVALID_HISTORY_OPTION');
  return { version: 1, enabled: input.enabled, projectId: input.projectId, workspaceRoot: resolve(input.workspaceRoot),
    serverUrl: url.origin, sources, includeHistory: input.includeHistory === true, ...limits };
}

function database(stateDir) {
  if (!isAbsolute(stateDir)) throw new Error('ABSOLUTE_STATE_DIRECTORY_REQUIRED');
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(join(stateDir, 'collector.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sources (path TEXT PRIMARY KEY, offset INTEGER NOT NULL DEFAULT 0, context TEXT NOT NULL DEFAULT '{}', issue TEXT, size INTEGER NOT NULL DEFAULT 0, modified REAL NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS queue (seq INTEGER PRIMARY KEY AUTOINCREMENT, operation_id TEXT UNIQUE NOT NULL, body TEXT NOT NULL, bytes INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_attempt INTEGER NOT NULL DEFAULT 0, issue TEXT, blocked INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS receipts (operation_id TEXT PRIMARY KEY, body_hash TEXT NOT NULL, received TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS leases (name TEXT PRIMARY KEY, owner TEXT NOT NULL, until_ms INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS diagnostics (name TEXT PRIMARY KEY, message TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS metrics (name TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS document_heads (source_path TEXT PRIMARY KEY, observed_hash TEXT NOT NULL, operation_id TEXT NOT NULL, document_id TEXT, revision_id TEXT);
  `);
  const columns = db.prepare('PRAGMA table_info(sources)').all().map((column) => column.name);
  if (!columns.includes('prefix_hash')) db.exec("ALTER TABLE sources ADD COLUMN prefix_hash TEXT; ALTER TABLE sources ADD COLUMN prefix_bytes INTEGER NOT NULL DEFAULT 0;");
  if (!db.prepare('PRAGMA table_info(queue)').all().some((column) => column.name === 'delivery')) db.exec("ALTER TABLE queue ADD COLUMN delivery TEXT NOT NULL DEFAULT '{}';");
  return db;
}
function transaction(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = work(); db.exec('COMMIT'); return result; } catch (error) { db.exec('ROLLBACK'); throw error; }
}
function configOf(db) { const item = db.prepare('SELECT value FROM settings WHERE id=1').get(); return item ? JSON.parse(item.value) : null; }
function summary(db) {
  const queue = db.prepare('SELECT COUNT(*) AS pending, COALESCE(SUM(bytes),0) AS bytes, COALESCE(SUM(blocked),0) AS blocked, MIN(next_attempt) AS nextAttemptAt FROM queue').get();
  const failures = db.prepare('SELECT operation_id AS operationId, attempts, issue, blocked FROM queue WHERE issue IS NOT NULL ORDER BY seq LIMIT 20').all();
  const sources = db.prepare('SELECT path, offset, issue, size FROM sources ORDER BY path').all();
  const diagnostics = db.prepare('SELECT name, message FROM diagnostics ORDER BY name').all();
  const metric = (key) => db.prepare('SELECT value FROM metrics WHERE name=?').get(key)?.value ?? null;
  return { configured: Boolean(configOf(db)), config: configOf(db), ...queue,
    pendingCount: queue.pending, blockedCount: queue.blocked, queueBytes: queue.bytes, filesSeen: sources.length,
    lastError: failures[0]?.issue ?? sources.find((item) => item.issue)?.issue ?? diagnostics[0]?.message ?? null,
    lastPollAt: metric('lastPollAt'), lastSuccessAt: metric('lastSuccessAt'),
    delivered: db.prepare('SELECT COUNT(*) AS count FROM receipts').get().count,
    failures, sources, diagnostics };
}
export function captureStatus(stateDir) { const db = database(stateDir); try { return summary(db); } finally { db.close(); } }
export function configureCapture(stateDir, input) {
  const config = validateCaptureConfig(input);
  const db = database(stateDir);
  try {
    transaction(db, () => {
      const old = configOf(db);
      if (old && (old.projectId !== config.projectId || old.workspaceRoot !== config.workspaceRoot)) throw new Error('CAPTURE_BINDING_IMMUTABLE_USE_NEW_STATE_DIRECTORY');
      if (db.prepare('SELECT 1 FROM leases WHERE until_ms>?').get(Date.now())) throw new Error('CAPTURE_BUSY');
      config.since = old?.since ?? new Date().toISOString();
      if (old && old.includeHistory !== config.includeHistory && db.prepare('SELECT 1 FROM sources LIMIT 1').get()) throw new Error('HISTORY_MODE_IMMUTABLE_USE_NEW_STATE_DIRECTORY');
      db.prepare('INSERT INTO settings VALUES (1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value').run(JSON.stringify(config));
    });
    return summary(db);
  } finally { db.close(); }
}
function lease(db, name) {
  const owner = randomUUID();
  const acquired = transaction(db, () => {
    const row = db.prepare('SELECT * FROM leases WHERE name=?').get(name);
    if (row && row.until_ms > Date.now()) return false;
    db.prepare('INSERT INTO leases VALUES (?,?,?) ON CONFLICT(name) DO UPDATE SET owner=excluded.owner,until_ms=excluded.until_ms').run(name, owner, Date.now() + 120000);
    return true;
  });
  if (!acquired) return null;
  return { renew: () => db.prepare('UPDATE leases SET until_ms=? WHERE name=? AND owner=?').run(Date.now() + 120000, name, owner),
    release: () => db.prepare('DELETE FROM leases WHERE name=? AND owner=?').run(name, owner) };
}
function enqueue(db, config, body) {
  const serialized = JSON.stringify(body);
  const prior = db.prepare('SELECT body FROM queue WHERE operation_id=?').get(body.operationId);
  const receipt = db.prepare('SELECT body_hash FROM receipts WHERE operation_id=?').get(body.operationId);
  if (prior || receipt) {
    if ((prior && prior.body !== serialized) || (receipt && receipt.body_hash !== hash(serialized))) throw new Error('LOCAL_OPERATION_CONFLICT');
    return;
  }
  const bytes = Buffer.byteLength(serialized);
  const count = db.prepare('SELECT COUNT(*) AS count,COALESCE(SUM(bytes),0) AS bytes FROM queue').get();
  if (count.count + 1 > config.maxQueueItems || count.bytes + bytes > config.maxQueueBytes) throw new Error('QUEUE_FULL');
  db.prepare('INSERT INTO queue(operation_id,body,bytes,created) VALUES (?,?,?,?)').run(body.operationId, serialized, bytes, new Date().toISOString());
}
export function enqueueWork(stateDir, input) {
  const db = database(stateDir);
  try {
    const config = configOf(db); if (!config) throw new Error('CAPTURE_NOT_CONFIGURED');
    if (typeof input.operationId !== 'string' || input.operationId.length > 128 || !input.operationId.length
      || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 200 || typeof input.content !== 'string' || input.content.length > 100000
      || !['PLAN', 'PROGRESS', 'DESIGN', 'RESULT', 'NOTE'].includes(input.type)) throw new Error('INVALID_WORK_EVENT');
    if ((input.workId !== undefined && (typeof input.workId !== 'string' || input.workId.length > 128))
      || (input.occurredAt !== undefined && (typeof input.occurredAt !== 'string' || Number.isNaN(Date.parse(input.occurredAt))))
      || (input.documentRevisionIds !== undefined && (!Array.isArray(input.documentRevisionIds) || input.documentRevisionIds.length > 100
        || input.documentRevisionIds.some((id) => typeof id !== 'string' || id.length > 128)))) throw new Error('INVALID_WORK_EVENT_REFERENCE');
    const body = { operationId: input.operationId, type: input.type, title: redact(input.title), content: redact(input.content),
      ...(input.workId ? { workId: input.workId } : {}), ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
      ...(input.documentRevisionIds ? { documentRevisionIds: input.documentRevisionIds } : {}) };
    transaction(db, () => enqueue(db, config, body)); return { queued: true, operationId: body.operationId };
  } finally { db.close(); }
}
export function documentQueueHead(stateDir, sourcePath) {
  const db = database(stateDir);
  try { return db.prepare('SELECT * FROM document_heads WHERE source_path=?').get(sourcePath) ?? null; } finally { db.close(); }
}
export function enqueueDocument(stateDir, input, baseline = null) {
  const db = database(stateDir);
  try {
    const config = configOf(db); if (!config) throw new Error('CAPTURE_NOT_CONFIGURED');
    if (typeof input.sourcePath !== 'string' || !isAbsolute(input.sourcePath) || input.sourcePath.length > 2048
      || typeof input.originalFilename !== 'string' || input.originalFilename.length > 512 || typeof input.content !== 'string' || input.content.length > 500000
      || typeof input.title !== 'string' || !input.title.trim() || input.title.length > 200
      || !['text/markdown', 'text/plain'].includes(input.contentType)) throw new Error('INVALID_DOCUMENT_SNAPSHOT');
    return transaction(db, () => {
      const previous = db.prepare('SELECT * FROM document_heads WHERE source_path=?').get(input.sourcePath);
      const observedHash = hash(JSON.stringify(input));
      if (previous?.observed_hash === observedHash) return { queued: false, operationId: previous.operation_id };
      const operationId = `document-${randomUUID()}`;
      const pendingPrevious = previous && db.prepare('SELECT 1 FROM queue WHERE operation_id=?').get(previous.operation_id);
      const body = { operationId, jobKind: 'document', input, previousOperationId: pendingPrevious ? previous.operation_id : null,
        baseline: baseline ?? (previous?.revision_id ? { documentId: previous.document_id, revisionId: previous.revision_id } : null) };
      enqueue(db, config, body);
      db.prepare(`INSERT INTO document_heads(source_path,observed_hash,operation_id,document_id,revision_id) VALUES (?,?,?,?,?)
        ON CONFLICT(source_path) DO UPDATE SET observed_hash=excluded.observed_hash,operation_id=excluded.operation_id`).run(input.sourcePath, observedHash, operationId, previous?.document_id ?? baseline?.documentId ?? null, previous?.revision_id ?? baseline?.revisionId ?? null);
      return { queued: true, operationId };
    });
  } finally { db.close(); }
}
export function adoptDocumentBaseline(stateDir, sourcePath, baseline) {
  if (!baseline?.documentId || !baseline?.revisionId) throw new Error('INVALID_DOCUMENT_BASELINE');
  const db = database(stateDir);
  try {
    transaction(db, () => {
      for (const row of db.prepare('SELECT * FROM queue ORDER BY seq').all()) {
        const body = JSON.parse(row.body);
        if (body.jobKind !== 'document' || body.input.sourcePath !== sourcePath) continue;
        const delivery = JSON.parse(row.delivery);
        if (delivery.savedRevisionId) throw new Error('DOCUMENT_ALREADY_SAVED_RETRY_RECEIPT_ONLY');
        db.prepare('UPDATE queue SET delivery=?,blocked=0,issue=NULL,next_attempt=0 WHERE operation_id=?')
          .run(JSON.stringify({ documentId: baseline.documentId, expectedRevisionId: baseline.revisionId }), row.operation_id);
        return;
      }
    });
  } finally { db.close(); }
}
async function discover(directory, limit = 10000) {
  const root = await realpath(directory);
  const result = [];
  async function visit(dir, depth) {
    if (depth > 12) throw new Error('SOURCE_DEPTH_LIMIT');
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await visit(path, depth + 1);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        if (result.length >= limit) throw new Error('SOURCE_FILE_LIMIT');
        const actual = await realpath(path);
        if (!belongsToWorkspace(actual, root)) throw new Error('SOURCE_PATH_ESCAPE');
        result.push(actual);
      }
    }
  }
  await visit(root, 0); return result.sort();
}
async function pollFile(db, config, source, path) {
  let cursor = db.prepare('SELECT * FROM sources WHERE path=?').get(path);
  const info = await stat(path);
  if (!cursor) { db.prepare('INSERT INTO sources(path) VALUES (?)').run(path); cursor = { offset: 0, context: '{}', size: 0, modified: 0 }; }
  if (info.size < cursor.offset) {
    db.prepare("UPDATE sources SET issue='SOURCE_TRUNCATED' WHERE path=?").run(path); return;
  }
  if (info.size === cursor.offset) {
    if (cursor.modified && info.mtimeMs !== cursor.modified) db.prepare("UPDATE sources SET issue='SOURCE_REWRITTEN' WHERE path=?").run(path);
    return;
  }
  const handle = await open(path, 'r');
  let bytes;
  let prefixHash = cursor.prefix_hash;
  let prefixBytes = cursor.prefix_bytes ?? 0;
  try {
    if (prefixBytes) {
      const prefix = Buffer.alloc(prefixBytes); const read = await handle.read(prefix, 0, prefixBytes, 0);
      if (read.bytesRead !== prefixBytes || hash(prefix) !== prefixHash) { db.prepare("UPDATE sources SET issue='SOURCE_REWRITTEN' WHERE path=?").run(path); return; }
    }
    const chunk = Buffer.alloc(Math.min(info.size - cursor.offset, 4 * 1024 * 1024)); const read = await handle.read(chunk, 0, chunk.length, cursor.offset); bytes = chunk.subarray(0, read.bytesRead);
  }
  finally { await handle.close(); }
  let context = JSON.parse(cursor.context);
  let offset = cursor.offset;
  let start = 0;
  let issue = null;
  transaction(db, () => {
    while (true) {
      const end = bytes.indexOf(10, start);
      if (end < 0) { if (bytes.length - start >= 4 * 1024 * 1024) issue = 'SOURCE_LINE_TOO_LARGE'; break; }
      const raw = bytes.subarray(start, end);
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
        if (!text.trim()) { offset += end - start + 1; start = end + 1; continue; }
        let row; try { row = JSON.parse(text); } catch { throw new Error('MALFORMED_JSONL'); }
        const adapted = adaptRecord(source.kind, row, context);
        const payloads = [];
        if (belongsToWorkspace(adapted.context.cwd, config.workspaceRoot)) {
          for (let index = 0; index < adapted.entries.length; index++) {
            const entry = adapted.entries[index];
            if (!config.includeHistory && (!entry.occurredAt || entry.occurredAt <= config.since)) continue;
            const chunks = entry.content.match(/[\s\S]{1,85000}/g) ?? [''];
            for (let part = 0; part < chunks.length; part++) payloads.push({ ...entry,
              title: `${source.kind === 'codex' ? 'Codex' : 'Claude'} · ${entry.title}${chunks.length > 1 ? ` (${part + 1}/${chunks.length})` : ''}`,
              operationId: `capture-${hash(`${config.projectId}|${source.kind}|${adapted.context.sessionId}|${path}|${offset}|${index}|${part}`)}`,
              content: `会话：${hash(adapted.context.sessionId).slice(0, 16)}\n来源：${source.kind} 本地会话记录\n\n${chunks[part]}` });
          }
        }
        db.exec('SAVEPOINT line');
        try { for (const payload of payloads) enqueue(db, config, payload); db.exec('RELEASE line'); }
        catch (error) { db.exec('ROLLBACK TO line; RELEASE line'); throw error; }
        context = adapted.context; offset += end - start + 1; start = end + 1;
      } catch (error) { issue = /^[A-Z_]+$/.test(error.message) ? error.message : 'SOURCE_READ_ERROR'; break; }
    }
    if (!prefixBytes && offset > 0 && cursor.offset === 0) { prefixBytes = Math.min(offset, 4096); prefixHash = hash(bytes.subarray(0, prefixBytes)); }
    db.prepare('UPDATE sources SET offset=?,context=?,issue=?,size=?,modified=?,prefix_hash=?,prefix_bytes=? WHERE path=?').run(offset, JSON.stringify(context), issue, info.size, info.mtimeMs, prefixHash ?? null, prefixBytes, path);
  });
}
export async function pollCapture(stateDir, options = {}) {
  const db = database(stateDir); let guard;
  try {
    const config = configOf(db); if (!config || !config.enabled) return summary(db);
    guard = lease(db, 'poll'); if (!guard) return { ...summary(db), busy: true };
    // Canonical workspace paths prevent symlinks from widening the selected workspace.
    const workspace = realpathSync(config.workspaceRoot);
    if (!statSync(workspace).isDirectory()) throw new Error('WORKSPACE_NOT_DIRECTORY');
    const deadline = Date.now() + Math.max(100, Math.min(10000, Number(options.timeBudgetMs) || 3000));
    for (const source of config.sources) {
      const key = `source:${source.kind}:${source.directory}`;
      try {
        const files = await discover(source.directory);
        db.prepare('DELETE FROM diagnostics WHERE name=?').run(key);
        if (!files.length) db.prepare('INSERT INTO diagnostics VALUES (?,?)').run(key, 'NO_SESSION_FILES');
        const resumeKey = `resume:${key}`;
        const lastFile = db.prepare('SELECT value FROM metrics WHERE name=?').get(resumeKey)?.value;
        const start = lastFile ? files.indexOf(lastFile) + 1 : 0;
        const ordered = [...files.slice(start), ...files.slice(0, start)];
        let handled = 0;
        for (const path of ordered) {
          if (Date.now() >= deadline || handled >= 100) break;
          guard.renew(); await pollFile(db, { ...config, workspaceRoot: workspace }, source, path); handled++;
          db.prepare('INSERT INTO metrics VALUES (?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value').run(resumeKey, path);
        }
      } catch (error) {
        db.prepare('INSERT INTO diagnostics VALUES (?,?) ON CONFLICT(name) DO UPDATE SET message=excluded.message').run(key,
          /^[A-Z_]+$/.test(error.message) ? error.message : 'SOURCE_UNAVAILABLE');
      }
    }
    db.prepare('INSERT INTO metrics VALUES (?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value').run('lastPollAt', new Date().toISOString());
    return summary(db);
  } finally { guard?.release(); db.close(); }
}
export async function flushCapture(stateDir, options = {}) {
  const db = database(stateDir); let guard;
  try {
    const config = configOf(db); if (!config) return summary(db);
    guard = lease(db, 'flush'); if (!guard) return { ...summary(db), busy: true };
    const fetcher = options.fetch ?? fetch;
    const maxItems = Math.max(1, Math.min(100, Math.floor(Number(options.maxItems) || 20)));
    const deadline = Date.now() + Math.max(100, Math.min(15000, Number(options.timeBudgetMs) || 5000));
    const rows = db.prepare('SELECT * FROM queue ORDER BY seq LIMIT ?').all(maxItems);
    for (const row of rows) {
      if (Date.now() >= deadline) break;
      if (!options.force && (row.blocked || row.next_attempt > Date.now())) continue;
      guard.renew();
      let issue; let blocked = false;
      try {
        const request = async (path, method = 'GET', body) => {
          if (Date.now() >= deadline) throw new Error('TIME_BUDGET');
          const response = await fetcher(`${config.serverUrl}/api/projects/${config.projectId}/archive${path}`, {
            method, headers: { 'Content-Type': 'application/json', ...options.headers,
              ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}) }, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
            signal: AbortSignal.timeout(Math.max(1, Math.min(3000, deadline - Date.now()))), redirect: 'error' });
          return response;
        };
        const body = JSON.parse(row.body);
        let response;
        if (body.jobKind === 'document') {
          if (body.previousOperationId && db.prepare('SELECT 1 FROM queue WHERE operation_id=?').get(body.previousOperationId)) continue;
          response = await deliverDocument(db, row, body, request);
        } else response = await request('/events', 'POST', row.body);
        if (!response.ok) { issue = `HTTP_${response.status}`; blocked = response.status >= 400 && response.status < 500 && ![408, 425, 429].includes(response.status); }
        else {
          const receipt = await response.json();
          if (receipt.committed !== true || !receipt.event?.id || receipt.event.projectId !== config.projectId) issue = 'INVALID_RECEIPT';
          else transaction(db, () => {
            db.prepare('INSERT OR IGNORE INTO receipts VALUES (?,?,?)').run(row.operation_id, hash(row.body), new Date().toISOString());
            db.prepare('DELETE FROM queue WHERE operation_id=?').run(row.operation_id);
            db.prepare('INSERT INTO metrics VALUES (?,?) ON CONFLICT(name) DO UPDATE SET value=excluded.value').run('lastSuccessAt', new Date().toISOString());
          });
        }
      } catch (error) {
        issue = /^(HTTP_[0-9]+|DOCUMENT_BASELINE_REQUIRED|DOCUMENT_VERSION_CONFLICT|DOCUMENT_RECEIPT_INVALID)$/.test(error.message) ? error.message : 'CONNECTION_OR_RECEIPT_FAILED';
        blocked = /^(DOCUMENT_|HTTP_4)/.test(issue) && !['HTTP_408', 'HTTP_425', 'HTTP_429'].includes(issue);
      }
      if (issue) {
        const attempts = row.attempts + 1;
        const wait = Math.min(300000, 1000 * 2 ** Math.min(attempts, 8));
        db.prepare('UPDATE queue SET attempts=?,next_attempt=?,issue=?,blocked=? WHERE operation_id=?').run(attempts, Date.now() + wait, issue, blocked ? 1 : 0, row.operation_id);
        if (!blocked || [ 'HTTP_401', 'HTTP_403' ].includes(issue)) break;
      }
    }
    return summary(db);
  } finally { guard?.release(); db.close(); }
}

async function deliverDocument(db, row, body, request) {
  let delivery = JSON.parse(row.delivery);
  const parse = async (response) => { if (!response.ok) throw new Error(`HTTP_${response.status}`); return response.json(); };
  const input = body.input;
  if (!delivery.savedRevisionId) {
    const list = await parse(await request('/documents'));
    const found = list.find((item) => item.sourcePath === input.sourcePath);
    const current = found ? await parse(await request(`/documents/${found.id}`)) : null;
    const equal = current && current.content === input.content && current.title === input.title
      && current.originalFilename === input.originalFilename && current.sourcePath === input.sourcePath && current.contentType === input.contentType;
    if (equal) delivery = { ...delivery, documentId: current.id, savedRevisionId: current.currentRevisionId, savedTitle: current.title };
    else {
      if (!Object.hasOwn(delivery, 'expectedRevisionId')) {
        let baseline = body.baseline;
        if (body.previousOperationId) {
          const head = db.prepare('SELECT document_id,revision_id FROM document_heads WHERE source_path=?').get(input.sourcePath);
          baseline = head?.revision_id ? { documentId: head.document_id, revisionId: head.revision_id } : null;
        }
        if (current && !baseline) throw new Error('DOCUMENT_BASELINE_REQUIRED');
        delivery = { documentId: baseline?.documentId ?? null, expectedRevisionId: baseline?.revisionId ?? null };
        db.prepare('UPDATE queue SET delivery=? WHERE operation_id=?').run(JSON.stringify(delivery), row.operation_id);
      }
      if ((current?.currentRevisionId ?? null) !== delivery.expectedRevisionId || (current?.id ?? null) !== delivery.documentId) throw new Error('DOCUMENT_VERSION_CONFLICT');
      const saved = await parse(await request(`/documents${current ? `/${current.id}` : ''}`, current ? 'PATCH' : 'POST', {
        ...input, changeSummary: '同步源文档快照', ...(current ? { expectedRevisionId: delivery.expectedRevisionId } : {}) }));
      if (!saved.id || !saved.currentRevisionId || saved.content !== input.content) throw new Error('DOCUMENT_RECEIPT_INVALID');
      delivery = { ...delivery, documentId: saved.id, savedRevisionId: saved.currentRevisionId, savedTitle: saved.title };
    }
    transaction(db, () => {
      db.prepare('UPDATE queue SET delivery=? WHERE operation_id=?').run(JSON.stringify(delivery), row.operation_id);
      db.prepare('UPDATE document_heads SET document_id=?,revision_id=? WHERE source_path=?').run(delivery.documentId, delivery.savedRevisionId, input.sourcePath);
    });
  }
  return request('/events', 'POST', { operationId: `sync-${delivery.savedRevisionId}`, type: 'DESIGN', title: `存档：${delivery.savedTitle}`.slice(0, 200),
    content: `已保存 ${input.originalFilename} 的原文快照。来源：文档同步工具；仅记录文档变化，不推断代码实现或测试结果。`, documentRevisionIds: [delivery.savedRevisionId] });
}
