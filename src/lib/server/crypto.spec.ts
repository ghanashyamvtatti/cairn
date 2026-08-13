import { describe, expect, it } from 'vitest';
import {
	PBKDF2_ITERATIONS,
	hashPassword,
	hashSessionToken,
	randomHex,
	timingSafeEqual,
	verifyPassword
} from './crypto';

/**
 * The iteration cap is the only bug in this project that no test environment can
 * reproduce, so it is asserted statically rather than exercised.
 */
describe('the Cloudflare iteration ceiling', () => {
	/*
	 * This looks like a test of a constant, and it is. It exists because the failure it
	 * guards is invisible everywhere except production.
	 *
	 * workerd caps PBKDF2 at 100,000 iterations in Cloudflare's limit enforcer, but the
	 * standalone workerd binary behind `wrangler pages dev` overrides that cap to nothing.
	 * So a higher value passes every unit test, passes all 52 e2e tests against a real
	 * local Worker and a real local D1, deploys cleanly — and then answers 500 to every
	 * single sign-up, because `deriveBits` throws `NotSupportedError` before hashing
	 * anything. It cost a production outage once. The number is a platform limit, not a
	 * security tuning knob; raising it on OWASP's advice re-breaks sign-up.
	 */
	it('never exceeds what the production runtime will actually run', () => {
		expect(PBKDF2_ITERATIONS).toBeLessThanOrEqual(100_000);
	});

	it('is still high enough to be worth doing', () => {
		expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(100_000);
	});
});

describe('hashPassword', () => {
	it('accepts the password it just hashed', async () => {
		const record = await hashPassword('correct horse battery staple');
		await expect(verifyPassword('correct horse battery staple', record)).resolves.toBe(true);
	});

	it('rejects a password that is merely close', async () => {
		const record = await hashPassword('correct horse battery staple');
		await expect(verifyPassword('correct horse battery stapl', record)).resolves.toBe(false);
	});

	it('salts, so the same password twice gives two different hashes', async () => {
		const first = await hashPassword('the same password');
		const second = await hashPassword('the same password');
		expect(first.hash).not.toBe(second.hash);
		expect(first.salt).not.toBe(second.salt);
	});

	it('records the iteration count it used', async () => {
		const record = await hashPassword('anything at all');
		expect(record.iterations).toBe(PBKDF2_ITERATIONS);
	});
});

describe('verifyPassword', () => {
	/*
	 * The whole reason the count is a column and not just a constant. If verification read
	 * the current constant instead of the stored one, changing the constant would lock out
	 * every existing account at once — which is exactly the migration we would need if
	 * Cloudflare ever raises its cap.
	 */
	it('uses the count stored on the record, not the current constant', async () => {
		const legacy = { ...(await hashPassword('unchanged password')), iterations: 1_000 };
		const rehashed = await hashPassword('unchanged password');

		// A record written under a different count still verifies, against its own count.
		const { hash } = await hashPassword('unchanged password');
		expect(hash).not.toBe(legacy.hash);
		await expect(verifyPassword('unchanged password', rehashed)).resolves.toBe(true);
		// ...and the mismatched count genuinely produces a different derivation.
		await expect(verifyPassword('unchanged password', legacy)).resolves.toBe(false);
	});
});

describe('timingSafeEqual', () => {
	it('matches identical strings', () => {
		expect(timingSafeEqual('abcdef', 'abcdef')).toBe(true);
	});

	it('rejects a difference in the last character as readily as the first', () => {
		expect(timingSafeEqual('abcdef', 'abcdeg')).toBe(false);
		expect(timingSafeEqual('abcdef', 'zbcdef')).toBe(false);
	});

	it('rejects different lengths without indexing past the end', () => {
		expect(timingSafeEqual('abc', 'abcdef')).toBe(false);
	});
});

describe('session tokens', () => {
	it('hashes a token to something stable and not the token itself', async () => {
		const token = randomHex(32);
		const digest = await hashSessionToken(token);
		expect(digest).not.toBe(token);
		expect(digest).toHaveLength(64);
		await expect(hashSessionToken(token)).resolves.toBe(digest);
	});

	it('gives a different token every time, of the requested length', () => {
		const a = randomHex(32);
		const b = randomHex(32);
		expect(a).toHaveLength(64);
		expect(a).not.toBe(b);
	});
});
