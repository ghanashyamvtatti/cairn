/**
 * Fire-and-forget helper for repository calls whose failure the user has already been
 * told about.
 *
 * The repository reports a rejected write and then rethrows, which is what stops a
 * caller from claiming success it did not have. But an undo button or a toast action has
 * nothing further to do about a failure — the toast has already appeared — and an
 * unhandled promise rejection would only add console noise on top of it.
 *
 * This is deliberately NOT a general-purpose catch-all: anywhere the next line would
 * make a claim, or state needs putting back, the caller must `await` and handle the
 * error itself.
 */
export function fireAndForget(work: Promise<unknown>): void {
	void work.catch(() => {
		/* Already reported by the repository. */
	});
}
