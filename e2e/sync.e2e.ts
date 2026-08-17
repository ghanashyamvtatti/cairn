import { expect, test, type Browser, type Page } from '@playwright/test';
import {
	TEST_PASSWORD,
	createProject,
	gotoProjects,
	projectCard,
	setNextAction,
	signUp,
	uniqueEmail
} from './helpers';

/**
 * Two devices, one account.
 *
 * Every spec here uses two genuinely separate browser contexts — separate cookies,
 * separate IndexedDB — because a second tab shares both and would prove nothing. This is
 * the only file that can actually demonstrate the point of the whole sync layer.
 */

async function openDevice(browser: Browser): Promise<Page> {
	const context = await browser.newContext();
	const page = await context.newPage();
	await page.goto('/');
	return page;
}

/** A device that has just signed in as an existing account. */
async function joinAs(browser: Browser, email: string): Promise<Page> {
	const page = await openDevice(browser);
	await page.getByTestId('auth-email').fill(email);
	await page.getByTestId('auth-password').fill(TEST_PASSWORD);
	await page.getByTestId('auth-submit').click();
	await expect(page.getByTestId('open-capture')).toBeVisible({ timeout: 15_000 });
	return page;
}

/** Brings a device up to date the way returning to the tab does. */
async function refresh(page: Page): Promise<void> {
	await page.reload();
	await expect(page.getByTestId('open-capture')).toBeVisible({ timeout: 15_000 });
}

test.describe('two devices, one account', () => {
	test('work created on one device appears on the other', async ({ browser }) => {
		const a = await openDevice(browser);
		const email = await signUp(a);
		await a.getByTestId('welcome-skip').click();

		await createProject(a, 'Move the studio');
		await setNextAction(a, 'Move the studio', 'Ring three removal firms');

		const b = await joinAs(browser, email);
		await gotoProjects(b);

		// B never touched this data; it can only be here because it came from the server.
		const card = projectCard(b, 'Move the studio');
		await expect(card).toBeVisible();
		await expect(card.getByTestId('next-action')).toContainText('Ring three removal firms');

		await a.context().close();
		await b.context().close();
	});

	test('a change on the second device comes back to the first', async ({ browser }) => {
		const a = await openDevice(browser);
		const email = await signUp(a);
		await a.getByTestId('welcome-skip').click();
		await createProject(a, 'Fix the roof');

		const b = await joinAs(browser, email);
		await gotoProjects(b);
		await setNextAction(b, 'Fix the roof', 'Photograph the flashing');

		await refresh(a);
		await expect(projectCard(a, 'Fix the roof').getByTestId('next-action')).toContainText(
			'Photograph the flashing'
		);

		await a.context().close();
		await b.context().close();
	});

	test('a deletion travels, rather than the row simply reappearing', async ({ browser }) => {
		const a = await openDevice(browser);
		const email = await signUp(a);
		await a.getByTestId('welcome-skip').click();
		await createProject(a, 'Temporary project');

		const b = await joinAs(browser, email);
		await gotoProjects(b);
		await expect(projectCard(b, 'Temporary project')).toBeVisible();

		// Delete on A.
		await projectCard(a, 'Temporary project').getByTestId('project-options').click();
		await a.locator('dialog[open]').getByTestId('project-delete').click();
		await expect(a.getByTestId('empty-projects')).toBeVisible();

		// B must lose it too. A tombstone has to sync as a deletion — if deleted rows just
		// vanished from the pull, B would keep showing it forever.
		await refresh(b);
		await expect(projectCard(b, 'Temporary project')).toHaveCount(0);

		await a.context().close();
		await b.context().close();
	});

	test('the one-next-action rule holds across devices, not just within one', async ({
		browser
	}) => {
		const a = await openDevice(browser);
		const email = await signUp(a);
		await a.getByTestId('welcome-skip').click();
		await createProject(a, 'Shared project');
		await setNextAction(a, 'Shared project', 'First action');

		const b = await joinAs(browser, email);
		await gotoProjects(b);
		await projectCard(b, 'Shared project').getByTestId('project-disclosure').click();
		await projectCard(b, 'Shared project').getByTestId('add-task-input').fill('Second action');
		await projectCard(b, 'Shared project')
			.getByRole('button', { name: 'Add', exact: true })
			.click();

		const later = projectCard(b, 'Shared project')
			.getByTestId('task-row')
			.filter({ hasText: 'Second action' });
		await later.getByTestId('task-promote').click();
		await expect(projectCard(b, 'Shared project').getByTestId('next-action')).toContainText(
			'Second action'
		);

		// The server is the arbiter, so A must agree — and there must be exactly one.
		await refresh(a);
		await expect(projectCard(a, 'Shared project').getByTestId('next-action')).toContainText(
			'Second action'
		);

		const flagged = await a.evaluate(async () => {
			const response = await fetch('/api/sync?since=0');
			const body = (await response.json()) as { tasks: Array<{ isNextAction: boolean }> };
			return body.tasks.filter((t) => t.isNextAction).length;
		});
		expect(flagged).toBe(1);

		await a.context().close();
		await b.context().close();
	});

	test('signing out removes this device’s copy but not the account’s data', async ({ browser }) => {
		const a = await openDevice(browser);
		const email = await signUp(a);
		await a.getByTestId('welcome-skip').click();
		await createProject(a, 'Still here afterwards');

		await a.getByTestId('nav-settings').click();
		await expect(a.getByTestId('account-email')).toContainText(email);
		await a.getByTestId('sign-out').click();
		await expect(a.getByTestId('auth-submit')).toBeVisible();

		// Nothing left locally...
		const localRows = await a.evaluate(async () => {
			const db = await new Promise<IDBDatabase>((resolve, reject) => {
				const request = indexedDB.open('cairn');
				request.onsuccess = () => resolve(request.result);
				request.onerror = () => reject(request.error);
			});
			return new Promise<number>((resolve) => {
				const r = db.transaction('projects').objectStore('projects').getAll();
				r.onsuccess = () => resolve((r.result as unknown[]).length);
			});
		});
		expect(localRows).toBe(0);

		// ...but signing back in brings it all home.
		const b = await joinAs(browser, email);
		await gotoProjects(b);
		await expect(projectCard(b, 'Still here afterwards')).toBeVisible();

		await a.context().close();
		await b.context().close();
	});

	test('one account cannot see another account’s data', async ({ browser }) => {
		const a = await openDevice(browser);
		await signUp(a);
		await a.getByTestId('welcome-skip').click();
		await createProject(a, 'Private to the first account');

		const b = await openDevice(browser);
		await signUp(b, uniqueEmail());
		await b.getByTestId('welcome-skip').click();
		await gotoProjects(b);

		await expect(b.getByTestId('empty-projects')).toBeVisible();
		await expect(projectCard(b, 'Private to the first account')).toHaveCount(0);

		await a.context().close();
		await b.context().close();
	});

	test('a capture made offline is queued and sent on reconnect', async ({ browser }) => {
		const a = await openDevice(browser);
		const email = await signUp(a);
		await a.getByTestId('welcome-skip').click();
		await expect(a.locator('dialog[open]')).toHaveCount(0);

		await a.context().setOffline(true);
		await a.getByTestId('open-capture').click();
		const dialog = a.locator('dialog[open]');
		await dialog.getByTestId('capture-input').fill('Thought had on a train');
		await dialog.getByTestId('capture-submit').click();
		// It lands locally straight away — capture is the one write that never waits.
		await expect(dialog.getByTestId('capture-added')).toContainText('Thought had on a train');
		await a.keyboard.press('Escape');

		await a.context().setOffline(false);
		// Coming back online flushes the queue.
		await a.getByTestId('nav-settings').click();
		await a.getByTestId('sync-now').click();
		await expect(a.getByTestId('account-email')).toBeVisible();

		const b = await joinAs(browser, email);
		await b.getByTestId('nav-inbox').first().click();
		await expect(b.getByTestId('inbox-item')).toContainText('Thought had on a train');

		await a.context().close();
		await b.context().close();
	});
});
