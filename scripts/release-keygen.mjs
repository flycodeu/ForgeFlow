import { generateKeyPairSync } from 'node:crypto';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const destination = process.argv[2];
if (!destination) throw new Error('Usage: node scripts/release-keygen.mjs <private-key-path-outside-repo>');
const file = resolve(destination);
try { await access(file); throw new Error(`Key already exists: ${file}`); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const { privateKey, publicKey } = generateKeyPairSync('ed25519');
await mkdir(dirname(file), { recursive: true });
await writeFile(file, privateKey.export({ type: 'pkcs8', format: 'pem' }), { flag: 'wx', mode: 0o600 });
console.log(publicKey.export({ type: 'spki', format: 'pem' }));
