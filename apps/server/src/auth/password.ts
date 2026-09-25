import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/** SPEC §6: scrypt N=16384, r=8, p=1, 64-byte key, 16-byte salt. */
const PARAMS = { N: 16384, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
/** Upper bounds accepted when reading a stored hash (guards against absurd parameters). */
const MAX_N = 1 << 20;
const MAX_R = 32;
const MAX_P = 16;

function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFC'), salt, keylen, options, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

function maxmemFor(N: number, r: number): number {
  return 128 * N * r * 2 + 1024 * 1024;
}

/** Returns "scrypt$N$r$p$saltB64$hashB64". */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await scryptAsync(password, salt, KEY_LENGTH, {
    ...PARAMS,
    maxmem: maxmemFor(PARAMS.N, PARAMS.r),
  });
  return [
    'scrypt',
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

interface ParsedHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  key: Buffer;
}

function parseHash(stored: string): ParsedHash | null {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [N, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  if (![N, r, p].every((v) => Number.isSafeInteger(v) && v > 0)) return null;
  if (N > MAX_N || (N & (N - 1)) !== 0 || r > MAX_R || p > MAX_P) return null;
  const salt = Buffer.from(parts[4]!, 'base64');
  const key = Buffer.from(parts[5]!, 'base64');
  if (salt.length === 0 || key.length === 0) return null;
  return { N, r, p, salt, key };
}

/** Constant-time comparison of the derived key. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseHash(stored);
  if (!parsed) return false;
  const derived = await scryptAsync(password, parsed.salt, parsed.key.length, {
    N: parsed.N,
    r: parsed.r,
    p: parsed.p,
    maxmem: maxmemFor(parsed.N, parsed.r),
  });
  return derived.length === parsed.key.length && timingSafeEqual(derived, parsed.key);
}

let dummyHash: Promise<string> | null = null;

/**
 * Burns the same scrypt work as a real check, for usernames that do not exist
 * (login time does not reveal whether an account exists). Always false.
 */
export async function verifyDummyPassword(password: string): Promise<false> {
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  await verifyPassword(password, await dummyHash);
  return false;
}
