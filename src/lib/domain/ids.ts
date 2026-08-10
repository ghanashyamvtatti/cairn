import type { Id } from '$lib/types';

/**
 * Generates a UUID v4. Prefers the platform implementation and falls back to a
 * `getRandomValues` construction for browsers that expose Web Crypto but not
 * `randomUUID` (Safari only shipped `randomUUID` in 15.4, and it is unavailable on
 * insecure origins — which includes some LAN dev setups).
 */
export function newId(): Id {
	const cryptoObj = globalThis.crypto;

	if (cryptoObj?.randomUUID) {
		return cryptoObj.randomUUID();
	}

	const bytes = new Uint8Array(16);
	cryptoObj.getRandomValues(bytes);

	// Set the version (4) and variant (RFC 4122) bits.
	bytes[6] = (bytes[6] & 0x0f) | 0x40;
	bytes[8] = (bytes[8] & 0x3f) | 0x80;

	const hex: string[] = [];
	for (const byte of bytes) hex.push(byte.toString(16).padStart(2, '0'));

	return (
		hex.slice(0, 4).join('') +
		'-' +
		hex.slice(4, 6).join('') +
		'-' +
		hex.slice(6, 8).join('') +
		'-' +
		hex.slice(8, 10).join('') +
		'-' +
		hex.slice(10, 16).join('')
	);
}
