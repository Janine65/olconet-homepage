import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const params = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 64, params, (error, key) => error ? reject(error) : resolve(key));
  });
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$32768$8$1$${salt.toString('hex')}$${key.toString('hex')}`;
}

// Auch bei unbekannten Konten wird dieselbe teure Passwortpruefung ausgefuehrt.
const dummyHash = `scrypt$32768$8$1$${'00'.repeat(16)}$${'00'.repeat(64)}`;

export async function verifyPassword(password: string, hash: string | null) {
  const encoded = hash ?? dummyHash;
  const match = /^scrypt\$32768\$8\$1\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(encoded);
  if (!match) throw new Error('Ungueltiges gespeichertes Passwortformat.');
  const actual = await derive(password, Buffer.from(match[1], 'hex'));
  const valid = timingSafeEqual(actual, Buffer.from(match[2], 'hex'));
  return hash !== null && valid;
}
