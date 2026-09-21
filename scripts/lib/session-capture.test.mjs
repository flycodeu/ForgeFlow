import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { adaptRecord, redact } from './session-adapters.mjs';
import { configureCapture, captureStatus, enqueueWork, enqueueDocument, documentQueueHead, adoptDocumentBaseline, pollCapture, flushCapture } from './session-capture.mjs';

const projectId = '0666417d-f47e-4a55-9328-14ffa5166c5b';
async function fixture(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'forgeflow-capture-test-'));
  const source = join(root, 'sessions'); const state = join(root, 'state'); const workspace = join(root, 'work');
  await mkdir(source); await mkdir(workspace);
  const config = { version: 1, enabled: true, projectId, workspaceRoot: workspace, serverUrl: 'http://127.0.0.1:8787',
    sources: [{ kind: 'codex', directory: source }], includeHistory: true, ...options };
  configureCapture(state, config); return { root, source, state, workspace, config };
}
const message = (text, channel = 'final') => ({ timestamp: '2026-09-21T00:00:00Z', type: 'response_item', payload: { type: 'message', role: 'assistant', channel, content: [{ type: 'output_text', text }] } });
const metadata = (cwd) => ({ timestamp: '2026-09-21T00:00:00Z', type: 'session_meta', payload: { id: 'session-1', cwd, base_instructions: { text: 'PRIVATE_SYSTEM_INSTRUCTION' } } });
const jsonl = (...rows) => `${rows.map(JSON.stringify).join('\n')}\n`;
const event = (operationId = 'op1') => ({ operationId, type: 'NOTE', title: '测试记录', content: 'visible' });
const okay = async () => new Response(JSON.stringify({ committed: true, event: { id: 'event1', projectId } }), { status: 201 });

test('codex adapter excludes reasoning, nonvisible messages and tool payloads; redacts standard secrets', () => {
  const context = { cwd: process.cwd(), sessionId: 's1' };
  assert.equal(adaptRecord('codex', message('PRIVATE_REASONING', 'analysis'), context).entries.length, 0);
  assert.equal(adaptRecord('codex', { type: 'response_item', payload: { type: 'reasoning', summary: 'PRIVATE_REASONING' } }, context).entries.length, 0);
  const tool = adaptRecord('codex', { type: 'response_item', payload: { type: 'function_call', name: 'exec_command', arguments: 'PRIVATE_COMMAND' } }, context);
  assert.equal(JSON.stringify(tool).includes('PRIVATE_COMMAND'), false);
  assert.match(redact('API_KEY=sk-123456789abcdefghij Bearer abc.def.xyz password="hello-secret"'), /已隐藏凭证/);
  assert.equal(redact('password="hello-secret"').includes('hello-secret'), false);
  assert.equal(redact('{"api_key":"hello-secret"}').includes('hello-secret'), false);
  assert.equal(adaptRecord('codex', message('PRIVATE_INTERNAL', 'unknown-internal'), context).entries.length, 0);
});

test('poll persists queue and cursor together, ignores unrelated workspace, and waits for partial final line', async () => {
  const f = await fixture(); const file = join(f.source, 'one.jsonl');
  await writeFile(file, jsonl(metadata(f.workspace), message('visible'), message('PRIVATE_REASONING', 'analysis')) + JSON.stringify(message('partial')));
  await writeFile(join(f.source, 'unrelated.jsonl'), jsonl(metadata(f.root), message('UNRELATED_MESSAGE')));
  const first = await pollCapture(f.state);
  assert.equal(first.pending, 2); assert.equal(first.sources.find((x) => x.path === file).offset < (await readFile(file)).length, true);
  await appendFile(file, '\n'); assert.equal((await pollCapture(f.state)).pending, 3);
  assert.equal((await pollCapture(f.state)).pending, 3);
  const db = new DatabaseSync(join(f.state, 'collector.sqlite'));
  const content = JSON.stringify(db.prepare('SELECT * FROM queue').all()); db.close();
  assert.doesNotMatch(content, /PRIVATE_REASONING|PRIVATE_SYSTEM_INSTRUCTION|UNRELATED_MESSAGE/);
});

test('unknown/malformed records remain at failing offset and are reported, never skipped', async () => {
  const f = await fixture(); const prefix = jsonl(metadata(f.workspace));
  await writeFile(join(f.source, 'broken.jsonl'), `${prefix}{not valid}\n${jsonl(message('not consumed'))}`);
  let status = await pollCapture(f.state); assert.equal(status.sources[0].offset, Buffer.byteLength(prefix));
  assert.equal(status.sources[0].issue, 'MALFORMED_JSONL');
  status = await pollCapture(f.state); assert.equal(status.pending, 1); assert.equal(status.sources[0].offset, Buffer.byteLength(prefix));
});

test('queue limits stop cursor advancement without dropping accepted records', async () => {
  const f = await fixture({ maxQueueItems: 1 }); const prefix = jsonl(metadata(f.workspace));
  await writeFile(join(f.source, 'one.jsonl'), prefix + jsonl(message('second')));
  let status = await pollCapture(f.state); assert.equal(status.pending, 1); assert.equal(status.sources[0].offset, Buffer.byteLength(prefix));
  assert.equal(status.sources[0].issue, 'QUEUE_FULL');
  await flushCapture(f.state, { fetch: okay });
  status = await pollCapture(f.state); assert.equal(status.pending, 1); assert.equal(status.sources[0].issue, null);
});

test('disconnect and lost receipt survive reopened database; retry preserves operation and body', async () => {
  const f = await fixture(); enqueueWork(f.state, event());
  const committed = new Map(); let count = 0;
  const mock = async (_url, request) => {
    const body = JSON.parse(request.body); const previous = committed.get(body.operationId);
    if (previous) assert.equal(previous, request.body); else committed.set(body.operationId, request.body);
    count++; if (count === 1) throw new Error('disconnected after server commit SECRET_TOKEN');
    return okay();
  };
  await flushCapture(f.state, { fetch: mock, token: 'SECRET_TOKEN' });
  let status = captureStatus(f.state); assert.equal(status.pending, 1); assert.equal(status.failures[0].attempts, 1);
  assert.equal(JSON.stringify(status).includes('SECRET_TOKEN'), false);
  await flushCapture(f.state, { fetch: mock }); assert.equal(count, 1, 'backoff prevents immediate retry');
  status = await flushCapture(f.state, { fetch: mock, force: true }); assert.equal(status.pending, 0); assert.equal(committed.size, 1);
  enqueueWork(f.state, event()); assert.equal(captureStatus(f.state).pending, 0, 'receipt ledger deduplicates after restart');
  assert.throws(() => enqueueWork(f.state, { ...event(), content: 'changed' }), /LOCAL_OPERATION_CONFLICT/);
});

test('401 and 409 retain durable blocked entries; explicit retry uses same id', async () => {
  const f = await fixture(); enqueueWork(f.state, event());
  let status = await flushCapture(f.state, { fetch: async () => new Response('secret response body', { status: 401 }) });
  assert.equal(status.pending, 1); assert.equal(status.blocked, 1); assert.equal(status.lastError, 'HTTP_401');
  status = await flushCapture(f.state, { force: true, fetch: async () => new Response('{}', { status: 409 }) });
  assert.equal(status.pending, 1); assert.equal(status.lastError, 'HTTP_409');
  status = await flushCapture(f.state, { force: true, fetch: okay }); assert.equal(status.pending, 0);
});

test('Claude parses visible text only and ignores thinking, tool commands/output and meta prompts', () => {
  const row = { type: 'assistant', cwd: process.cwd(), sessionId: 'claude1', message: { role: 'assistant', content: [
    { type: 'thinking', thinking: 'PRIVATE_REASONING' }, { type: 'text', text: 'visible' },
    { type: 'tool_use', name: 'Bash', input: { command: 'PRIVATE_COMMAND' } }, { type: 'tool_result', content: 'PRIVATE_OUTPUT', is_error: true },
  ] } };
  const result = adaptRecord('claude', row, {}); assert.equal(result.entries.length, 3);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE_REASONING|PRIVATE_COMMAND|PRIVATE_OUTPUT/);
  assert.equal(adaptRecord('claude', { ...row, isMeta: true, message: { role: 'assistant', content: 'META' } }, {}).entries.length, 0);
});

test('default opt-in starts from now and never imports earlier visible text', async () => {
  const f = await fixture({ includeHistory: false });
  await writeFile(join(f.source, 'one.jsonl'), jsonl(metadata(f.workspace), message('old'), { ...message('new'), timestamp: '2099-01-01T00:00:00Z' }));
  const status = await pollCapture(f.state); assert.equal(status.pending, 1);
  assert.throws(() => configureCapture(f.state, { ...f.config, includeHistory: true }), /HISTORY_MODE_IMMUTABLE/);
  assert.throws(() => configureCapture(f.state, { ...f.config, workspaceRoot: f.root }), /BINDING_IMMUTABLE/);
  assert.throws(() => configureCapture(f.state, { ...f.config, serverUrl: 'https://external.test' }), /LOCAL_SERVER/);
});

test('invalid success receipts do not delete queue, and disabled collectors do not scan', async () => {
  const f = await fixture({ enabled: false }); await writeFile(join(f.source, 'one.jsonl'), jsonl(metadata(f.workspace), message('visible')));
  assert.equal((await pollCapture(f.state)).filesSeen, 0); enqueueWork(f.state, event());
  const status = await flushCapture(f.state, { fetch: async () => new Response('{}', { status: 200 }) });
  assert.equal(status.pending, 1); assert.equal(status.lastError, 'INVALID_RECEIPT');
});

function documentServer(initial = null) {
  let current = initial; const versions = []; const events = new Map(); let loseDocumentReceipt = false; let loseEventReceipt = false;
  return { versions, events, get current() { return current; }, set current(value) { current = value; },
    loseDocument() { loseDocumentReceipt = true; }, loseEvent() { loseEventReceipt = true; },
    async fetch(url, request) {
      if (request.method === 'GET') return new Response(JSON.stringify(url.endsWith('/documents') ? (current ? [current] : []) : current));
      const body = JSON.parse(request.body);
      if (url.endsWith('/events')) {
        const previous = events.get(body.operationId);
        if (previous && previous !== request.body) return new Response('{}', { status: 409 });
        events.set(body.operationId, request.body);
        if (loseEventReceipt) { loseEventReceipt = false; throw new Error('ack lost'); }
        return okay();
      }
      if (request.method === 'PATCH' && body.expectedRevisionId !== current?.currentRevisionId) return new Response('{}', { status: 409 });
      current = { ...body, id: 'document-1', currentRevisionId: `revision-${versions.length + 1}` }; versions.push(current);
      if (loseDocumentReceipt) { loseDocumentReceipt = false; throw new Error('ack lost'); }
      return new Response(JSON.stringify(current), { status: 201 });
    } };
}
const documentInput = (root, content) => ({ title: '设计记录', content, sourcePath: join(root, 'design.md'), originalFilename: 'design.md', contentType: 'text/markdown' });

test('document queue retains every observed offline snapshot in order across reopen', async () => {
  const f = await fixture(); const server = documentServer();
  enqueueDocument(f.state, documentInput(f.workspace, '\uFEFF# 一\r\n'));
  enqueueDocument(f.state, documentInput(f.workspace, '# 二\n'));
  assert.equal(enqueueDocument(f.state, documentInput(f.workspace, '# 二\n')).queued, false);
  assert.equal(captureStatus(f.state).pending, 2);
  const status = await flushCapture(f.state, { fetch: server.fetch });
  assert.equal(status.pending, 0); assert.equal(server.versions.length, 2);
  assert.equal(server.versions[0].content, '\uFEFF# 一\r\n'); assert.equal(server.current.content, '# 二\n');
  assert.equal(server.events.size, 2); assert.equal(documentQueueHead(f.state, join(f.workspace, 'design.md')).revision_id, 'revision-2');
});

test('document and event lost receipts replay without duplicate revisions/events', async () => {
  const f = await fixture(); const server = documentServer(); server.loseDocument();
  enqueueDocument(f.state, documentInput(f.workspace, '# 一\n'));
  let status = await flushCapture(f.state, { fetch: server.fetch }); assert.equal(status.pending, 1); assert.equal(server.versions.length, 1);
  server.loseEvent(); status = await flushCapture(f.state, { fetch: server.fetch, force: true }); assert.equal(status.pending, 1);
  status = await flushCapture(f.state, { fetch: server.fetch, force: true });
  assert.equal(status.pending, 0); assert.equal(server.versions.length, 1); assert.equal(server.events.size, 1);
});

test('unknown baseline and competing edits block document writes until explicitly adopted', async () => {
  const f = await fixture(); const initial = { ...documentInput(f.workspace, '# 远端人工修改\n'), id: 'document-1', currentRevisionId: 'remote-revision' };
  const server = documentServer(initial);
  enqueueDocument(f.state, documentInput(f.workspace, '# 本地\n'));
  let status = await flushCapture(f.state, { fetch: server.fetch }); assert.equal(status.blocked, 1); assert.equal(status.lastError, 'DOCUMENT_BASELINE_REQUIRED');
  assert.equal(server.versions.length, 0);
  adoptDocumentBaseline(f.state, initial.sourcePath, { documentId: initial.id, revisionId: initial.currentRevisionId });
  status = await flushCapture(f.state, { fetch: server.fetch }); assert.equal(status.pending, 0); assert.equal(server.versions.length, 1);
  enqueueDocument(f.state, documentInput(f.workspace, '# 下一版\n'));
  server.current = { ...server.current, currentRevisionId: 'conflicting-revision', content: '# 另一次人工修改' };
  status = await flushCapture(f.state, { fetch: server.fetch }); assert.equal(status.blocked, 1); assert.equal(status.lastError, 'DOCUMENT_VERSION_CONFLICT');
  assert.equal(server.versions.length, 1);
});

test('flush honours maxItems and rewriting committed source bytes is visible without skipped data', async () => {
  const f = await fixture(); enqueueWork(f.state, event('a')); enqueueWork(f.state, event('b'));
  assert.equal((await flushCapture(f.state, { fetch: okay, maxItems: 1 })).pending, 1);
  const file = join(f.source, 'one.jsonl'); await writeFile(file, jsonl(metadata(f.workspace), message('visible')));
  await pollCapture(f.state); const originalOffset = captureStatus(f.state).sources[0].offset;
  await writeFile(file, jsonl(metadata(f.workspace), message('rewritten with more data')));
  const status = await pollCapture(f.state); assert.equal(status.sources[0].issue, 'SOURCE_REWRITTEN'); assert.equal(status.sources[0].offset, originalOffset);
});

test('real CLI process restart resends an ack-lost record once with same operation id', async (t) => {
  const f = await fixture(); const committed = new Map(); let requests = 0;
  const server = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const content = Buffer.concat(chunks).toString(); const body = JSON.parse(content);
    const prior = committed.get(body.operationId); if (prior) assert.equal(prior, content); else committed.set(body.operationId, content);
    requests++;
    if (requests === 1) { response.destroy(); return; }
    response.writeHead(201, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ committed: true, event: { id: 'event1', projectId } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); t.after(() => server.close());
  const serverUrl = `http://127.0.0.1:${server.address().port}`;
  const file = join(f.workspace, 'record.txt'); await writeFile(file, 'A visible CLI record');
  const run = promisify(execFile); const cli = fileURLToPath(new URL('../project-archive.mjs', import.meta.url));
  await assert.rejects(run(process.execPath, [cli, 'record', '--project-id', projectId, '--state', f.state, '--file', file, '--title', 'CLI restart', '--operation-id', 'process-restart'],
    { env: { ...process.env, FORGEFLOW_URL: serverUrl }, timeout: 10000 }), (error) => error.code === 2);
  assert.equal(captureStatus(f.state).pending, 1);
  await run(process.execPath, [cli, 'flush', '--state', f.state, '--force'], { env: { ...process.env, FORGEFLOW_URL: serverUrl }, timeout: 10000 });
  assert.equal(captureStatus(f.state).pending, 0); assert.equal(committed.size, 1); assert.equal(requests, 2);
});

test('overlapping flushes share a durable lease and do not duplicate dispatch', async () => {
  const f = await fixture(); enqueueWork(f.state, event()); let calls = 0;
  let entered; const started = new Promise((resolve) => { entered = resolve; });
  let release; const wait = new Promise((resolve) => { release = resolve; });
  const first = flushCapture(f.state, { fetch: async () => { calls++; entered(); await wait; return okay(); } });
  await started; const second = await flushCapture(f.state, { fetch: okay }); assert.equal(second.busy, true);
  release(); assert.equal((await first).pending, 0); assert.equal(calls, 1);
});

test('repairing an unconsumed malformed tail allows retry without discarding committed prefix', async () => {
  const f = await fixture(); const file = join(f.source, 'one.jsonl'); const prefix = jsonl(metadata(f.workspace));
  await writeFile(file, prefix + '{broken}\n'); await pollCapture(f.state);
  await writeFile(file, prefix + jsonl(message('repaired visible message')));
  const status = await pollCapture(f.state); assert.equal(status.sources[0].issue, null); assert.equal(status.pending, 2);
});
