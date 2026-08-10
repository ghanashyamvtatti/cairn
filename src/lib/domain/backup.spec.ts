import { describe, expect, it } from 'vitest';
import {
	BACKUP_FORMAT,
	BACKUP_VERSION,
	backupFilename,
	buildBackup,
	countBackup,
	parseBackup,
	repairReferences,
	serializeBackup,
	withSettingDefaults,
	type BackupData,
	type ImportResult
} from '$lib/domain/backup';
import { stalledProjects } from '$lib/domain/wip';
import {
	DEFAULT_SETTINGS,
	type FixedDate,
	type InboxItem,
	type Project,
	type ProjectStatus,
	type SettingsMap,
	type Task,
	type Timestamp,
	type Week
} from '$lib/types';

/**
 * Local-time timestamp helper. Built with `new Date(y, m, d, h)` so every instant these
 * tests use is anchored to the runner's own calendar, in all three timezone projects.
 */
function at(year: number, month: number, day: number, hour = 9): Timestamp {
	return new Date(year, month, day, hour).getTime();
}

/** "Now" for the importer: 10 August 2026, early afternoon, local time. */
const NOW = at(2026, 7, 10, 14);
const LAST_WEEK = at(2026, 7, 3, 9);
const LAST_MONTH = at(2026, 6, 6, 9);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeProject(id: string, overrides: Partial<Project> = {}): Project {
	return {
		id,
		title: `Project ${id}`,
		status: 'active',
		nextActionId: null,
		order: 0,
		createdAt: LAST_MONTH,
		updatedAt: LAST_WEEK,
		deletedAt: null,
		...overrides
	} satisfies Project;
}

function makeTask(id: string, overrides: Partial<Task> = {}): Task {
	return {
		id,
		projectId: null,
		title: `Task ${id}`,
		isNextAction: false,
		completedAt: null,
		weekId: null,
		createdAt: LAST_MONTH,
		updatedAt: LAST_WEEK,
		deletedAt: null,
		...overrides
	} satisfies Task;
}

function makeInboxItem(id: string, overrides: Partial<InboxItem> = {}): InboxItem {
	return {
		id,
		text: `Captured ${id}`,
		createdAt: LAST_WEEK,
		updatedAt: LAST_WEEK,
		deletedAt: null,
		...overrides
	} satisfies InboxItem;
}

function makeFixedDate(id: string, overrides: Partial<FixedDate> = {}): FixedDate {
	return {
		id,
		title: `Deadline ${id}`,
		date: '2026-09-01',
		createdAt: LAST_MONTH,
		updatedAt: LAST_MONTH,
		deletedAt: null,
		...overrides
	} satisfies FixedDate;
}

function makeWeek(id: string, overrides: Partial<Week> = {}): Week {
	return {
		id,
		startedAt: LAST_WEEK,
		endedAt: null,
		reviewCompletedAt: null,
		reviewSteps: [],
		...overrides
	} satisfies Week;
}

function makeData(overrides: Partial<BackupData> = {}): BackupData {
	return {
		projects: [],
		tasks: [],
		inboxItems: [],
		fixedDates: [],
		weeks: [],
		settings: {},
		...overrides
	} satisfies BackupData;
}

/** A consistent, fully populated export — the shape a healthy app produces. */
function realisticData(): BackupData {
	return {
		projects: [
			makeProject('project-kitchen', {
				title: 'Retile the kitchen',
				status: 'active',
				nextActionId: 'task-tiles',
				order: 0
			}),
			makeProject('project-taxes', { title: 'Self assessment', status: 'parked', order: 1 }),
			makeProject('project-bike', { title: 'Service the bike', status: 'done', order: 2 })
		],
		tasks: [
			makeTask('task-tiles', {
				title: 'Measure the splashback',
				projectId: 'project-kitchen',
				notes: 'Tape measure is in the hall cupboard.',
				isNextAction: true,
				weekId: 'week-current'
			}),
			makeTask('task-grout', { title: 'Buy grout', projectId: 'project-kitchen' }),
			makeTask('task-receipts', {
				title: 'Gather receipts',
				projectId: 'project-taxes',
				weekId: 'week-previous'
			}),
			makeTask('task-chain', {
				title: 'Degrease the chain',
				projectId: 'project-bike',
				completedAt: LAST_WEEK,
				weekId: 'week-previous'
			}),
			makeTask('task-binned', {
				title: 'Abandoned idea',
				projectId: 'project-kitchen',
				deletedAt: LAST_WEEK
			})
		],
		inboxItems: [
			makeInboxItem('inbox-plumber', { text: 'Ring the plumber back' }),
			makeInboxItem('inbox-visa', { text: 'Renew visa by 2026-09-01', parsedDate: '2026-09-01' })
		],
		fixedDates: [
			makeFixedDate('date-passport', { title: 'Passport expires', date: '2026-11-14' }),
			makeFixedDate('date-mot', {
				title: 'MOT due',
				date: '2027-02-28',
				note: 'Garage on Mill Road'
			})
		],
		weeks: [
			makeWeek('week-previous', {
				startedAt: LAST_MONTH,
				endedAt: LAST_WEEK,
				reviewCompletedAt: LAST_WEEK,
				reviewSteps: ['brain-dump', 'sort-inbox', 'pick-next-actions', 'scan-manifest']
			}),
			makeWeek('week-current', { startedAt: LAST_WEEK, reviewSteps: ['brain-dump'] })
		],
		settings: {
			wipLimit: 4,
			theme: 'dark',
			motion: 'reduce',
			persistGranted: true,
			persistNudgeDismissedAt: LAST_MONTH,
			installNudgeDismissedAt: null,
			lastExportAt: LAST_WEEK
		}
	} satisfies BackupData;
}

/** Builds an untyped backup envelope, the way a hand-edited file arrives. */
function rawFile(data: unknown, overrides: Record<string, unknown> = {}): unknown {
	return { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: NOW, data, ...overrides };
}

// ---------------------------------------------------------------------------
// Narrowing helpers (each asserts, so every `it` body has at least one expect)
// ---------------------------------------------------------------------------

function expectImported(result: ImportResult): Extract<ImportResult, { ok: true }> {
	expect(result.ok).toBe(true);
	if (!result.ok) throw new Error(`expected a successful import: ${result.errors.join(' ')}`);
	return result;
}

function expectRejected(result: ImportResult): string {
	expect(result.ok).toBe(false);
	if (result.ok) throw new Error('expected the import to be rejected');
	return result.errors.join(' ');
}

function nextActionIds(tasks: readonly Task[]): string[] {
	return tasks.filter((t) => t.isNextAction).map((t) => t.id);
}

// ---------------------------------------------------------------------------

describe('buildBackup', () => {
	it('stamps the current format, version and export time onto the file', () => {
		const data = realisticData();

		const file = buildBackup(data, NOW);

		expect(file).toMatchObject({
			format: BACKUP_FORMAT,
			version: BACKUP_VERSION,
			exportedAt: NOW
		});
		expect(file.data).toBe(data);
	});
});

describe('serializeBackup', () => {
	it('emits JSON that parses back into the same file', () => {
		const file = buildBackup(realisticData(), NOW);

		expect(JSON.parse(serializeBackup(file))).toEqual(file);
	});

	it('pretty-prints so a human can repair the file in a text editor', () => {
		const json = serializeBackup(buildBackup(realisticData(), NOW));

		expect(json).toContain('\n');
		expect(json.split('\n').length).toBeGreaterThan(20);
		expect(json).toMatch(/\n {2}"format": "cairn\.backup"/);
	});
});

describe('the export/import round trip', () => {
	it('restores a realistic dataset byte-for-byte with no warnings', () => {
		const original = realisticData();

		const json = serializeBackup(buildBackup(realisticData(), NOW));
		const result = expectImported(parseBackup(JSON.parse(json), at(2026, 8, 20, 11)));

		expect(result.warnings).toEqual([]);
		expect(result.data).toEqual(original);
		expect(result.exportedAt).toBe(NOW);
	});

	it('preserves soft-deleted rows so a restore does not resurrect binned work', () => {
		const json = serializeBackup(buildBackup(realisticData(), NOW));

		const result = expectImported(parseBackup(JSON.parse(json), NOW));

		const binned = result.data.tasks.find((t) => t.id === 'task-binned');
		expect(binned?.deletedAt).toBe(LAST_WEEK);
	});
});

describe('backupFilename', () => {
	it.each([
		{
			label: 'late on a midsummer evening',
			moment: at(2026, 5, 21, 23),
			expected: 'cairn-2026-06-21.json'
		},
		{
			label: 'at five to midnight on New Year’s Eve',
			moment: new Date(2026, 11, 31, 23, 55).getTime(),
			expected: 'cairn-2026-12-31.json'
		},
		{
			label: 'on a single-digit day in a single-digit month',
			moment: at(2026, 0, 5, 8),
			expected: 'cairn-2026-01-05.json'
		},
		{
			label: 'on a leap day',
			moment: at(2028, 1, 29, 22),
			expected: 'cairn-2028-02-29.json'
		}
	])('names the file $expected when exported $label', ({ moment, expected }) => {
		expect(backupFilename(moment)).toBe(expected);
	});
});

describe('parseBackup rejection', () => {
	it.each([
		{ label: 'null', input: null, matches: /does not contain a Cairn backup/i },
		{ label: 'a bare string', input: 'cairn.backup', matches: /does not contain a Cairn backup/i },
		{
			label: 'a top-level array of rows',
			input: [{ id: 'project-1', title: 'Loose rows' }],
			matches: /does not contain a Cairn backup/i
		},
		{ label: 'an empty object', input: {}, matches: /Expected a "cairn\.backup" file/ },
		{
			label: 'a file tagged with someone else’s format',
			input: { format: 'todo.txt', version: 1, data: {} },
			matches: /Expected a "cairn\.backup" file but found "todo\.txt"/
		},
		{
			label: 'a file with no version number',
			input: { format: BACKUP_FORMAT, data: {} },
			matches: /missing a version number/i
		},
		{
			label: 'a file whose version is not a number',
			input: { format: BACKUP_FORMAT, version: '1', data: {} },
			matches: /missing a version number/i
		}
	])('refuses $label', ({ input, matches }) => {
		expect(expectRejected(parseBackup(input, NOW))).toMatch(matches);
	});

	it('refuses a backup from a newer build and says to update the app', () => {
		const message = expectRejected(parseBackup(rawFile({}, { version: BACKUP_VERSION + 1 }), NOW));

		expect(message).toMatch(/newer version of Cairn/i);
		expect(message).toMatch(/update the app/i);
		expect(message).toContain(String(BACKUP_VERSION + 1));
	});

	it.each([
		{ label: 'the key is absent', data: undefined },
		{ label: 'it is an array', data: [] },
		{ label: 'it is a string', data: 'everything' }
	])('refuses a file with no data section when $label', ({ data }) => {
		const message = expectRejected(
			parseBackup({ format: BACKUP_FORMAT, version: BACKUP_VERSION, data }, NOW)
		);

		expect(message).toMatch(/no "data" section/i);
	});

	it('accepts a backup written by an older build', () => {
		const result = expectImported(parseBackup(rawFile({}, { version: 0 }), NOW));

		expect(result.data.projects).toEqual([]);
	});
});

describe('parseBackup forgiveness', () => {
	it('imports an empty data section as an empty, warning-free dataset', () => {
		const result = expectImported(parseBackup(rawFile({}), NOW));

		expect(result.warnings).toEqual([]);
		expect(result.data).toEqual(makeData());
	});

	it('warns and skips a collection that is not a list, rather than failing the import', () => {
		const result = expectImported(
			parseBackup(rawFile({ projects: { 'project-1': { title: 'Keyed by id' } } }), NOW)
		);

		expect(result.data.projects).toEqual([]);
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toMatch(/not a list/i);
		expect(result.warnings[0]).toMatch(/project/);
	});

	it('drops unreadable rows with a warning naming the count, keeping readable siblings', () => {
		const result = expectImported(
			parseBackup(
				rawFile({
					tasks: [
						{ id: 'task-keep', title: 'Still here' },
						null,
						'not a row',
						{ title: 'no id at all' },
						{ id: '   ', title: 'blank id' },
						{ id: 'task-untitled' }
					]
				}),
				NOW
			)
		);

		expect(result.data.tasks.map((t) => t.id)).toEqual(['task-keep']);
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings[0]).toMatch(/Skipped 5 unreadable task entries\./);
	});

	it('uses the singular when exactly one row is unreadable', () => {
		const result = expectImported(
			parseBackup(rawFile({ inboxItems: [{ id: 'inbox-1' }, { id: 'inbox-2', text: 'ok' }] }), NOW)
		);

		expect(result.data.inboxItems.map((i) => i.id)).toEqual(['inbox-2']);
		expect(result.warnings[0]).toMatch(/Skipped 1 unreadable inbox entry\./);
	});

	it('fills missing tracking timestamps with now and treats an absent deletedAt as live', () => {
		const result = expectImported(
			parseBackup(rawFile({ tasks: [{ id: 'task-bare', title: 'Bare row' }] }), NOW)
		);

		expect(result.data.tasks[0]).toMatchObject({
			createdAt: NOW,
			updatedAt: NOW,
			deletedAt: null
		});
	});

	it('falls back to createdAt when only updatedAt is missing', () => {
		const result = expectImported(
			parseBackup(
				rawFile({ projects: [{ id: 'project-1', title: 'Half stamped', createdAt: LAST_MONTH }] }),
				NOW
			)
		);

		expect(result.data.projects[0]).toMatchObject({
			createdAt: LAST_MONTH,
			updatedAt: LAST_MONTH
		});
	});

	it('keeps timestamps the file did carry', () => {
		const result = expectImported(
			parseBackup(
				rawFile({
					weeks: [
						{
							id: 'week-1',
							startedAt: LAST_MONTH,
							endedAt: LAST_WEEK,
							reviewCompletedAt: null,
							reviewSteps: ['sort-inbox', 'sort-inbox', 'invent-a-step']
						}
					]
				}),
				NOW
			)
		);

		expect(result.data.weeks[0]).toEqual({
			id: 'week-1',
			startedAt: LAST_MONTH,
			endedAt: LAST_WEEK,
			reviewCompletedAt: null,
			reviewSteps: ['sort-inbox']
		});
	});

	it('drops a fixed date whose date is missing or impossible', () => {
		const result = expectImported(
			parseBackup(
				rawFile({
					fixedDates: [
						{ id: 'date-good', title: 'Passport expires', date: '2026-11-14' },
						{ id: 'date-none', title: 'No date at all' },
						{ id: 'date-impossible', title: 'Thirty days hath February', date: '2026-02-30' },
						{ id: 'date-prose', title: 'Sometime', date: 'next tuesday' },
						{ id: 'date-instant', title: 'With a time', date: '2026-11-14T09:00:00Z' }
					]
				}),
				NOW
			)
		);

		expect(result.data.fixedDates.map((f) => f.id)).toEqual(['date-good']);
		expect(result.warnings[0]).toMatch(/Skipped 4 unreadable date entries\./);
	});

	it('keeps an inbox item whose parsed date is unusable, dropping only the hint', () => {
		const result = expectImported(
			parseBackup(
				rawFile({
					inboxItems: [
						{ id: 'inbox-bad', text: 'Ring the plumber', parsedDate: 'next tuesday' },
						{ id: 'inbox-impossible', text: 'Leap', parsedDate: '2027-02-29' },
						{ id: 'inbox-good', text: 'Renew visa', parsedDate: '2026-09-01' }
					]
				}),
				NOW
			)
		);

		expect(result.warnings).toEqual([]);
		expect(result.data.inboxItems.map((i) => i.id)).toEqual([
			'inbox-bad',
			'inbox-impossible',
			'inbox-good'
		]);
		expect(result.data.inboxItems[0].parsedDate).toBeUndefined();
		expect(result.data.inboxItems[1].parsedDate).toBeUndefined();
		expect(result.data.inboxItems[2].parsedDate).toBe('2026-09-01');
	});

	it('falls back to an active status for a project status it does not recognise', () => {
		const result = expectImported(
			parseBackup(
				rawFile({ projects: [{ id: 'project-1', title: 'Mystery', status: 'snoozed' }] }),
				NOW
			)
		);

		expect(result.data.projects[0].status).toBe('active');
	});

	it.each(['active', 'parked', 'done'] satisfies ProjectStatus[])(
		'preserves the recognised project status %s',
		(status) => {
			const result = expectImported(
				parseBackup(rawFile({ projects: [{ id: 'project-1', title: 'Known', status }] }), NOW)
			);

			expect(result.data.projects[0].status).toBe(status);
		}
	);
});

describe('settings import', () => {
	it('ignores keys it does not know about', () => {
		const result = expectImported(
			parseBackup(
				rawFile({ settings: { wipLimit: 5, favouriteColour: 'ochre', syncToken: 'secret' } }),
				NOW
			)
		);

		expect(result.data.settings).toEqual({ wipLimit: 5 });
	});

	it.each([
		{ stored: 0, clamped: 1 },
		{ stored: -12, clamped: 1 },
		{ stored: 1, clamped: 1 },
		{ stored: 5, clamped: 5 },
		{ stored: 3.6, clamped: 4 },
		{ stored: 11, clamped: 10 },
		{ stored: 9000, clamped: 10 }
	])('clamps a stored wipLimit of $stored to $clamped', ({ stored, clamped }) => {
		const result = expectImported(parseBackup(rawFile({ settings: { wipLimit: stored } }), NOW));

		expect(result.data.settings.wipLimit).toBe(clamped);
	});

	it('ignores a wipLimit that is not a number at all', () => {
		const result = expectImported(parseBackup(rawFile({ settings: { wipLimit: 'lots' } }), NOW));

		expect(result.data.settings).toEqual({});
	});

	it('ignores an unrecognised theme, motion or persistence flag', () => {
		const result = expectImported(
			parseBackup(
				rawFile({ settings: { theme: 'chartreuse', motion: 'wild', persistGranted: 'yes' } }),
				NOW
			)
		);

		expect(result.data.settings).toEqual({});
	});

	it('keeps recognised theme and motion preferences', () => {
		const result = expectImported(
			parseBackup(
				rawFile({ settings: { theme: 'dark', motion: 'reduce', persistGranted: false } }),
				NOW
			)
		);

		expect(result.data.settings).toEqual({
			theme: 'dark',
			motion: 'reduce',
			persistGranted: false
		});
	});

	it('coerces unusable nullable timestamps to null rather than dropping the key', () => {
		const result = expectImported(
			parseBackup(
				rawFile({
					settings: {
						persistNudgeDismissedAt: null,
						installNudgeDismissedAt: 'never',
						lastExportAt: LAST_WEEK
					}
				}),
				NOW
			)
		);

		expect(result.data.settings).toEqual({
			persistNudgeDismissedAt: null,
			installNudgeDismissedAt: null,
			lastExportAt: LAST_WEEK
		});
	});
});

describe('withSettingDefaults', () => {
	it('returns the shipped defaults for an empty partial', () => {
		expect(withSettingDefaults({})).toEqual(DEFAULT_SETTINGS);
	});

	it('fills in only the keys the imported file did not carry', () => {
		const imported: Partial<SettingsMap> = { wipLimit: 7, theme: 'light' };

		expect(withSettingDefaults(imported)).toEqual({
			wipLimit: 7,
			theme: 'light',
			motion: DEFAULT_SETTINGS.motion,
			persistGranted: DEFAULT_SETTINGS.persistGranted,
			persistNudgeDismissedAt: DEFAULT_SETTINGS.persistNudgeDismissedAt,
			installNudgeDismissedAt: DEFAULT_SETTINGS.installNudgeDismissedAt,
			lastExportAt: DEFAULT_SETTINGS.lastExportAt,
			onboardedAt: DEFAULT_SETTINGS.onboardedAt
		} satisfies SettingsMap);
	});

	it('does not mutate the shared defaults', () => {
		withSettingDefaults({ wipLimit: 9, theme: 'dark' });

		expect(DEFAULT_SETTINGS).toEqual({
			wipLimit: 3,
			theme: 'system',
			motion: 'system',
			persistGranted: false,
			persistNudgeDismissedAt: null,
			installNudgeDismissedAt: null,
			lastExportAt: null,
			onboardedAt: null
		} satisfies SettingsMap);
	});
});

describe('repairReferences: dangling projects', () => {
	it('detaches a task pointing at a project that is not in the backup', () => {
		const warnings: string[] = [];
		const data = makeData({
			projects: [makeProject('project-kitchen')],
			tasks: [
				makeTask('task-stray', { projectId: 'project-gone', isNextAction: true }),
				makeTask('task-kept', { projectId: 'project-kitchen' })
			]
		});

		const repaired = repairReferences(data, warnings);

		expect(repaired.tasks[0]).toMatchObject({ projectId: null, isNextAction: false });
		expect(repaired.tasks[1].projectId).toBe('project-kitchen');
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toMatch(/1 task pointed at a missing project and was moved out/);
	});

	it('counts several orphans in a single plural warning', () => {
		const warnings: string[] = [];

		repairReferences(
			makeData({
				tasks: [
					makeTask('task-a', { projectId: 'project-gone' }),
					makeTask('task-b', { projectId: 'project-also-gone' })
				]
			}),
			warnings
		);

		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toMatch(/2 tasks pointed at a missing project and were moved out/);
	});

	it('leaves a task that never had a project alone', () => {
		const warnings: string[] = [];

		const repaired = repairReferences(makeData({ tasks: [makeTask('task-loose')] }), warnings);

		expect(repaired.tasks[0].projectId).toBeNull();
		expect(warnings).toEqual([]);
	});
});

describe('repairReferences: one next action per project', () => {
	it('keeps the task the project already points at when two are flagged', () => {
		const warnings: string[] = [];
		const data = makeData({
			projects: [makeProject('project-kitchen', { nextActionId: 'task-tiles' })],
			tasks: [
				makeTask('task-tiles', {
					projectId: 'project-kitchen',
					isNextAction: true,
					updatedAt: LAST_MONTH
				}),
				makeTask('task-grout', {
					projectId: 'project-kitchen',
					isNextAction: true,
					updatedAt: LAST_WEEK
				})
			]
		});

		const repaired = repairReferences(data, warnings);

		expect(nextActionIds(repaired.tasks)).toEqual(['task-tiles']);
		expect(repaired.projects[0].nextActionId).toBe('task-tiles');
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toMatch(/1 extra next action was cleared/);
	});

	it('keeps the most recently updated flagged task when the project points nowhere', () => {
		const warnings: string[] = [];
		const data = makeData({
			projects: [makeProject('project-kitchen', { nextActionId: null })],
			tasks: [
				makeTask('task-old', {
					projectId: 'project-kitchen',
					isNextAction: true,
					updatedAt: LAST_MONTH
				}),
				makeTask('task-fresh', {
					projectId: 'project-kitchen',
					isNextAction: true,
					updatedAt: NOW
				}),
				makeTask('task-middling', {
					projectId: 'project-kitchen',
					isNextAction: true,
					updatedAt: LAST_WEEK
				})
			]
		});

		const repaired = repairReferences(data, warnings);

		expect(nextActionIds(repaired.tasks)).toEqual(['task-fresh']);
		expect(repaired.projects[0].nextActionId).toBe('task-fresh');
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toMatch(/2 extra next actions were cleared/);
	});

	it('enforces the invariant per project, not across the whole backup', () => {
		const warnings: string[] = [];
		const data = makeData({
			projects: [
				makeProject('project-a', { nextActionId: 'task-a1' }),
				makeProject('project-b', { nextActionId: 'task-b1' })
			],
			tasks: [
				makeTask('task-a1', { projectId: 'project-a', isNextAction: true }),
				makeTask('task-b1', { projectId: 'project-b', isNextAction: true })
			]
		});

		const repaired = repairReferences(data, warnings);

		expect(nextActionIds(repaired.tasks)).toEqual(['task-a1', 'task-b1']);
		expect(warnings).toEqual([]);
	});

	it('clears a project pointer aimed at a task that is not in the backup', () => {
		const warnings: string[] = [];
		const data = makeData({
			projects: [makeProject('project-kitchen', { nextActionId: 'task-ghost' })],
			tasks: [makeTask('task-grout', { projectId: 'project-kitchen' })]
		});

		const repaired = repairReferences(data, warnings);

		expect(repaired.projects[0].nextActionId).toBeNull();
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toMatch(/1 project pointed at a task that is not in the backup/);
	});

	it('unflags a completed next action and leaves the project stalled', () => {
		const warnings: string[] = [];
		const data = makeData({
			projects: [makeProject('project-kitchen', { nextActionId: 'task-tiles' })],
			tasks: [
				makeTask('task-tiles', {
					projectId: 'project-kitchen',
					isNextAction: true,
					completedAt: LAST_WEEK
				})
			]
		});

		const repaired = repairReferences(data, warnings);

		expect(repaired.tasks[0].isNextAction).toBe(false);
		expect(repaired.projects[0].nextActionId).toBeNull();
		expect(stalledProjects(repaired.projects).map((p) => p.id)).toEqual(['project-kitchen']);
	});

	/**
	 * REGRESSION — the tie-break once considered completed tasks, so a stale flag left on
	 * a finished task could out-rank the real next action on `updatedAt`. The live task
	 * was then cleared as a duplicate and the completed winner cleared a moment later by
	 * the "a completed task cannot be a next action" check, so the project imported
	 * stalled and the user's actual next step was silently gone. Only incomplete tasks
	 * are eligible to win.
	 */
	it('prefers a live incomplete flagged task over a stale completed one', () => {
		const warnings: string[] = [];
		const data = makeData({
			projects: [makeProject('project-kitchen', { nextActionId: null })],
			tasks: [
				makeTask('task-chain', {
					projectId: 'project-kitchen',
					isNextAction: true,
					completedAt: LAST_WEEK,
					updatedAt: NOW
				}),
				makeTask('task-grout', {
					projectId: 'project-kitchen',
					isNextAction: true,
					updatedAt: LAST_MONTH
				})
			]
		});

		const repaired = repairReferences(data, warnings);

		expect(nextActionIds(repaired.tasks)).toEqual(['task-grout']);
		expect(repaired.projects[0].nextActionId).toBe('task-grout');
		expect(stalledProjects(repaired.projects)).toEqual([]);
	});

	it('never chooses a soft-deleted task as the next action', () => {
		const warnings: string[] = [];
		const data = makeData({
			projects: [makeProject('project-kitchen', { nextActionId: 'task-binned' })],
			tasks: [
				makeTask('task-binned', {
					projectId: 'project-kitchen',
					isNextAction: true,
					updatedAt: NOW,
					deletedAt: LAST_WEEK
				}),
				makeTask('task-live', {
					projectId: 'project-kitchen',
					isNextAction: true,
					updatedAt: LAST_MONTH
				})
			]
		});

		const repaired = repairReferences(data, warnings);

		expect(repaired.projects[0].nextActionId).toBe('task-live');
	});

	it('leaves a project stalled when its only flagged task was soft-deleted', () => {
		const warnings: string[] = [];
		const data = makeData({
			projects: [makeProject('project-kitchen', { nextActionId: 'task-binned' })],
			tasks: [
				makeTask('task-binned', {
					projectId: 'project-kitchen',
					isNextAction: true,
					deletedAt: LAST_WEEK
				})
			]
		});

		const repaired = repairReferences(data, warnings);

		expect(repaired.projects[0].nextActionId).toBeNull();
	});
});

describe('repairReferences: dangling weeks', () => {
	it('clears a task weekId that names a week the backup does not contain', () => {
		const warnings: string[] = [];
		const data = makeData({
			tasks: [
				makeTask('task-lost', { weekId: 'week-gone' }),
				makeTask('task-anchored', { weekId: 'week-current' })
			],
			weeks: [makeWeek('week-current')]
		});

		const repaired = repairReferences(data, warnings);

		expect(repaired.tasks[0].weekId).toBeNull();
		expect(repaired.tasks[1].weekId).toBe('week-current');
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toMatch(/1 task referenced a week that is not in the backup/);
	});

	it('pluralises the unknown-week warning', () => {
		const warnings: string[] = [];

		repairReferences(
			makeData({
				tasks: [makeTask('task-a', { weekId: 'week-x' }), makeTask('task-b', { weekId: 'week-y' })]
			}),
			warnings
		);

		expect(warnings[0]).toMatch(/2 tasks referenced a week that is not in the backup/);
	});

	it('says nothing when every reference already resolves', () => {
		const warnings: string[] = [];
		const data = makeData({
			projects: [makeProject('project-kitchen', { nextActionId: 'task-tiles' })],
			tasks: [
				makeTask('task-tiles', {
					projectId: 'project-kitchen',
					isNextAction: true,
					weekId: 'week-current'
				})
			],
			weeks: [makeWeek('week-current')]
		});

		const repaired = repairReferences(data, warnings);

		expect(warnings).toEqual([]);
		expect(repaired.projects[0].nextActionId).toBe('task-tiles');
	});
});

describe('parseBackup repairs references end to end', () => {
	it('reports every repair it made to a badly tangled file', () => {
		const result = expectImported(
			parseBackup(
				rawFile({
					projects: [
						{ id: 'project-kitchen', title: 'Retile the kitchen', nextActionId: 'task-ghost' }
					],
					tasks: [
						{
							id: 'task-tiles',
							title: 'Measure the splashback',
							projectId: 'project-kitchen',
							isNextAction: true,
							updatedAt: LAST_MONTH
						},
						{
							id: 'task-grout',
							title: 'Buy grout',
							projectId: 'project-kitchen',
							isNextAction: true,
							updatedAt: NOW
						},
						{
							id: 'task-stray',
							title: 'Belongs nowhere',
							projectId: 'project-gone',
							isNextAction: true
						},
						{ id: 'task-dated', title: 'Carried over', weekId: 'week-gone' }
					]
				}),
				NOW
			)
		);

		const byId = new Map(result.data.tasks.map((t) => [t.id, t]));
		expect(result.data.projects[0].nextActionId).toBe('task-grout');
		expect(nextActionIds(result.data.tasks)).toEqual(['task-grout']);
		expect(byId.get('task-stray')).toMatchObject({ projectId: null, isNextAction: false });
		expect(byId.get('task-dated')?.weekId).toBeNull();

		const reported = result.warnings.join('\n');
		expect(result.warnings).toHaveLength(4);
		expect(reported).toMatch(/pointed at a missing project/);
		expect(reported).toMatch(/extra next action was cleared/);
		expect(reported).toMatch(/pointed at a task that is not in the backup/);
		expect(reported).toMatch(/referenced a week that is not in the backup/);
	});
});

describe('countBackup', () => {
	it('counts only live rows, because that is what the restore will show', () => {
		const data = makeData({
			projects: [makeProject('project-a'), makeProject('project-b', { deletedAt: LAST_WEEK })],
			tasks: [
				makeTask('task-a'),
				makeTask('task-b', { deletedAt: LAST_WEEK }),
				makeTask('task-c', { deletedAt: LAST_MONTH })
			],
			inboxItems: [makeInboxItem('inbox-a', { deletedAt: LAST_WEEK })],
			fixedDates: [makeFixedDate('date-a'), makeFixedDate('date-b'), makeFixedDate('date-c')],
			weeks: [makeWeek('week-a'), makeWeek('week-b')]
		});

		expect(countBackup(data)).toEqual({
			projects: 1,
			tasks: 1,
			inboxItems: 0,
			fixedDates: 3,
			weeks: 2
		});
	});

	it('counts nothing for an empty backup', () => {
		expect(countBackup(makeData())).toEqual({
			projects: 0,
			tasks: 0,
			inboxItems: 0,
			fixedDates: 0,
			weeks: 0
		});
	});

	it('agrees with what a round trip of a realistic export restores', () => {
		const json = serializeBackup(buildBackup(realisticData(), NOW));
		const result = expectImported(parseBackup(JSON.parse(json), NOW));

		expect(countBackup(result.data)).toEqual({
			projects: 3,
			tasks: 4,
			inboxItems: 2,
			fixedDates: 2,
			weeks: 2
		});
	});
});
