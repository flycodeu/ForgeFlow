import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { desktopDataPath, lockName, acquireRuntimeLock, verifyIdentity } from './desktop-service.mjs';

test('desktop paths never default to the checkout and lock names are stable', () => {
  assert.equal(desktopDataPath({ LOCALAPPDATA: 'C:/Users/test/AppData/Local' }), join('C:/Users/test/AppData/Local', 'ForgeFlow'));
  assert.equal(desktopDataPath({ FORGEFLOW_DATA_DIR: './test-data' }), resolve('./test-data'));
  assert.throws(() => desktopDataPath({}), /LOCALAPPDATA/);
  assert.equal(lockName('C:\\Users\\Test\\ForgeFlow', 'win32'), lockName('c:\\users\\test\\forgeflow', 'win32'));
  assert.notEqual(lockName('a', 'win32'), lockName('b', 'win32'));
});

test('OS lock rejects concurrent writers and releases without killing any process', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'forgeflow-desktop-lock-'));
  const first = await acquireRuntimeLock(folder);
  try { await assert.rejects(acquireRuntimeLock(folder), { code: 'EADDRINUSE' }); }
  finally { await new Promise((done) => first.close(done)); }
  const next = await acquireRuntimeLock(folder);
  await new Promise((done) => next.close(done));
  await rm(folder, { recursive: true });
});

test('runtime identity refuses non-loopback URLs before sending secrets', async () => {
  await assert.rejects(verifyIdentity('https://example.com', 'secret', 'instance'), /Invalid local/);
  await assert.rejects(verifyIdentity('http://localhost:8787', 'secret', 'instance'), /Invalid local/);
});
