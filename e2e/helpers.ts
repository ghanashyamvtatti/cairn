import { expect, type Page } from '@playwright/test';

/**
 * Shared helpers for the end-to-end suite.
 *
 * Every spec starts from a genuinely empty database. Cairn stores everything in
 * IndexedDB, which survives page reloads by design, so without an explicit wipe the
 * second test in a file would inherit the first one's projects and the "over your
 * limit" assertions would be meaningless.
 */

export async function resetApp(page: Page) {
	// Land on the app once so the origin exists, then delete the database and reload so
	// the store re-opens from scratch.
	await page.goto('/');
	await page.evaluate(async () => {
		localStorage.clear();
		await new Promise<void>((resolve) => {
			const request = indexedDB.deleteDatabase('cairn');
			request.onsuccess = () => resolve();
			request.onerror = () => resolve();
			request.onblocked = () => resolve();
		});
	});
	await page.reload();
	await expect(page.getByRole('heading', { name: 'This week' })).toBeVisible();
}

/**
 * Captures a thought through the global dialog, exactly as the `c` shortcut does.
 *
 * `expectDate` waits for the "reads as …" hint before submitting. Capture never blocks
 * on the parser by design, so on the very first capture of a session — before the
 * chrono chunk has loaded — a date may legitimately not be recognised. Specs that assert
 * on the parsed date wait for the hint rather than racing the chunk.
 */
export async function capture(page: Page, text: string, options: { expectDate?: boolean } = {}) {
	await page.getByTestId('open-capture').click();
	const dialog = page.locator('dialog[open]');
	await dialog.getByTestId('capture-input').fill(text);
	if (options.expectDate) await expect(dialog.getByTestId('capture-hint')).toBeVisible();
	await dialog.getByTestId('capture-submit').click();
	await expect(dialog.getByTestId('capture-added')).toContainText(text.split(' ')[0]);
	await page.keyboard.press('Escape');
	await expect(page.locator('dialog[open]')).toHaveCount(0);
}

export async function createProject(page: Page, title: string) {
	await page.getByTestId('add-project').first().click();
	const dialog = page.locator('dialog[open]');
	await dialog.getByTestId('new-project-input').fill(title);
	await dialog.getByTestId('new-project-submit').click();
	await expect(page.locator('dialog[open]')).toHaveCount(0);
	await expect(page.getByTestId('project-card').filter({ hasText: title })).toBeVisible();
}

export function projectCard(page: Page, title: string) {
	return page.getByTestId('project-card').filter({ hasText: title });
}

/** Sets a stalled project's next action through the inline prompt on its card. */
export async function setNextAction(page: Page, projectTitle: string, action: string) {
	const card = projectCard(page, projectTitle);
	await card.getByTestId('next-action-input').fill(action);
	await card.getByTestId('next-action-submit').click();
	await expect(card.getByTestId('next-action')).toContainText(action);
}

/** Reads the whole database, for assertions the DOM cannot make. */
export async function readDb(page: Page) {
	return page.evaluate(async () => {
		const db = await new Promise<IDBDatabase>((resolve, reject) => {
			const request = indexedDB.open('cairn');
			request.onsuccess = () => resolve(request.result);
			request.onerror = () => reject(request.error);
		});
		const read = <T>(store: string) =>
			new Promise<T[]>((resolve, reject) => {
				const request = db.transaction(store).objectStore(store).getAll();
				request.onsuccess = () => resolve(request.result as T[]);
				request.onerror = () => reject(request.error);
			});

		return {
			projects: await read<Record<string, unknown>>('projects'),
			tasks: await read<Record<string, unknown>>('tasks'),
			inboxItems: await read<Record<string, unknown>>('inboxItems'),
			fixedDates: await read<Record<string, unknown>>('fixedDates'),
			weeks: await read<Record<string, unknown>>('weeks')
		};
	});
}

/** `yyyy-MM-dd` for today plus `offset` days, in the browser's local timezone. */
export function localIsoDate(offset = 0): string {
	const date = new Date();
	date.setDate(date.getDate() + offset);
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
