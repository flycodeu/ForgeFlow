import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { newer, verifyManifest } from './updates.js';

test('update manifest requires an authentic signature over version, file, hash, size and notes', () => {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const payload = { schema: 1, version: '0.2.1', installer: {
    file: 'ForgeFlow-Setup-0.2.1.exe', sha256: createHash('sha256').update('installer').digest('hex'), size: 9,
  }, notes: '更新说明' };
  const signature = sign(null, Buffer.from(JSON.stringify(payload)), privateKey).toString('base64');
  const key = publicKey.export({ type: 'spki', format: 'pem' }).toString();
  assert.equal(verifyManifest(JSON.stringify({ ...payload, signature }), key).version, '0.2.1');
  assert.throws(() => verifyManifest(JSON.stringify({ ...payload, notes: '篡改', signature }), key), /签名/);
  assert.throws(() => verifyManifest(JSON.stringify({ ...payload, installer: { ...payload.installer, file: '../bad.exe' }, signature }), key), /格式/);
  assert.equal(newer('0.2.1', '0.2.0'), true);
  assert.equal(newer('0.2.0', '0.2.0'), false);
  assert.equal(newer('0.1.9', '0.2.0'), false);
});
