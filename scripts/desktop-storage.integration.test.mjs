import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDesktopController, startDesktopService, acquireRuntimeLock } from './desktop-service.mjs';
import { readStorageChoice, inspectStorage } from './lib/desktop-storage.mjs';
import { configureCapture, enqueueWork, captureStatus } from './lib/session-capture.mjs';

test('real runtime migration preserves projects, document history and durable queue; candidate failure rolls back', { skip: !process.env.FORGEFLOW_RUNTIME_ROOT, timeout: 60000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'forgeflow-storage-integration-'));
  const env = { FORGEFLOW_CONFIG_DIR: join(root, 'bootstrap') };
  const from = join(root, 'original'); const target = join(root, 'migrated'); const failed = join(root, 'failed');
  const messages = [];
  let controller;
  const request = async (path, method = 'GET', body) => {
    const dataPath = (await readStorageChoice({ env })).dataPath;
    const runtime = JSON.parse(await readFile(join(dataPath, 'runtime.json'), 'utf8'));
    const response = await fetch(runtime.url + path, { method, headers: { 'X-ForgeFlow-Desktop': runtime.secret, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    assert.ok(response.ok, `${method} ${path}: ${response.status}`); return response.json();
  };
  try {
    controller = await createDesktopController({ runtimeRoot: process.env.FORGEFLOW_RUNTIME_ROOT, env, emit: (value) => messages.push(value),
      startService: async (options) => {
        if (options.dataPath === failed) throw new Error('Injected candidate startup failure');
        if (options.dataPath === target && options.deferPublication) {
          await assert.rejects(acquireRuntimeLock(from), { code: 'EADDRINUSE' });
          const value = await startDesktopService(options);
          await value.waitUntilReady();
          await assert.rejects(access(join(target, 'runtime.json')));
          assert.equal((await readStorageChoice({ env })).dataPath, from);
          return value;
        }
        return startDesktopService(options);
      } });
    assert.equal(messages[0].type, 'setup-required'); await assert.rejects(access(from));
    await controller.handle({ type: 'choose-storage', path: from });
    const project = await request('/api/projects', 'POST', { projectKey: 'MIGRATION_TEST', name: '迁移验收' });
    const doc = await request(`/api/projects/${project.id}/archive/documents`, 'POST', { title: '迁移设计', content: '# 第一版' });
    await request(`/api/projects/${project.id}/archive/documents/${doc.id}`, 'PATCH', { title: '迁移设计', content: '# 第二版', expectedRevisionId: doc.currentRevisionId });
    await request(`/api/projects/${project.id}/archive/events`, 'POST', { operationId: 'migration-evidence', type: 'NOTE', title: '迁移验证', content: '需要保留的记录' });
    const queue = join(from, 'capture', project.id);
    configureCapture(queue, { version: 1, enabled: false, projectId: project.id, workspaceRoot: root, serverUrl: 'http://127.0.0.1:8787', sources: [] });
    enqueueWork(queue, { operationId: 'offline-event', type: 'NOTE', title: '未送达', content: '迁移后仍应等待重试' });
    await controller.handle({ type: 'migrate-storage', path: target });
    assert.equal(messages.some((value) => value.type === 'storage-error'), false, JSON.stringify(messages.filter((value) => value.type === 'storage-error')));
    assert.equal((await readStorageChoice({ env })).dataPath, target);
    assert.equal((await request('/api/projects'))[0].id, project.id);
    assert.equal((await request(`/api/projects/${project.id}/archive/documents/${doc.id}`)).content, '# 第二版');
    assert.equal((await request(`/api/projects/${project.id}/archive/documents/${doc.id}/revisions`)).length, 2);
    assert.equal((await request(`/api/projects/${project.id}/archive/events`)).items[0].content, '需要保留的记录');
    assert.equal(captureStatus(join(target, 'capture', project.id)).pending, 1);
    await access(join(from, 'forgeflow.db')); await assert.rejects(access(join(from, 'runtime.json')));
    const oldSnapshot = await inspectStorage(from);
    await controller.handle({ type: 'migrate-storage', path: failed });
    assert.equal((await readStorageChoice({ env })).dataPath, target);
    assert.ok(messages.some((value) => value.type === 'storage-error' && value.message.includes('Injected')));
    assert.equal((await request('/api/projects'))[0].id, project.id);
    assert.equal(captureStatus(join(target, 'capture', project.id)).pending, 1);
    assert.deepEqual(await inspectStorage(from), oldSnapshot);
  } finally { await controller?.stop(); await rm(root, { recursive: true, force: true }); }
});
