/**
 * Password hashing and session tokens, using only Web Crypto.
 *
 * PBKDF2 rather than argon2id or scrypt, which are the better algorithms but need a WASM
 * build on Workers. PBKDF2-HMAC-SHA256 at a high iteration count is what the platform
 * offers natively, is FIPS-blessed, and is what OWASP still lists as acceptable. The
 * iteration count is stored per account so it can be raised later without invalidating
 * anyone's existing password.
 */

/**
 * The most PBKDF2 iterations Cloudflare will run. Not a considered choice — a ceiling.
 *
 * workerd's production limit enforcer caps this at 100,000
 * (`DEFAULT_MAX_PBKDF2_ITERATIONS` in `src/workerd/io/limit-enforcer.h`) and
 * `crypto.subtle.deriveBits` throws `NotSupportedError: Pbkdf2 failed: iteration counts
 * above 100000 are not supported` for anything higher. There is no compatibility flag
 * and no paid-plan escape hatch; scrypt is capped separately by the same header.
 *
 * This sits below what OWASP recommends for PBKDF2-HMAC-SHA256, which is worth knowing
 * and cannot currently be fixed by raising the number. `iterations` is stored per account
 * precisely so it can be raised the day the platform allows it, without invalidating a
 * single existing password.
 *
 * Do not "fix" this upward on security advice: it fails only in production. The
 * standalone workerd that `wrangler pages dev` runs overrides the cap to no limit at all
 * (`server.c++`), so the whole e2e suite passes at any value while the deployed app
 * answers 500 to every sign-up. `crypto.spec.ts` guards the constant for that reason.
 */
export const PBKDF2_ITERATIONS = 100_000;

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
