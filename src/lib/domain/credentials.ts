/**
 * Validation for the two fields an account has.
 *
 * Pure, and deliberately NOT under `src/lib/server`: the sign-up form has to apply
 * exactly the rules the server will, and a second approximation of them in the UI would
 * disagree at the worst possible moment. `$lib/server` is unimportable from client code,
 * which is the right protection for secrets and the wrong one for shared rules.
 */

export const MIN_PASSWORD_LENGTH = 10;
/**
 * An upper bound matters: PBKDF2 cost is paid by the server, and an unbounded password
 * is an unbounded amount of work per request.
 */
export const MAX_PASSWORD_LENGTH = 200;
export const MAX_EMAIL_LENGTH = 254;

/**
 * Deliberately permissive.
 *
 * Email syntax is far stranger than most patterns allow, and rejecting a valid address
 * is a worse failure than accepting an invalid one — the address is an identifier here,
 * not something we deliver to. This checks the shape and nothing more.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;

export function normaliseEmail(email: string): string {
	return email.trim().toLowerCase();
}

export type CredentialProblem = { field: 'email' | 'password'; message: string };

export function checkEmail(raw: string): CredentialProblem | null {
	const email = normaliseEmail(raw);
	if (email === '') return { field: 'email', message: 'Enter your email address.' };
	if (email.length > MAX_EMAIL_LENGTH)
		return { field: 'email', message: 'That address is too long.' };
	if (!EMAIL_SHAPE.test(email))
		return { field: 'email', message: 'That does not look like an email address.' };
	return null;
}

export function checkPassword(password: string): CredentialProblem | null {
	if (password.length < MIN_PASSWORD_LENGTH) {
		return {
			field: 'password',
			// Length is the only rule. Composition rules ("one number, one symbol") push
			// people towards shorter, more predictable passwords, and every current
			// guideline — NIST included — has dropped them.
			message: `Use at least ${MIN_PASSWORD_LENGTH} characters. Length beats punctuation.`
		};
	}
	if (password.length > MAX_PASSWORD_LENGTH) {
		return { field: 'password', message: 'That password is too long.' };
	}
	return null;
}

export function checkCredentials(email: string, password: string): CredentialProblem | null {
	return checkEmail(email) ?? checkPassword(password);
}
