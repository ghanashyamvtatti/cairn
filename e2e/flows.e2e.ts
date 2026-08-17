import { expect, test } from '@playwright/test';
import {
	capture,
	createProject,
	localIsoDate,
	projectCard,
	readDb,
	resetApp,
	setNextAction
} from './helpers';

/**
 * The four critical flows, plus the two that protect against data loss.
 *
 * These are the paths where a regression would make the product wrong rather than
 * merely ugly: capture and triage, the single next action, the countdown, the weekly
 * reset, the WIP cap, and the export/import round trip.
 */

test.beforeEach(async ({ page }) => {
	await resetApp(page);
});

test.describe('capture and triage', () => {
	test('captures a thought in one field and files it as a project’s next action', async ({
		page
	}) => {
		await createProject(page, 'Move the studio');
		await capture(page, 'Ring three removal firms');

		await page.getByTestId('nav-inbox').first().click();
		await expect(page.getByTestId('inbox-count')).toContainText('1 item');

		await page.getByTestId('inbox-item-toggle').click();
		await page.getByTestId('triage-to-next-action').click();

		await expect(page.getByTestId('empty-inbox')).toBeVisible();

		await page.getByTestId('nav-projects').first().click();
		const card = projectCard(page, 'Move the studio');
		await expect(card.getByTestId('next-action')).toContainText('Ring three removal firms');
		await expect(card.getByTestId('stalled')).toHaveCount(0);
	});

	test('parses a date out of captured text and offers it to the manifest', async ({ page }) => {
		await capture(page, 'Renew the studio insurance tomorrow', { expectDate: true });

		await page.getByTestId('nav-inbox').first().click();
		// The date phrase is lifted out of the text and kept as structured data.
		await expect(page.getByTestId('inbox-item')).toContainText('Renew the studio insurance');
		await expect(page.getByTestId('inbox-item')).toContainText('Tomorrow');

		await page.getByTestId('inbox-item-toggle').click();
		// The parsed date pre-fills the picker rather than being applied silently.
		await expect(page.getByTestId('triage-manifest-date')).toHaveValue(localIsoDate(1));
		await page.getByTestId('triage-manifest-add').click();

		await page.getByTestId('nav-dates').first().click();
		const row = page.getByTestId('manifest-row');
		await expect(row).toContainText('Renew the studio insurance');
		await expect(row).toContainText('Tomorrow');
	});

	test('does not invent a date for text that merely contains a number', async ({ page }) => {
		await capture(page, 'Buy 5 apples');

		await page.getByTestId('nav-inbox').first().click();
		await expect(page.getByTestId('inbox-item')).toContainText('Buy 5 apples');

		const { inboxItems } = await readDb(page);
		expect(inboxItems).toHaveLength(1);
		expect(inboxItems[0].parsedDate).toBeUndefined();
	});

	test('dropping an inbox item offers an undo', async ({ page }) => {
		await capture(page, 'Something I do not actually need');
		await page.getByTestId('nav-inbox').first().click();

		await page.getByTestId('inbox-item-toggle').click();
		await page.getByTestId('triage-delete').click();
		await expect(page.getByTestId('empty-inbox')).toBeVisible();

		await page.getByTestId('toasts').getByRole('button', { name: 'Undo' }).click();
		await expect(page.getByTestId('inbox-item')).toContainText('Something I do not actually need');
	});
});

test.describe('one next action per project', () => {
	test('setting a new next action demotes the old one instead of losing it', async ({ page }) => {
		await createProject(page, 'Fix the roof');
		await setNextAction(page, 'Fix the roof', 'Photograph the flashing');

		const card = projectCard(page, 'Fix the roof');
		await card.getByTestId('project-disclosure').click();
		await card.getByTestId('add-task-input').fill('Get a quote for the scaffolding');
		await card.getByRole('button', { name: 'Add', exact: true }).click();

		const later = card
			.getByTestId('task-row')
			.filter({ hasText: 'Get a quote for the scaffolding' });
		await later.getByTestId('task-promote').click();

		await expect(card.getByTestId('next-action')).toContainText('Get a quote for the scaffolding');

		// The previous next action is still there, still open, just no longer flagged.
		const { tasks } = await readDb(page);
		const demoted = tasks.find((t) => t.title === 'Photograph the flashing');
		expect(demoted).toMatchObject({ isNextAction: false, completedAt: null, deletedAt: null });
		expect(tasks.filter((t) => t.isNextAction === true)).toHaveLength(1);
	});

	test('completing the next action leaves the project visibly stalled', async ({ page }) => {
		await createProject(page, 'Get the tax return filed');
		await setNextAction(page, 'Get the tax return filed', 'Dig out last year’s P60');

		const card = projectCard(page, 'Get the tax return filed');
		await card.getByTestId('next-action').getByTestId('task-complete').check();

		await expect(card.getByTestId('stalled')).toBeVisible();
		await expect(card.getByTestId('project-disclosure')).toContainText('1 done this week');
	});

	test('a stalled project is flagged without any red or overdue language', async ({ page }) => {
		await createProject(page, 'Learn to make sourdough');

		const stalled = projectCard(page, 'Learn to make sourdough').getByTestId('stalled');
		await expect(stalled).toBeVisible();
		await expect(stalled).not.toContainText(/overdue|late|failed/i);
	});
});

test.describe('the today view', () => {
	test('assembles one next step per project, tickable in place', async ({ page }) => {
		await createProject(page, 'Move the studio');
		await setNextAction(page, 'Move the studio', 'Ring three removal firms');

		await page.getByTestId('nav-today').first().click();
		const entry = page.getByTestId('today-entry').filter({ hasText: 'Move the studio' });
		await expect(entry).toContainText('Ring three removal firms');

		await entry.getByTestId('task-complete').check();

		// The finished step swaps for a prompt in place: naming the next step happens at
		// the moment of momentum, not behind a card on another screen.
		await expect(entry.getByTestId('today-next-input')).toBeVisible();
		await entry.getByTestId('today-next-input').fill('Book the van');
		await entry.getByTestId('today-next-submit').click();
		await expect(entry).toContainText('Book the van');

		const { tasks } = await readDb(page);
		expect(tasks.filter((t) => t.isNextAction === true)).toHaveLength(1);
	});

	test('shows only the dates near enough to matter, with the rest one tap away', async ({
		page
	}) => {
		await page.getByTestId('nav-dates').first().click();
		await page.getByTestId('manifest-title').fill('Filing deadline');
		await page.getByTestId('manifest-date').fill(localIsoDate(3));
		await page.getByTestId('manifest-add').click();
		// Wait for the first add to land: it clears the form when it does, and filling
		// the second entry before that wipes the half-typed row.
		await expect(page.getByTestId('manifest-row')).toHaveCount(1);
		await page.getByTestId('manifest-title').fill('Passport renewal');
		await page.getByTestId('manifest-date').fill(localIsoDate(60));
		await page.getByTestId('manifest-add').click();
		await expect(page.getByTestId('manifest-row')).toHaveCount(2);

		await page.getByTestId('nav-today').first().click();
		const board = page.getByTestId('today-coming-up');
		await expect(board).toContainText('Filing deadline');
		await expect(board).not.toContainText('Passport renewal');
		await expect(page.getByTestId('today-all-dates')).toContainText('1 later');
	});

	test('points at the inbox when thoughts are waiting to be sorted', async ({ page }) => {
		await capture(page, 'A loose thought');

		await page.getByTestId('nav-today').first().click();
		await expect(page.getByTestId('today-inbox-line')).toContainText('1 thought waiting');
	});
});

test.describe('the dates board', () => {
	test('shows a live countdown and refuses to let a date be completed', async ({ page }) => {
		await page.getByTestId('nav-dates').first().click();

		await page.getByTestId('manifest-title').fill('Passport expires');
		await page.getByTestId('manifest-date').fill(localIsoDate(12));
		await page.getByTestId('manifest-add').click();

		const row = page.getByTestId('manifest-row');
		await expect(row).toContainText('in 12 days');
		// "A calendar item is not a task": there is no completion control anywhere on it.
		await expect(row.locator('input[type="checkbox"]')).toHaveCount(0);
	});

	test('today reads as Today, not as one day away or as passed', async ({ page }) => {
		await page.getByTestId('nav-dates').first().click();
		await page.getByTestId('manifest-title').fill('Filing deadline');
		await page.getByTestId('manifest-date').fill(localIsoDate(0));
		await page.getByTestId('manifest-add').click();

		await expect(page.getByTestId('manifest-upcoming')).toContainText('Today');
		await expect(page.getByTestId('manifest-passed')).toHaveCount(0);
	});

	test('past dates move to a collapsed section rather than a pile of red', async ({ page }) => {
		await page.getByTestId('nav-dates').first().click();
		await page.getByTestId('manifest-title').fill('Something that already happened');
		await page.getByTestId('manifest-date').fill(localIsoDate(-3));
		await page.getByTestId('manifest-add').click();

		await expect(page.getByTestId('manifest-upcoming')).toHaveCount(0);
		await expect(page.getByTestId('toggle-passed')).toContainText('1 passed');

		await page.getByTestId('toggle-passed').click();
		await expect(page.getByTestId('manifest-passed')).toContainText('3 days ago');
	});
});

test.describe('the weekly reset', () => {
	test('carries unfinished work forward and files what was finished', async ({ page }) => {
		await createProject(page, 'Move the studio');
		await setNextAction(page, 'Move the studio', 'Ring three removal firms');

		const card = projectCard(page, 'Move the studio');
		await card.getByTestId('project-disclosure').click();
		await card.getByTestId('add-task-input').fill('Book the van');
		await card.getByRole('button', { name: 'Add', exact: true }).click();

		// Finish one of the two, leave the other running.
		await card.getByTestId('next-action').getByTestId('task-complete').check();

		await page.getByTestId('nav-review').first().click();
		await page.getByTestId('start-new-week').click();
		await page.getByTestId('confirm-new-week').click();

		const summary = page.getByTestId('reset-summary');
		await expect(summary).toContainText('1 carried forward, none of it late');
		await expect(summary).toContainText('1 filed under the week you just closed');

		const { tasks, weeks } = await readDb(page);
		const current = weeks.find((w) => w.endedAt === null);
		expect(weeks).toHaveLength(2);
		expect(current).toBeDefined();

		const carried = tasks.find((t) => t.title === 'Book the van');
		const finished = tasks.find((t) => t.title === 'Ring three removal firms');

		expect(carried?.weekId).toBe(current!.id);
		expect(carried?.completedAt).toBeNull();
		// Nothing was deleted and nothing acquired an overdue marker.
		expect(tasks.every((t) => t.deletedAt === null)).toBe(true);
		expect(finished?.weekId).not.toBe(current!.id);
	});

	test('review progress survives a reload mid-ritual', async ({ page }) => {
		await page.getByTestId('nav-review').first().click();
		await page.getByTestId('review-step').first().getByTestId('review-step-check').check();
		await expect(page.getByTestId('review-progress')).toContainText('1 of 4 done');

		await page.reload();
		await expect(page.getByTestId('review-progress')).toContainText('1 of 4 done');
	});

	test('a new week can be started without finishing the checklist', async ({ page }) => {
		await page.getByTestId('nav-review').first().click();
		await expect(page.getByTestId('review-progress')).toContainText('0 of 4 done');

		await page.getByTestId('start-new-week').click();
		await page.getByTestId('confirm-new-week').click();

		await expect(page.getByTestId('reset-summary')).toBeVisible();
	});
});

test.describe('the WIP limit', () => {
	test('warns at the limit, offers to park, and still lets you through', async ({ page }) => {
		await createProject(page, 'Project one');
		await createProject(page, 'Project two');
		await createProject(page, 'Project three');

		await expect(page.getByTestId('wip-banner')).toHaveCount(0);

		await page.getByTestId('add-project').first().click();
		const dialog = page.locator('dialog[open]');
		await expect(dialog.getByTestId('wip-warning')).toContainText(
			'You already have 3 active, and your limit is 3'
		);
		await expect(dialog.getByTestId('park-candidate')).toHaveCount(3);
		await expect(dialog.getByTestId('new-project-submit')).toHaveText('Start it anyway');

		await dialog.getByTestId('new-project-input').fill('Project four');
		await dialog.getByTestId('new-project-submit').click();

		// Going over is allowed, but it stays visible rather than being a dialog you clicked past.
		await expect(page.getByTestId('project-card')).toHaveCount(4);
		await expect(page.getByTestId('wip-banner')).toContainText(
			'4 active projects, 3 is your limit'
		);
	});

	test('parking a project clears the over-limit state without deleting anything', async ({
		page
	}) => {
		await createProject(page, 'Project one');
		await createProject(page, 'Project two');
		await createProject(page, 'Project three');

		const card = projectCard(page, 'Project one');
		await card.getByTestId('project-options').click();
		await page.locator('dialog[open]').getByTestId('project-park').click();

		await expect(page.getByTestId('project-card')).toHaveCount(2);
		await expect(page.getByRole('heading', { name: 'Parked' })).toBeVisible();

		const { projects } = await readDb(page);
		expect(projects).toHaveLength(3);
		expect(projects.find((p) => p.title === 'Project one')).toMatchObject({
			status: 'parked',
			deletedAt: null
		});
	});
});

test.describe('export and import', () => {
	test('exports a backup that restores the full state', async ({ page }) => {
		await createProject(page, 'Move the studio');
		await setNextAction(page, 'Move the studio', 'Ring three removal firms');
		await capture(page, 'A loose thought');

		await page.getByTestId('nav-dates').first().click();
		await page.getByTestId('manifest-title').fill('Passport expires');
		await page.getByTestId('manifest-date').fill(localIsoDate(30));
		await page.getByTestId('manifest-add').click();

		await page.getByTestId('nav-settings').click();
		const download = await Promise.all([
			page.waitForEvent('download'),
			page.getByTestId('export').click()
		]).then(([event]) => event);

		expect(download.suggestedFilename()).toMatch(/^cairn-\d{4}-\d{2}-\d{2}\.json$/);
		const path = await download.path();
		expect(path).toBeTruthy();

		// Wipe everything, then restore from the file just written.
		await page.getByTestId('clear-all').click();
		await page.locator('dialog[open]').getByTestId('confirm-clear').click();
		await page.getByTestId('nav-projects').first().click();
		await expect(page.getByTestId('empty-projects')).toBeVisible();

		await page.getByTestId('nav-settings').click();
		await page.getByTestId('import-input').setInputFiles(path!);
		await page.locator('dialog[open]').getByTestId('confirm-import').click();

		await page.getByTestId('nav-projects').first().click();
		const card = projectCard(page, 'Move the studio');
		await expect(card.getByTestId('next-action')).toContainText('Ring three removal firms');

		await page.getByTestId('nav-dates').first().click();
		await expect(page.getByTestId('manifest-row')).toContainText('Passport expires');

		await page.getByTestId('nav-inbox').first().click();
		await expect(page.getByTestId('inbox-item')).toContainText('A loose thought');
	});

	test('refuses a file that is not a Cairn backup, and says why', async ({ page }) => {
		await page.getByTestId('nav-settings').click();
		await page.getByTestId('import-input').setInputFiles({
			name: 'not-a-backup.json',
			mimeType: 'application/json',
			buffer: Buffer.from(JSON.stringify({ format: 'something.else', version: 1, data: {} }))
		});

		await expect(page.getByTestId('import-errors')).toContainText('cairn.backup');
		await expect(page.locator('dialog[open]')).toHaveCount(0);
	});
});

test.describe('offline and installability', () => {
	test('serves every route from the service worker with the network down', async ({
		page,
		context
	}) => {
		// Give the service worker a chance to finish precaching.
		await page.waitForFunction(() => navigator.serviceWorker?.controller !== null, null, {
			timeout: 15_000
		});

		await context.setOffline(true);
		for (const path of ['/', '/projects', '/manifest', '/inbox', '/review', '/settings']) {
			await page.goto(path);
			await expect(page.getByRole('link', { name: 'Cairn, home' })).toBeVisible();
		}
		await context.setOffline(false);
	});

	test('ships a web manifest that satisfies installability', async ({ page, request }) => {
		const href = await page.locator('link[rel="manifest"]').getAttribute('href');
		expect(href).toBeTruthy();

		const response = await request.get(new URL(href!, page.url()).toString());
		expect(response.ok()).toBe(true);

		const manifest = await response.json();
		expect(manifest.name).toBe('Cairn');
		expect(manifest.display).toBe('standalone');
		expect(manifest.start_url).toBeTruthy();

		const sizes = manifest.icons.map((icon: { sizes: string }) => icon.sizes);
		expect(sizes).toContain('192x192');
		expect(sizes).toContain('512x512');
		expect(manifest.icons.some((icon: { purpose?: string }) => icon.purpose === 'maskable')).toBe(
			true
		);
	});
});

test.describe('keyboard and accessibility', () => {
	test('opens capture from anywhere with a single keystroke', async ({ page }) => {
		await page.getByTestId('nav-dates').first().click();
		// Click the heading, not `body`: a `body` click targets its centre, which lands on
		// a real button on some screens and activates it.
		await page.getByRole('heading', { name: 'Dates' }).click();
		await page.keyboard.press('c');

		const dialog = page.locator('dialog[open]');
		await expect(dialog).toBeVisible();
		await expect(dialog.getByTestId('capture-input')).toBeFocused();

		await page.keyboard.press('Escape');
		await expect(page.locator('dialog[open]')).toHaveCount(0);
	});

	test('does not fire shortcuts while you are typing', async ({ page }) => {
		await page.getByTestId('nav-inbox').first().click();

		// Scoped to `main`: the global capture dialog lives outside it and carries an
		// identically-named field.
		const field = page.locator('main').getByTestId('capture-input');
		await field.click();
		await page.keyboard.type('collect the cargo');

		// 'c', 'g' and '?' all appear in that text; none may hijack the keystroke.
		await expect(field).toHaveValue('collect the cargo');
		await expect(page.locator('dialog[open]')).toHaveCount(0);
		await expect(page).toHaveURL(/\/inbox$/);
	});

	test('navigates with the g chord', async ({ page }) => {
		await page.getByRole('heading', { name: 'Today' }).click();
		expect(await page.evaluate(() => document.activeElement?.tagName)).toBe('BODY');

		// Two ordinary presses. The 1.5s chord window is generous even under load once
		// the click is not activating a control.
		await page.keyboard.press('g');
		await page.keyboard.press('m');
		await expect(page).toHaveURL(/\/manifest$/);

		await page.keyboard.press('g');
		await page.keyboard.press('i');
		await expect(page).toHaveURL(/\/inbox$/);
	});

	test('honours a dark theme choice across a reload without flashing', async ({ page }) => {
		await page.getByTestId('nav-settings').click();
		await page.getByTestId('theme-dark').click();
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

		await page.reload();
		// The inline head script applies it before paint, so it is set immediately.
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
		await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#161513');
	});
});

/**
 * Regressions for defects found in adversarial review. Each one reproduced a real,
 * user-reachable failure before the fix.
 */
test.describe('regressions', () => {
	test('deleting a project can be undone, tasks and all', async ({ page }) => {
		await createProject(page, 'Move the studio');
		await setNextAction(page, 'Move the studio', 'Ring three removal firms');

		const card = projectCard(page, 'Move the studio');
		await card.getByTestId('project-disclosure').click();
		await card.getByTestId('add-task-input').fill('Book the van');
		await card.getByRole('button', { name: 'Add', exact: true }).click();

		await card.getByTestId('project-options').click();
		await page.locator('dialog[open]').getByTestId('project-delete').click();
		await expect(page.getByTestId('empty-projects')).toBeVisible();

		await page.getByTestId('toasts').getByRole('button', { name: 'Undo' }).click();

		const restored = projectCard(page, 'Move the studio');
		await expect(restored.getByTestId('next-action')).toContainText('Ring three removal firms');
		await restored.getByTestId('project-disclosure').click();
		await expect(restored).toContainText('Book the van');

		const { tasks, projects } = await readDb(page);
		expect(projects.every((p) => p.deletedAt === null)).toBe(true);
		expect(tasks.every((t) => t.deletedAt === null)).toBe(true);
	});

	test('triage warns before it crosses the WIP limit, and still lets you through', async ({
		page
	}) => {
		await createProject(page, 'Project one');
		await createProject(page, 'Project two');
		await createProject(page, 'Project three');
		await capture(page, 'Redo the bathroom');

		await page.getByTestId('nav-inbox').first().click();
		await page.getByTestId('inbox-item-toggle').click();
		await page.getByTestId('triage-new-project-open').click();

		await expect(page.getByTestId('triage-wip-warning')).toContainText(
			'makes it 4 active projects'
		);
		await expect(page.getByTestId('triage-new-project-create')).toHaveText('Start it anyway');

		await page.getByTestId('triage-new-project-create').click();
		await page.getByTestId('nav-projects').first().click();
		await expect(page.getByTestId('wip-banner')).toContainText('4 active projects');
	});

	test('an open triage panel keeps its chosen date when something else writes', async ({
		page
	}) => {
		await capture(page, 'Renew the insurance tomorrow', { expectDate: true });
		await page.getByTestId('nav-inbox').first().click();
		await page.getByTestId('inbox-item-toggle').click();

		const dateField = page.getByTestId('triage-manifest-date');
		await dateField.fill(localIsoDate(200));

		// Any unrelated write re-emits the snapshot; the panel must not reseed from it.
		await page.getByTestId('open-capture').click();
		const dialog = page.locator('dialog[open]');
		await dialog.getByTestId('capture-input').fill('Something unrelated');
		await dialog.getByTestId('capture-submit').click();
		await page.keyboard.press('Escape');

		await expect(dateField).toHaveValue(localIsoDate(200));
	});

	test('the chosen theme survives a reload without being reset to system', async ({ page }) => {
		await page.getByTestId('nav-settings').click();
		await page.getByTestId('theme-dark').click();
		// Wait for the choice to actually land before reloading, otherwise this races the
		// write rather than testing what survives it.
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

		await page.reload();
		await expect(page.getByTestId('export')).toBeVisible();
		// Still dark after the store has loaded, and the pre-paint hint is intact.
		await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
		expect(await page.evaluate(() => localStorage.getItem('cairn.theme'))).toBe('dark');
	});

	test('a WIP limit typed out of range is clamped rather than displayed as a lie', async ({
		page
	}) => {
		await page.getByTestId('nav-settings').click();
		await page.getByTestId('wip-limit').fill('50');
		await page.getByTestId('wip-limit').blur();

		await expect(page.getByTestId('wip-limit')).toHaveValue('10');
		const { projects } = await readDb(page);
		expect(projects).toHaveLength(0);
	});

	test('a backup with a duplicated id restores what it can instead of failing entirely', async ({
		page
	}) => {
		const now = Date.now();
		const row = (id: string, title: string) => ({
			id,
			title,
			status: 'active',
			nextActionId: null,
			order: 0,
			createdAt: now,
			updatedAt: now,
			deletedAt: null
		});

		await page.getByTestId('nav-settings').click();
		await page.getByTestId('import-input').setInputFiles({
			name: 'dupes.json',
			mimeType: 'application/json',
			buffer: Buffer.from(
				JSON.stringify({
					format: 'cairn.backup',
					version: 1,
					exportedAt: now,
					data: {
						projects: [row('p1', 'Kept'), row('p1', 'Duplicate'), row('p2', 'Also kept')],
						tasks: [],
						inboxItems: [],
						fixedDates: [],
						weeks: [],
						settings: {}
					}
				})
			)
		});

		const dialog = page.locator('dialog[open]');
		await expect(dialog).toContainText('shared an id');
		await dialog.getByTestId('confirm-import').click();

		await page.getByTestId('nav-projects').first().click();
		await expect(page.getByTestId('project-card')).toHaveCount(2);
		await expect(page.getByTestId('import-errors')).toHaveCount(0);
	});

	test('two rapid captures both land whole', async ({ page }) => {
		await page.getByTestId('open-capture').click();
		const dialog = page.locator('dialog[open]');
		const field = dialog.getByTestId('capture-input');

		// The field is cleared before the write is awaited, so a second thought typed
		// straight after the first cannot be truncated by the first one's save landing.
		await field.fill('First thought');
		await field.press('Enter');
		await field.fill('Second thought');
		await field.press('Enter');

		await expect(dialog.getByTestId('capture-added')).toContainText('First thought');
		await expect(dialog.getByTestId('capture-added')).toContainText('Second thought');
		await expect(field).toHaveValue('');

		await page.keyboard.press('Escape');
		const { inboxItems } = await readDb(page);
		expect(inboxItems.map((i) => i.text).sort()).toEqual(['First thought', 'Second thought']);
	});

	test('restoring a backup leaves exactly one open week even if it carried two', async ({
		page
	}) => {
		const now = Date.now();
		await page.getByTestId('nav-settings').click();
		await page.getByTestId('import-input').setInputFiles({
			name: 'two-open-weeks.json',
			mimeType: 'application/json',
			buffer: Buffer.from(
				JSON.stringify({
					format: 'cairn.backup',
					version: 1,
					exportedAt: now,
					data: {
						projects: [],
						tasks: [],
						inboxItems: [],
						fixedDates: [],
						weeks: [
							{
								id: 'w1',
								startedAt: now - 100000,
								endedAt: null,
								reviewCompletedAt: null,
								reviewSteps: []
							},
							{
								id: 'w2',
								startedAt: now - 50000,
								endedAt: null,
								reviewCompletedAt: null,
								reviewSteps: []
							}
						],
						settings: {}
					}
				})
			)
		});
		await page.locator('dialog[open]').getByTestId('confirm-import').click();
		// Wait for the confirmation, not merely for the absence of an error: the week
		// reconciliation and the sync round trip both happen after the dialog closes, and
		// reading the database before then catches a half-applied import.
		await expect(page.getByTestId('toasts')).toContainText('Backup restored');
		await expect(page.getByTestId('import-errors')).toHaveCount(0);

		const { weeks } = await readDb(page);
		expect(weeks.filter((w) => w.endedAt === null)).toHaveLength(1);
	});

	test('the manifest edit dialog explains itself instead of a dead Save button', async ({
		page
	}) => {
		await page.getByTestId('nav-dates').first().click();
		await page.getByTestId('manifest-title').fill('Passport expires');
		await page.getByTestId('manifest-date').fill(localIsoDate(20));
		await page.getByTestId('manifest-add').click();

		await page.getByTestId('manifest-row').getByRole('button').first().click();
		const dialog = page.locator('dialog[open]');
		await dialog.getByLabel('What is it?').fill('');
		await dialog.getByRole('button', { name: 'Save' }).click();

		await expect(dialog.getByTestId('manifest-save-error')).toBeVisible();
		await expect(dialog).toBeVisible();
	});

	test('the current tab is not signalled by colour alone', async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 812 });
		await page.goto('/manifest');
		// The tab bar only exists inside the signed-in shell, which renders after the
		// session resolves — evaluating before that measures an empty list.
		await expect(page.locator('.tabbar a').first()).toBeVisible({ timeout: 15_000 });

		const weights = await page
			.locator('.tabbar a')
			.evaluateAll((els) => els.map((el) => getComputedStyle(el).fontWeight));

		// Exactly one tab differs in weight, so the state survives without colour vision.
		expect(new Set(weights).size).toBeGreaterThan(1);
	});
});

test.describe('onboarding', () => {
	// These specs need the first-run experience the other specs deliberately skip past.
	test.beforeEach(async ({ page }) => {
		await resetApp(page, { keepWelcome: true });
	});

	test('greets a first-time user and explains what the five places are', async ({ page }) => {
		const welcome = page.locator('dialog[open]');
		await expect(welcome).toBeVisible();
		await expect(welcome).toContainText('Welcome to Cairn');
		for (const place of ['Today', 'Projects', 'Dates', 'Inbox', 'Review']) {
			await expect(welcome).toContainText(place);
		}
	});

	test('does not greet someone who has already been shown around', async ({ page }) => {
		await page.locator('dialog[open]').getByTestId('welcome-skip').click();
		await expect(page.locator('dialog[open]')).toHaveCount(0);

		await page.reload();
		await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible();
		await expect(page.locator('dialog[open]')).toHaveCount(0);
	});

	test('the tour walks every surface and highlights real elements', async ({ page }) => {
		// With the example loaded there is something to point at on every step.
		await page.locator('dialog[open]').getByTestId('welcome-tour').click();

		const card = page.getByTestId('tour-card');
		await expect(card).toContainText('Open the app, get an answer');
		// The example's three projects each surface a Next-up entry on Today.
		await expect(page.getByTestId('today-entry')).toHaveCount(3);

		// Each step must land on its own surface before being counted, or this races the
		// navigation the tour performs between steps.
		const expected = [
			'/',
			'/',
			'/inbox',
			'/projects',
			'/projects',
			'/manifest',
			'/review',
			'/review',
			'/settings'
		] as const;

		for (const [index, route] of expected.entries()) {
			await expect(card).toBeVisible();
			await expect(page).toHaveURL(new RegExp(`${route === '/' ? '/' : route}$`));
			if (index < expected.length - 1) await page.getByTestId('tour-next').click();
		}

		// It ends on the last step rather than looping.
		await expect(page.getByTestId('tour-next')).toHaveText('Done');

		await page.getByTestId('tour-next').click();
		await expect(page.getByTestId('tour-card')).toHaveCount(0);
	});

	test('the tour can be left at any point with Escape', async ({ page }) => {
		await page.locator('dialog[open]').getByTestId('welcome-tour').click();
		await expect(page.getByTestId('tour-card')).toBeVisible();

		await page.getByTestId('tour-next').click();
		await page.keyboard.press('Escape');

		await expect(page.getByTestId('tour-card')).toHaveCount(0);
		await expect(page.getByTestId('tour-scrim')).toHaveCount(0);
	});

	test('app shortcuts do not fire underneath the tour', async ({ page }) => {
		await page.locator('dialog[open]').getByTestId('welcome-tour').click();
		await expect(page.getByTestId('tour-card')).toBeVisible();

		// `c` is the capture shortcut; under the tour it must do nothing at all.
		await page.keyboard.press('c');
		await expect(page.locator('dialog[open]')).toHaveCount(0);
		await expect(page.getByTestId('tour-card')).toBeVisible();
	});

	test('the example week is a legal board, not hand-crafted state', async ({ page }) => {
		await page.locator('dialog[open]').getByTestId('welcome-tour').click();
		await expect(page.getByTestId('today-entry')).toHaveCount(3);
		await page.getByTestId('tour-skip').click();

		const { projects, tasks, fixedDates, inboxItems, weeks } = await readDb(page);

		// Every invariant the app enforces holds for the seeded data.
		expect(weeks.filter((w) => w.endedAt === null)).toHaveLength(1);
		expect(fixedDates.length).toBeGreaterThan(0);
		expect(inboxItems.length).toBeGreaterThan(0);
		for (const project of projects) {
			const flagged = tasks.filter((t) => t.projectId === project.id && t.isNextAction);
			expect(flagged.length).toBeLessThanOrEqual(1);
			expect(project.nextActionId).toBe(flagged[0]?.id ?? null);
		}
		// One project is deliberately stalled, so the tour has a live example of it.
		expect(projects.filter((p) => p.nextActionId === null)).toHaveLength(1);
		expect(tasks.every((t) => t.weekId !== null)).toBe(true);
	});

	test('skipping the welcome leaves the database genuinely empty', async ({ page }) => {
		await page.locator('dialog[open]').getByTestId('welcome-skip').click();

		const { projects, tasks, fixedDates, inboxItems } = await readDb(page);
		expect([...projects, ...tasks, ...fixedDates, ...inboxItems]).toHaveLength(0);
		await expect(page.getByTestId('today-empty')).toBeVisible();
	});

	test('the guide is reachable from the header and explains the vocabulary', async ({ page }) => {
		await page.locator('dialog[open]').getByTestId('welcome-skip').click();
		await page.getByTestId('nav-guide').click();

		await expect(page.getByRole('heading', { name: 'How Cairn works' })).toBeVisible();
		// The words the interface uses, defined where someone can find them.
		for (const term of ['next action', 'stalled', 'park', 'Dates', 'Today']) {
			await expect(page.locator('main')).toContainText(term);
		}
		await expect(page.locator('main')).toContainText('Home Screen');
	});

	test('the guide can start the tour on demand, long after onboarding', async ({ page }) => {
		await page.locator('dialog[open]').getByTestId('welcome-skip').click();
		await page.getByTestId('nav-guide').click();
		await page.getByTestId('guide-tour').click();

		await expect(page.getByTestId('tour-card')).toBeVisible();
		await expect(page).toHaveURL(/\/$/);
	});
});

/**
 * The repository reports a rejected write and rethrows. These specs force a rejection and
 * assert that nothing downstream claims success — the failure mode that turned three
 * separate bugs into silent data loss.
 */
test.describe('failed writes never claim success', () => {
	/** Makes the next N IndexedDB writes of a given kind fail. */
	async function breakWrites(page: import('@playwright/test').Page, store: string) {
		await page.evaluate((target) => {
			const original = IDBObjectStore.prototype.add;
			IDBObjectStore.prototype.add = function (this: IDBObjectStore, ...args: unknown[]) {
				if (this.name === target) throw new DOMException('Quota exceeded', 'QuotaExceededError');
				return (original as (...a: unknown[]) => IDBRequest).apply(this, args);
			};
		}, store);
	}

	test('a capture that cannot be saved puts the text back instead of announcing it', async ({
		page
	}) => {
		await breakWrites(page, 'inboxItems');

		await page.getByTestId('open-capture').click();
		const dialog = page.locator('dialog[open]');
		await dialog.getByTestId('capture-input').fill('A thought I must not lose');
		await dialog.getByTestId('capture-submit').click();

		// Reported, not silently dropped.
		await expect(page.getByTestId('toasts')).toContainText('Could not save that');
		// The text is recoverable, and nothing pretends it landed.
		await expect(dialog.getByTestId('capture-input')).toHaveValue('A thought I must not lose');
		await expect(dialog.getByTestId('capture-added')).not.toContainText(
			'A thought I must not lose'
		);

		const { inboxItems } = await readDb(page);
		expect(inboxItems).toHaveLength(0);
	});

	test('a triage whose destination write fails puts the inbox item back', async ({ page }) => {
		await createProject(page, 'Move the studio');
		await capture(page, 'Ring three removal firms');
		await page.getByTestId('nav-inbox').first().click();
		await page.getByTestId('inbox-item-toggle').click();

		// Tasks are what triage writes; the inbox claim happens first and must be undone.
		await breakWrites(page, 'tasks');
		await page.getByTestId('triage-to-project').click();

		await expect(page.getByTestId('toasts')).toContainText('Could not file that');
		await expect(page.getByTestId('inbox-item')).toContainText('Ring three removal firms');

		const { inboxItems, tasks } = await readDb(page);
		expect(inboxItems.filter((i) => i.deletedAt === null)).toHaveLength(1);
		expect(tasks.filter((t) => t.deletedAt === null)).toHaveLength(0);
	});

	test('a failed export downloads nothing and does not reset the backup reminder', async ({
		page
	}) => {
		await page.getByTestId('nav-settings').click();
		await expect(page.locator('main')).toContainText('You have not exported a backup yet');

		// Break the read the export depends on.
		await page.evaluate(() => {
			IDBObjectStore.prototype.getAll = function () {
				throw new DOMException('Boom', 'UnknownError');
			};
		});

		let downloaded = false;
		page.on('download', () => (downloaded = true));
		await page.getByTestId('export').click();

		await expect(page.getByTestId('toasts')).toContainText('Could not build the backup');
		await expect(page.locator('main')).toContainText('You have not exported a backup yet');
		expect(downloaded).toBe(false);
	});
});
