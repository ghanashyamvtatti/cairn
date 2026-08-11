/**
 * Password hashing and session tokens, using only Web Crypto.
 *
 * PBKDF2 rather than argon2id or scrypt, which are the better algorithms but need a WASM
 * build on Workers. PBKDF2-HMAC-SHA256 at a high iteration count is what the platform
 * offers natively, is FIPS-blessed, and is what OWASP still lists as acceptable. The
 * iteration count is stored per account so it can be raised later without invalidating
 * anyone's existing password.
 */

/** OWASP's floor for PBKDF2-HMAC-SHA256 as of 2023, and cheap enough for an edge runtime. */
export const PBKDF2_ITERATIONS = 210_000;

const encoder = new TextEncoder();

function toHex(bytes: ArrayBuffer | Uint8Array): string {
	const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
	return [...view].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array {
	const out = new Uint8Array(hex.length / 2);
	for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	return out;
}

export function randomHex(bytes = 32): string {
	return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<string> {
	const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
		'deriveBits'
	]);
	const bits = await crypto.subtle.deriveBits(
		{ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
		key,
		256
	);
	return toHex(bits);
}

export interface PasswordRecord {
	hash: string;
	salt: string;
	iterations: number;
}

export async function hashPassword(password: string): Promise<PasswordRecord> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	return {
		hash: await derive(password, salt, PBKDF2_ITERATIONS),
		salt: toHex(salt),
		iterations: PBKDF2_ITERATIONS
	};
}

/**
 * Compares in constant time.
 *
 * A plain `===` on the derived hashes leaks, through timing, how many leading characters
 * matched. That is a narrow channel but a free one to close.
 */
export async function verifyPassword(password: string, record: PasswordRecord): Promise<boolean> {
	const candidate = await derive(password, fromHex(record.salt), record.iterations);
	return timingSafeEqual(candidate, record.hash);
}

export function timingSafeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

/**
 * Sessions are stored as a hash of the cookie value.
 *
 * The database therefore never holds anything that can be replayed as a login. A leaked
 * copy of D1 exposes what the account contains, which is bad, but does not hand over the
 * accounts themselves.
 */
export async function hashSessionToken(token: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', encoder.encode(token));
	return toHex(digest);
}
