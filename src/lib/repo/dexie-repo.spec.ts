// Must run before anything pulls Dexie in, so `indexedDB` exists on globalThis by the
// time Dexie's module body evaluates.
import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CairnDatabase } from '$lib/db';
import { parseBackup, type BackupData } from '$lib/domain/backup';
import type { Clock } from '$lib/domain/clock';
import { stalledProjects } from '$lib/domain/wip';
import { DexieRepository } from '$lib/repo/dexie-repo';
import type { Snapshot } from '$lib/repo';
import {
	DEFAULT_SETTINGS,
	type FixedDate,
	type Id,
	type InboxItem,
	type Project,
	type Setting,
	type SettingsMap,
	type Task,
	type Week
} from '$lib/types';

/**
 * Integration tests: a real DexieRepository over a real Dexie, on fake-indexeddb.
 *
 * Every test gets its own database name and its own controllable clock, so nothing
 * leaks between tests and every timestamp assertion is exact.
 */

/** 10 Aug 2026, 09:00 *local* — never a fixed UTC instant, so the suite is TZ-agnostic. */
const T0 = new Date(2026, 7, 10, 9, 0, 0).getTime();

let dbSeq = 0;
let db: CairnDatabase;
let repo: DexieRepository;
let now: number;

const clock: Clock = { now: () => now };

beforeEach(() => {
	now = T0;
	dbSeq += 1;
	db = new CairnDatabase(`cairn-test-${dbSeq}`);
	repo = new DexieRepository(db, clock);
});

afterEach(async () => {
	await db.delete();
});

/** Advances the injected clock. Returns the new instant for convenient assertions. */
function tick(ms = 1_000): number {
	now += ms;
	return now;
}

async function projectRow(id: Id): Promise<Project> {
	const row = await db.projects.get(id);
	if (!row) throw new Error(`expected project ${id} to still exist`);
	return row;
}

async function taskRow(id: Id): Promise<Task> {
	const row = await db.tasks.get(id);
	if (!row) throw new Error(`expected task ${id} to still exist`);
	return row;
}

async function inboxRow(id: Id): Promise<InboxItem> {
	const row = await db.inboxItems.get(id);
	if (!row) throw new Error(`expected inbox item ${id} to still exist`);
	return row;
}

/** Ids of every task in the project currently carrying the authoritative flag. */
async function flaggedTaskIds(projectId: Id): Promise<Id[]> {
	const tasks = await db.tasks.where('projectId').equals(projectId).toArray();
	return tasks.filter((t) => t.isNextAction).map((t) => t.id);
}

/**
 * The core invariant: the denormalised pointer and the authoritative flag agree, and at
 * most one task in the project carries the flag.
 */
async function expectSingleNextAction(projectId: Id, taskId: Id | null): Promise<void> {
	const project = await projectRow(projectId);
	expect(project.nextActionId).toBe(taskId);
	expect(await flaggedTaskIds(projectId)).toEqual(taskId === null ? [] : [taskId]);
}

function openWeeks(weeks: readonly Week[]): Week[] {
	return weeks.filter((w) => w.endedAt === null);
}

function makeWeek(id: Id, startedAt: number, endedAt: number | null = null): Week {
	return { id, startedAt, endedAt, reviewCompletedAt: null, reviewSteps: [] };
}

/** A representative slice of every table, used by the backup round-trip tests. */
async function seedEverything(): Promise<void> {
	const alpha = await repo.createProject('  Rewire the shed  ');
	tick();
	const beta = await repo.createProject('Learn to solder');
	tick();
	await repo.addTask({ projectId: alpha.id, title: '  Buy the conduit  ', asNextAction: true });
	tick();
	await repo.addTask({ projectId: alpha.id, title: 'Chase the sparky', notes: '  ring at 9  ' });
	tick();
	const finished = await repo.addTask({ projectId: beta.id, title: 'Watch the tutorial' });
	tick();
	await repo.completeTask(finished.id);
	tick();
	await repo.captureInboxItem('  Ferry tickets  ', '2026-09-01');
	tick();
	await repo.captureInboxItem('Ask about the fence');
	tick();
	await repo.addFixedDate({ title: 'Passport expires', date: '2027-01-15', note: '  renew  ' });
	tick();
	await repo.setSetting('wipLimit', 4);
	await repo.setSetting('theme', 'dark');
}

// ---------------------------------------------------------------------------

describe('createProject', () => {
	it('trims the title and starts the project active, stalled and first in order', async () => {
		const project = await repo.createProject('  Rewire the shed  ');

		expect(project).toEqual({
			id: project.id,
			title: 'Rewire the shed',
			status: 'active',
			nextActionId: null,
			order: 0,
			createdAt: T0,
			updatedAt: T0,
			deletedAt: null
		} satisfies Project);
		expect(await db.projects.get(project.id)).toEqual(project);
	});

	it('assigns a strictly increasing order to each new project', async () => {
		const first = await repo.createProject('First');
		tick();
		const second = await repo.createProject('Second');
		tick();
		const third = await repo.createProject('Third');

		expect([first.order, second.order, third.order]).toEqual([0, 1, 2]);
	});

	it('continues past the highest existing order rather than reusing a gap', async () => {
		const first = await repo.createProject('First');
		const second = await repo.createProject('Second');
		await repo.reorderProjects([second.id, first.id]);

		const third = await repo.createProject('Third');

		expect(third.order).toBe(2);
	});
});

describe('readSnapshot', () => {
	it('returns the defaults when nothing has ever been written', async () => {
		const snapshot = await repo.readSnapshot();

		expect(snapshot).toEqual({
			projects: [],
			tasks: [],
			inboxItems: [],
			fixedDates: [],
			weeks: [],
			currentWeek: null,
			settings: DEFAULT_SETTINGS
		} satisfies Snapshot);
	});

	it('returns projects sorted by their manual order, not by creation time', async () => {
		const a = await repo.createProject('A');
		const b = await repo.createProject('B');
		const c = await repo.createProject('C');
		await repo.reorderProjects([c.id, a.id, b.id]);

		const snapshot = await repo.readSnapshot();

		expect(snapshot.projects.map((p) => p.title)).toEqual(['C', 'A', 'B']);
		expect(snapshot.projects.map((p) => p.order)).toEqual([0, 1, 2]);
	});

	it('returns inbox items newest first', async () => {
		await repo.captureInboxItem('oldest');
		tick();
		await repo.captureInboxItem('middle');
		tick();
		await repo.captureInboxItem('newest');

		const snapshot = await repo.readSnapshot();

		expect(snapshot.inboxItems.map((i) => i.text)).toEqual(['newest', 'middle', 'oldest']);
	});

	it('reports the most recently started open week as the current one', async () => {
		await db.weeks.bulkAdd([
			makeWeek('w-old', T0 - 300_000),
			makeWeek('w-new', T0 - 100_000),
			makeWeek('w-closed', T0 - 50_000, T0 - 10_000)
		]);

		const snapshot = await repo.readSnapshot();

		expect(snapshot.currentWeek?.id).toBe('w-new');
		expect(snapshot.weeks.map((w) => w.id)).toEqual(['w-closed', 'w-new', 'w-old']);
	});
});

describe('setSetting', () => {
	it('round-trips a value and surfaces it merged over the defaults', async () => {
		await repo.setSetting('wipLimit', 5);
		await repo.setSetting('theme', 'dark');
		await repo.setSetting('motion', 'reduce');
		await repo.setSetting('persistGranted', true);
		await repo.setSetting('lastExportAt', T0);

		const snapshot = await repo.readSnapshot();

		expect(snapshot.settings).toEqual({
			...DEFAULT_SETTINGS,
			wipLimit: 5,
			theme: 'dark',
			motion: 'reduce',
			persistGranted: true,
			lastExportAt: T0
		});
	});

	it('overwrites a previously stored value for the same key', async () => {
		await repo.setSetting('wipLimit', 5);
		await repo.setSetting('wipLimit', 2);

		expect(await db.settings.count()).toBe(1);
		expect((await repo.readSnapshot()).settings.wipLimit).toBe(2);
	});

	it('never surfaces a stored key that is not part of the settings map', async () => {
		await db.settings.put({
			key: 'somethingFromAFutureBuild',
			value: 'nope'
		} as unknown as Setting);
		await repo.setSetting('wipLimit', 4);

		const snapshot = await repo.readSnapshot();

		expect(Object.keys(snapshot.settings).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
		expect(snapshot.settings).toEqual({ ...DEFAULT_SETTINGS, wipLimit: 4 });
	});

	// REGRESSION — `mergeSettings` once gated unknown keys with `row.key in merged`, and
	// `in` walks the prototype chain, so any row keyed after an `Object.prototype` member
	// passed as known: `constructor` and `toString` leaked into `Snapshot.settings`, and
	// assigning `__proto__` invoked the inherited setter and replaced the object's
	// prototype outright. The gate is now `Object.hasOwn(DEFAULT_SETTINGS, row.key)`.
	it('never surfaces a stored key that only exists on Object.prototype', async () => {
		await db.settings.put({ key: 'constructor', value: 1 } as unknown as Setting);
		await db.settings.put({ key: 'toString', value: 2 } as unknown as Setting);
		await db.settings.put({ key: '__proto__', value: { wipLimit: 999 } } as unknown as Setting);

		const { settings } = await repo.readSnapshot();

		expect(Object.keys(settings).sort()).toEqual(Object.keys(DEFAULT_SETTINGS).sort());
		expect(Object.getPrototypeOf(settings)).toBe(Object.prototype);
		expect(settings).toEqual(DEFAULT_SETTINGS);
	});
});

describe('setNextAction', () => {
	it('demotes the previous next action to an ordinary task in the same project', async () => {
		const project = await repo.createProject('Rewire the shed');
		const previous = await repo.addTask({
			projectId: project.id,
			title: 'Buy the conduit',
			asNextAction: true
		});
		tick();
		const replacement = await repo.addTask({ projectId: project.id, title: 'Chase the sparky' });

		const at = tick();
		await repo.setNextAction(project.id, replacement.id);

		const demoted = await taskRow(previous.id);
		expect(demoted.isNextAction).toBe(false);
		expect(demoted.projectId).toBe(project.id);
		expect(demoted.deletedAt).toBeNull();
		expect(demoted.completedAt).toBeNull();
		expect(demoted.updatedAt).toBe(at);

		await expectSingleNextAction(project.id, replacement.id);
	});

	it('leaves the project stalled when passed null', async () => {
		const project = await repo.createProject('Rewire the shed');
		const task = await repo.addTask({
			projectId: project.id,
			title: 'Buy the conduit',
			asNextAction: true
		});

		tick();
		await repo.setNextAction(project.id, null);

		await expectSingleNextAction(project.id, null);
		const survivor = await taskRow(task.id);
		expect(survivor.deletedAt).toBeNull();
		expect(survivor.completedAt).toBeNull();
		expect(stalledProjects([await projectRow(project.id)]).map((p) => p.id)).toEqual([project.id]);
	});

	it('repairs a drifted state where two tasks in one project carry the flag', async () => {
		const project = await repo.createProject('Rewire the shed');
		const first = await repo.addTask({ projectId: project.id, title: 'Buy the conduit' });
		const second = await repo.addTask({ projectId: project.id, title: 'Chase the sparky' });

		// Hand-write a state the repository would never produce, as a merge or a
		// hand-edited restore could.
		await db.tasks.update(first.id, { isNextAction: true });
		await db.tasks.update(second.id, { isNextAction: true });
		await db.projects.update(project.id, { nextActionId: second.id });
		expect((await flaggedTaskIds(project.id)).sort()).toEqual([first.id, second.id].sort());

		tick();
		await repo.setNextAction(project.id, first.id);

		await expectSingleNextAction(project.id, first.id);
	});

	it('reopens a completed task when it is promoted to next action', async () => {
		const project = await repo.createProject('Rewire the shed');
		const task = await repo.addTask({ projectId: project.id, title: 'Buy the conduit' });
		const completedAt = tick();
		await repo.completeTask(task.id);
		expect((await taskRow(task.id)).completedAt).toBe(completedAt);

		tick();
		await repo.setNextAction(project.id, task.id);

		const reopened = await taskRow(task.id);
		expect(reopened.completedAt).toBeNull();
		expect(reopened.isNextAction).toBe(true);
		await expectSingleNextAction(project.id, task.id);
	});

	it('does not disturb the next action of a different project', async () => {
		const one = await repo.createProject('One');
		const two = await repo.createProject('Two');
		const keep = await repo.addTask({ projectId: one.id, title: 'Keep me', asNextAction: true });
		const other = await repo.addTask({ projectId: two.id, title: 'Other', asNextAction: true });

		tick();
		await repo.setNextAction(two.id, null);

		await expectSingleNextAction(one.id, keep.id);
		await expectSingleNextAction(two.id, null);
		expect((await taskRow(other.id)).isNextAction).toBe(false);
	});
});

describe('completeTask', () => {
	it('stamps the completion, clears the flag and stalls the project on purpose', async () => {
		const project = await repo.createProject('Rewire the shed');
		const nextAction = await repo.addTask({
			projectId: project.id,
			title: 'Buy the conduit',
			asNextAction: true
		});

		const at = tick(5_000);
		await repo.completeTask(nextAction.id);

		const done = await taskRow(nextAction.id);
		expect(done.completedAt).toBe(at);
		expect(done.isNextAction).toBe(false);
		expect(done.deletedAt).toBeNull();
		await expectSingleNextAction(project.id, null);
	});

	it('leaves the project pointer alone when an ordinary task is completed', async () => {
		const project = await repo.createProject('Rewire the shed');
		const nextAction = await repo.addTask({
			projectId: project.id,
			title: 'Buy the conduit',
			asNextAction: true
		});
		const ordinary = await repo.addTask({ projectId: project.id, title: 'Chase the sparky' });

		const at = tick();
		await repo.completeTask(ordinary.id);

		expect((await taskRow(ordinary.id)).completedAt).toBe(at);
		await expectSingleNextAction(project.id, nextAction.id);
	});

	it('does nothing for an unknown task id', async () => {
		const project = await repo.createProject('Rewire the shed');
		const nextAction = await repo.addTask({
			projectId: project.id,
			title: 'Buy the conduit',
			asNextAction: true
		});

		await repo.completeTask('no-such-task');

		expect(await db.tasks.count()).toBe(1);
		await expectSingleNextAction(project.id, nextAction.id);
	});
});

describe('reopenTask', () => {
	it('clears the completion stamp', async () => {
		const project = await repo.createProject('Rewire the shed');
		const task = await repo.addTask({ projectId: project.id, title: 'Buy the conduit' });
		tick();
		await repo.completeTask(task.id);

		const at = tick();
		await repo.reopenTask(task.id);

		const reopened = await taskRow(task.id);
		expect(reopened.completedAt).toBeNull();
		expect(reopened.updatedAt).toBe(at);
	});
});

describe('deleteTask', () => {
	it('soft-deletes the row and clears the pointer when it was the next action', async () => {
		const project = await repo.createProject('Rewire the shed');
		const task = await repo.addTask({
			projectId: project.id,
			title: 'Buy the conduit',
			asNextAction: true
		});

		const at = tick();
		await repo.deleteTask(task.id);

		const row = await db.tasks.get(task.id);
		expect(row).toBeDefined();
		expect(row?.deletedAt).toBe(at);
		expect(row?.isNextAction).toBe(false);
		expect(row?.projectId).toBe(project.id);
		await expectSingleNextAction(project.id, null);
	});

	it('leaves the pointer alone when an ordinary task is deleted', async () => {
		const project = await repo.createProject('Rewire the shed');
		const nextAction = await repo.addTask({
			projectId: project.id,
			title: 'Buy the conduit',
			asNextAction: true
		});
		const ordinary = await repo.addTask({ projectId: project.id, title: 'Chase the sparky' });

		tick();
		await repo.deleteTask(ordinary.id);

		expect((await taskRow(ordinary.id)).deletedAt).toBe(now);
		await expectSingleNextAction(project.id, nextAction.id);
	});
});

describe('deleteProject', () => {
	it('soft-deletes the project and every task still live under it', async () => {
		const doomed = await repo.createProject('Rewire the shed');
		const survivor = await repo.createProject('Learn to solder');
		const live = await repo.addTask({ projectId: doomed.id, title: 'Live', asNextAction: true });
		const alsoLive = await repo.addTask({ projectId: doomed.id, title: 'Also live' });
		const alreadyGone = await repo.addTask({ projectId: doomed.id, title: 'Already gone' });
		const untouched = await repo.addTask({ projectId: survivor.id, title: 'Untouched' });

		const deletedEarlier = tick();
		await repo.deleteTask(alreadyGone.id);

		const at = tick();
		await repo.deleteProject(doomed.id);

		const project = await projectRow(doomed.id);
		expect(project.deletedAt).toBe(at);
		expect(project.nextActionId).toBeNull();
		expect((await taskRow(live.id)).deletedAt).toBe(at);
		expect((await taskRow(live.id)).isNextAction).toBe(false);
		expect((await taskRow(alsoLive.id)).deletedAt).toBe(at);
		expect((await taskRow(untouched.id)).deletedAt).toBeNull();
		expect((await projectRow(survivor.id)).deletedAt).toBeNull();

		// Already-deleted rows keep their original tombstone rather than being re-stamped.
		expect((await taskRow(alreadyGone.id)).deletedAt).toBe(deletedEarlier);
	});
});

describe('reorderProjects', () => {
	it('rewrites order to match the given sequence', async () => {
		const a = await repo.createProject('A');
		const b = await repo.createProject('B');
		const c = await repo.createProject('C');

		const at = tick();
		await repo.reorderProjects([c.id, b.id, a.id]);

		expect((await projectRow(c.id)).order).toBe(0);
		expect((await projectRow(b.id)).order).toBe(1);
		expect((await projectRow(a.id)).order).toBe(2);
		expect((await projectRow(c.id)).updatedAt).toBe(at);
		expect((await repo.readSnapshot()).projects.map((p) => p.title)).toEqual(['C', 'B', 'A']);
	});
});

describe('addTask', () => {
	it('creates the current week when none exists and stamps it on the task', async () => {
		expect(await db.weeks.count()).toBe(0);
		const project = await repo.createProject('Rewire the shed');

		const task = await repo.addTask({ projectId: project.id, title: '  Buy the conduit  ' });

		const weeks = await db.weeks.toArray();
		expect(weeks).toHaveLength(1);
		expect(task.title).toBe('Buy the conduit');
		expect(task.weekId).toBe(weeks[0].id);
		expect((await taskRow(task.id)).weekId).toBe(weeks[0].id);
	});

	it('reuses the open week for subsequent tasks', async () => {
		const project = await repo.createProject('Rewire the shed');
		const first = await repo.addTask({ projectId: project.id, title: 'One' });
		tick(60_000);
		const second = await repo.addTask({ projectId: project.id, title: 'Two' });

		expect(second.weekId).toBe(first.weekId);
		expect(await db.weeks.count()).toBe(1);
	});

	it('sets the project pointer when asked for the task to be the next action', async () => {
		const project = await repo.createProject('Rewire the shed');

		const task = await repo.addTask({
			projectId: project.id,
			title: 'Buy the conduit',
			asNextAction: true
		});

		expect(task.isNextAction).toBe(true);
		expect((await taskRow(task.id)).isNextAction).toBe(true);
		await expectSingleNextAction(project.id, task.id);
	});

	it('replaces an existing next action when a new task is added as one', async () => {
		const project = await repo.createProject('Rewire the shed');
		const first = await repo.addTask({ projectId: project.id, title: 'One', asNextAction: true });
		tick();
		const second = await repo.addTask({ projectId: project.id, title: 'Two', asNextAction: true });

		expect((await taskRow(first.id)).isNextAction).toBe(false);
		await expectSingleNextAction(project.id, second.id);
	});
});

describe('captureInboxItem', () => {
	it('trims the captured text', async () => {
		const item = await repo.captureInboxItem('   Book the ferry   ');

		expect(item.text).toBe('Book the ferry');
		expect(await inboxRow(item.id)).toEqual({
			id: item.id,
			text: 'Book the ferry',
			parsedDate: undefined,
			createdAt: T0,
			updatedAt: T0,
			deletedAt: null
		} satisfies InboxItem);
	});

	it('keeps a valid yyyy-MM-dd hint', async () => {
		const item = await repo.captureInboxItem('Ferry on the 1st', '2026-09-01');

		expect(item.parsedDate).toBe('2026-09-01');
		expect((await inboxRow(item.id)).parsedDate).toBe('2026-09-01');
	});

	it.each([
		['2026-02-30', 'a day that does not exist'],
		['2026-8-1', 'unpadded components'],
		['2026-09', 'a month with no day'],
		['2026-09-01T00:00:00Z', 'a datetime rather than a date'],
		['tomorrow', 'free text']
	])('drops the parsed date hint %j (%s)', async (raw) => {
		const item = await repo.captureInboxItem('Ferry', raw);

		expect(item.parsedDate).toBeUndefined();
		expect((await inboxRow(item.id)).parsedDate).toBeUndefined();
	});
});

describe('triageInboxItem', () => {
	it('soft-deletes the item and creates nothing for the delete action', async () => {
		const item = await repo.captureInboxItem('Never mind');

		const at = tick();
		await repo.triageInboxItem(item.id, { kind: 'delete' });

		expect((await inboxRow(item.id)).deletedAt).toBe(at);
		expect(await db.tasks.count()).toBe(0);
		expect(await db.projects.count()).toBe(0);
		expect(await db.fixedDates.count()).toBe(0);
	});

	it('files the item into a project as an ordinary task', async () => {
		const project = await repo.createProject('Rewire the shed');
		const item = await repo.captureInboxItem('  Buy the conduit  ');

		tick();
		await repo.triageInboxItem(item.id, { kind: 'to-project', projectId: project.id });

		const tasks = await db.tasks.toArray();
		expect(tasks).toHaveLength(1);
		expect(tasks[0]).toMatchObject({
			title: 'Buy the conduit',
			projectId: project.id,
			isNextAction: false,
			completedAt: null
		});
		await expectSingleNextAction(project.id, null);
		expect((await inboxRow(item.id)).deletedAt).not.toBeNull();
	});

	it('files the item into a project as its next action', async () => {
		const project = await repo.createProject('Rewire the shed');
		const item = await repo.captureInboxItem('Buy the conduit');

		tick();
		await repo.triageInboxItem(item.id, { kind: 'to-next-action', projectId: project.id });

		const tasks = await db.tasks.toArray();
		expect(tasks).toHaveLength(1);
		expect(tasks[0].title).toBe('Buy the conduit');
		await expectSingleNextAction(project.id, tasks[0].id);
		expect((await inboxRow(item.id)).deletedAt).not.toBeNull();
	});

	it('files the item onto the manifest with its text as the title', async () => {
		const item = await repo.captureInboxItem('  MOT is due  ');

		tick();
		await repo.triageInboxItem(item.id, { kind: 'to-manifest', date: '2026-11-03' });

		const dates = await db.fixedDates.toArray();
		expect(dates).toHaveLength(1);
		expect(dates[0]).toMatchObject({ title: 'MOT is due', date: '2026-11-03', deletedAt: null });
		expect(await db.tasks.count()).toBe(0);
		expect((await inboxRow(item.id)).deletedAt).not.toBeNull();
	});

	it('names a new project after the item text and leaves it stalled', async () => {
		const item = await repo.captureInboxItem('  Redo the bathroom  ');

		tick();
		await repo.triageInboxItem(item.id, { kind: 'to-new-project' });

		const projects = await db.projects.toArray();
		expect(projects).toHaveLength(1);
		expect(projects[0].title).toBe('Redo the bathroom');
		await expectSingleNextAction(projects[0].id, null);
		expect(await db.tasks.count()).toBe(0);
		expect((await inboxRow(item.id)).deletedAt).not.toBeNull();
	});

	it('makes the item text the next action when the new project is named separately', async () => {
		const item = await repo.captureInboxItem('Get three quotes');

		tick();
		await repo.triageInboxItem(item.id, {
			kind: 'to-new-project',
			title: '  Redo the bathroom  '
		});

		const projects = await db.projects.toArray();
		expect(projects).toHaveLength(1);
		expect(projects[0].title).toBe('Redo the bathroom');

		const tasks = await db.tasks.toArray();
		expect(tasks).toHaveLength(1);
		expect(tasks[0].title).toBe('Get three quotes');
		await expectSingleNextAction(projects[0].id, tasks[0].id);
		expect((await inboxRow(item.id)).deletedAt).not.toBeNull();
	});

	it('is a no-op for an item that has already been deleted', async () => {
		const item = await repo.captureInboxItem('Already handled');
		const deletedAt = tick();
		await repo.deleteInboxItem(item.id);

		tick();
		await repo.triageInboxItem(item.id, { kind: 'to-new-project', title: 'Should not exist' });

		expect(await db.projects.count()).toBe(0);
		expect(await db.tasks.count()).toBe(0);
		expect((await inboxRow(item.id)).deletedAt).toBe(deletedAt);
	});

	it('is a no-op for an unknown item id', async () => {
		await repo.triageInboxItem('no-such-item', { kind: 'to-new-project', title: 'Nope' });

		expect(await db.projects.count()).toBe(0);
		expect(await db.tasks.count()).toBe(0);
		expect(await db.inboxItems.count()).toBe(0);
		expect(await db.fixedDates.count()).toBe(0);
	});
});

describe('ensureCurrentWeek', () => {
	it('is idempotent — a second call returns the same week', async () => {
		const first = await repo.ensureCurrentWeek();
		tick(60_000);
		const second = await repo.ensureCurrentWeek();

		expect(second.id).toBe(first.id);
		expect(await db.weeks.count()).toBe(1);
		expect(first).toEqual(makeWeek(first.id, T0));
	});

	it('returns the most recently started open week when several are open', async () => {
		await db.weeks.bulkAdd([
			makeWeek('w-older', T0 - 300_000),
			makeWeek('w-newer', T0 - 100_000),
			// Started last but already closed, so it must be ignored.
			makeWeek('w-closed', T0 - 50_000, T0 - 10_000)
		]);

		const current = await repo.ensureCurrentWeek();

		expect(current.id).toBe('w-newer');
		expect(await db.weeks.count()).toBe(3);
	});
});

describe('startNewWeek', () => {
	it('closes the old week, carries unfinished work forward and files what was finished', async () => {
		const kitchen = await repo.createProject('Kitchen');
		const garden = await repo.createProject('Garden');
		const nextAction = await repo.addTask({
			projectId: kitchen.id,
			title: 'Measure the run',
			asNextAction: true
		});
		const ordinary = await repo.addTask({ projectId: kitchen.id, title: 'Order the tiles' });
		const finished = await repo.addTask({ projectId: kitchen.id, title: 'Pick a colour' });
		const discarded = await repo.addTask({ projectId: garden.id, title: 'Never mind' });
		const oldWeek = await repo.ensureCurrentWeek();

		tick();
		await repo.completeTask(finished.id);
		tick();
		await repo.deleteTask(discarded.id);

		const at = tick();
		const summary = await repo.startNewWeek();

		const weeks = await db.weeks.toArray();
		expect(weeks).toHaveLength(2);
		expect(weeks.find((w) => w.id === oldWeek.id)?.endedAt).toBe(at);

		const open = openWeeks(weeks);
		expect(open).toHaveLength(1);
		const newWeekId = open[0].id;
		expect(newWeekId).not.toBe(oldWeek.id);
		expect(open[0].startedAt).toBe(at);

		expect((await taskRow(nextAction.id)).weekId).toBe(newWeekId);
		expect((await taskRow(ordinary.id)).weekId).toBe(newWeekId);
		expect((await taskRow(finished.id)).weekId).toBe(oldWeek.id);
		// Deleted work is neither carried nor archived.
		expect((await taskRow(discarded.id)).weekId).toBe(oldWeek.id);

		expect(summary).toEqual({ archived: 1, carried: 2, carriedNextActions: 1, stalled: 1 });
	});

	it('does not mark carried work as edited', async () => {
		const project = await repo.createProject('Kitchen');
		const task = await repo.addTask({ projectId: project.id, title: 'Measure the run' });
		const untouchedSince = (await taskRow(task.id)).updatedAt;

		tick(86_400_000);
		await repo.startNewWeek();

		expect((await taskRow(task.id)).updatedAt).toBe(untouchedSince);
		expect((await taskRow(task.id)).completedAt).toBeNull();
	});

	it('leaves exactly one open week when run twice in a row', async () => {
		await repo.startNewWeek();
		tick(86_400_000);
		await repo.startNewWeek();

		const weeks = await db.weeks.toArray();
		expect(openWeeks(weeks)).toHaveLength(1);
		expect((await repo.readSnapshot()).currentWeek?.endedAt).toBeNull();
	});
});

describe('backup round-trip', () => {
	it('restores an identical snapshot through exportAll, parseBackup and importAll', async () => {
		await seedEverything();
		const before = await repo.readSnapshot();

		const file = await repo.exportAll();
		expect(file.format).toBe('cairn.backup');

		// Through JSON, exactly as a real file would travel.
		const parsed = parseBackup(JSON.parse(JSON.stringify(file)) as unknown, now);
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.warnings).toEqual([]);

		tick();
		const summary = await repo.importAll(parsed.data);
		const after = await repo.readSnapshot();

		expect(after).toEqual(before);
		expect(summary).toEqual({
			projects: before.projects.length,
			tasks: before.tasks.length,
			inboxItems: before.inboxItems.length,
			fixedDates: before.fixedDates.length,
			weeks: before.weeks.length
		});
	});

	it('replaces existing rows rather than merging the backup into them', async () => {
		const doomed = await repo.createProject('Will be replaced');
		await repo.addTask({ projectId: doomed.id, title: 'Also replaced' });
		await repo.captureInboxItem('Replaced too');
		await repo.setSetting('wipLimit', 9);

		const incoming: Project = {
			id: 'imported-project',
			title: 'Imported',
			status: 'parked',
			nextActionId: null,
			order: 0,
			createdAt: T0,
			updatedAt: T0,
			deletedAt: null
		};
		const backup: BackupData = {
			projects: [incoming],
			tasks: [],
			inboxItems: [],
			fixedDates: [],
			weeks: [],
			settings: {}
		};

		tick();
		await repo.importAll(backup);
		const snapshot = await repo.readSnapshot();

		expect(snapshot.projects).toEqual([incoming]);
		expect(snapshot.tasks).toEqual([]);
		expect(snapshot.inboxItems).toEqual([]);
		expect(snapshot.settings).toEqual(DEFAULT_SETTINGS);
	});

	it('leaves exactly one open week even when the backup carried none', async () => {
		const backup: BackupData = {
			projects: [],
			tasks: [],
			inboxItems: [],
			fixedDates: [],
			weeks: [makeWeek('only-closed', T0 - 500_000, T0 - 400_000)],
			settings: {}
		};

		const at = tick();
		await repo.importAll(backup);
		const snapshot = await repo.readSnapshot();

		expect(openWeeks(snapshot.weeks)).toHaveLength(1);
		expect(snapshot.currentWeek?.startedAt).toBe(at);
		expect(snapshot.weeks).toHaveLength(2);
	});

	// REGRESSION — the same defect reached through the public API with no cast and no
	// hand-written row. Object spread copies an own `__proto__` key as an ordinary
	// property, which is exactly what `JSON.parse` yields for a hand-edited file, so
	// `importAll` used to persist a settings row keyed `__proto__` and the next read
	// assigned it. `withSettingDefaults` now copies known keys explicitly.
	it('does not let a `__proto__` key in the backup settings reshape the snapshot', async () => {
		const backup: BackupData = {
			projects: [],
			tasks: [],
			inboxItems: [],
			fixedDates: [],
			weeks: [],
			// Exactly what `JSON.parse` yields for a hand-edited or third-party file: an
			// own enumerable property, not a prototype change.
			settings: JSON.parse('{"__proto__":{"wipLimit":999}}') as Partial<SettingsMap>
		};

		await repo.importAll(backup);
		const { settings } = await repo.readSnapshot();

		expect(Object.getPrototypeOf(settings)).toBe(Object.prototype);
		expect(settings).toEqual(DEFAULT_SETTINGS);
	});

	it('restores rows the backup carried, including soft-deleted ones', async () => {
		const fixedDate: FixedDate = {
			id: 'fd-1',
			title: 'Passport expires',
			date: '2027-01-15',
			note: 'renew early',
			createdAt: T0,
			updatedAt: T0,
			deletedAt: null
		};
		const tombstoned: InboxItem = {
			id: 'ib-1',
			text: 'Long since handled',
			createdAt: T0 - 1_000,
			updatedAt: T0,
			deletedAt: T0
		};
		const backup: BackupData = {
			projects: [],
			tasks: [],
			inboxItems: [tombstoned],
			fixedDates: [fixedDate],
			weeks: [],
			settings: { wipLimit: 7, theme: 'light' }
		};

		await repo.importAll(backup);
		const snapshot = await repo.readSnapshot();

		expect(snapshot.fixedDates).toEqual([fixedDate]);
		expect(snapshot.inboxItems).toEqual([tombstoned]);
		expect(snapshot.settings).toEqual({ ...DEFAULT_SETTINGS, wipLimit: 7, theme: 'light' });
	});
});

describe('clearAll', () => {
	it('empties every table', async () => {
		await seedEverything();
		expect(await db.projects.count()).toBeGreaterThan(0);

		await repo.clearAll();

		expect([
			await db.projects.count(),
			await db.tasks.count(),
			await db.inboxItems.count(),
			await db.fixedDates.count(),
			await db.weeks.count(),
			await db.settings.count()
		]).toEqual([0, 0, 0, 0, 0, 0]);

		const snapshot = await repo.readSnapshot();
		expect(snapshot).toEqual({
			projects: [],
			tasks: [],
			inboxItems: [],
			fixedDates: [],
			weeks: [],
			currentWeek: null,
			settings: DEFAULT_SETTINGS
		} satisfies Snapshot);
	});
});
