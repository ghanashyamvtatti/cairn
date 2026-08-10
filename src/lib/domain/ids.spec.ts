import { afterEach, describe, expect, it, vi } from 'vitest';
import { newId } from '$lib/domain/ids';
import type { Id } from '$lib/types';

/** Canonical RFC 4122 version 4 shape: version nibble `4`, variant nibble 8/9/a/b. */
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Character offsets of the two nibbles the fallback is required to force. */
const VERSION_NIBBLE_INDEX = 14;
const VARIANT_NIBBLE_INDEX = 19;

/** The genuine platform Web Crypto, captured before any stubbing happens. */
const platformCrypto = globalThis.crypto;

/** The buffer `newId` hands to `getRandomValues`. */
type Bytes = Uint8Array<ArrayBuffer>;

type ByteFiller = (bytes: Bytes) => void;

/**
 * The shape `newId` actually reaches for on the fallback path: a Web Crypto object
 * exposing `getRandomValues` but no `randomUUID`, as on pre-15.4 Safari and on
 * insecure origins.
 */
interface CryptoWithoutRandomUUID {
	getRandomValues(array: Bytes): Bytes;
}

/** Replaces `globalThis.crypto` with a randomUUID-less object driven by `fill`. */
function stubFallbackCrypto(fill: ByteFiller): void {
	const stub = {
		getRandomValues(array: Bytes): Bytes {
			fill(array);
			return array;
		}
	} satisfies CryptoWithoutRandomUUID;

	vi.stubGlobal('crypto', stub);
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('newId', () => {
	it('returns an id in the RFC 4122 version 4 shape', () => {
		expect(newId()).toMatch(UUID_V4);
	});

	it('returns ids that are all in the version 4 shape across many draws', () => {
		const offenders = Array.from({ length: 1000 }, () => newId()).filter(
			(id) => !UUID_V4.test(id)
		);

		expect(offenders).toEqual([]);
	});

	it('generates 10000 distinct ids', () => {
		const ids = new Set<Id>();
		for (let i = 0; i < 10_000; i++) ids.add(newId());

		expect(ids.size).toBe(10_000);
	});

	it('prefers the platform randomUUID when it is available', () => {
		const platformValue = '11111111-2222-4333-8444-555555555555';
		vi.stubGlobal('crypto', {
			randomUUID: (): string => platformValue,
			getRandomValues: (): never => {
				throw new Error('getRandomValues must not be used when randomUUID exists');
			}
		});

		expect(newId()).toBe(platformValue);
	});

	describe('fallback for platforms with getRandomValues but no randomUUID', () => {
		it.each([
			{
				name: 'all-zero bytes',
				byte: 0x00,
				expected: '00000000-0000-4000-8000-000000000000'
			},
			{
				name: 'all-0xff bytes',
				byte: 0xff,
				expected: 'ffffffff-ffff-4fff-bfff-ffffffffffff'
			}
		])('pins the bit-twiddling for $name', ({ byte, expected }) => {
			stubFallbackCrypto((bytes) => bytes.fill(byte));

			expect(newId()).toBe(expected);
		});

		it('still produces the version 4 shape when randomUUID is missing', () => {
			stubFallbackCrypto((bytes) => bytes.fill(0x00));

			expect(newId()).toMatch(UUID_V4);
		});

		it('lays the sixteen random bytes out as lower-case hex in 8-4-4-4-12 groups', () => {
			// Byte i = i, so every group's position and zero-padding is pinned, and the
			// two rewritten bytes (6 and 8) are visible in place: 0x06 -> 0x46, 0x08 -> 0x88.
			stubFallbackCrypto((bytes) => {
				for (let i = 0; i < bytes.length; i++) bytes[i] = i;
			});

			expect(newId()).toBe('00010203-0405-4607-8809-0a0b0c0d0e0f');
		});

		it('forces the version nibble to 4 and the variant nibble to 8, 9, a or b for every byte value', () => {
			let byteValue = 0;
			stubFallbackCrypto((bytes) => bytes.fill(byteValue));

			for (byteValue = 0x00; byteValue <= 0xff; byteValue++) {
				const label = `every byte = 0x${byteValue.toString(16).padStart(2, '0')}`;
				const id = newId();

				expect(id, label).toMatch(UUID_V4);
				expect(id[VERSION_NIBBLE_INDEX], label).toBe('4');
				expect(['8', '9', 'a', 'b'], label).toContain(id[VARIANT_NIBBLE_INDEX]);
			}
		});

		it.each([
			{ byte6: 0x00, expected: '4' },
			{ byte6: 0x0f, expected: '4' },
			{ byte6: 0xf0, expected: '4' },
			{ byte6: 0xff, expected: '4' }
		])('writes version nibble $expected when byte 6 is $byte6', ({ byte6, expected }) => {
			stubFallbackCrypto((bytes) => {
				bytes[6] = byte6;
			});

			expect(newId()[VERSION_NIBBLE_INDEX]).toBe(expected);
		});

		it.each([
			{ byte8: 0x00, expected: '8' },
			{ byte8: 0x1f, expected: '9' },
			{ byte8: 0x2a, expected: 'a' },
			{ byte8: 0x3f, expected: 'b' },
			{ byte8: 0x40, expected: '8' },
			{ byte8: 0xff, expected: 'b' }
		])('writes variant nibble $expected when byte 8 is $byte8', ({ byte8, expected }) => {
			stubFallbackCrypto((bytes) => {
				bytes[8] = byte8;
			});

			expect(newId()[VARIANT_NIBBLE_INDEX]).toBe(expected);
		});

		it('preserves the random bits that are not part of the version or variant fields', () => {
			// 0x5a keeps its low nibble in byte 6 and its low six bits in byte 8:
			// (0x5a & 0x0f) | 0x40 = 0x4a, (0x5a & 0x3f) | 0x80 = 0x9a.
			stubFallbackCrypto((bytes) => bytes.fill(0x5a));

			expect(newId()).toBe('5a5a5a5a-5a5a-4a5a-9a5a-5a5a5a5a5a5a');
		});

		it('produces distinct ids when fed real platform randomness', () => {
			stubFallbackCrypto((bytes) => {
				platformCrypto.getRandomValues(bytes);
			});

			const ids = new Set<Id>();
			for (let i = 0; i < 1000; i++) ids.add(newId());

			expect(ids.size).toBe(1000);
		});

		it('asks for exactly sixteen bytes of randomness', () => {
			const lengths: number[] = [];
			stubFallbackCrypto((bytes) => lengths.push(bytes.length));

			newId();

			expect(lengths).toEqual([16]);
		});
	});
});
