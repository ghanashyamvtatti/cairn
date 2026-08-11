import type { Snapshot } from '$lib/repo';
import type { SyncPayload } from './protocol';
import type { SettingKey, SettingsMap } from '$lib/types';

/**
 * Works out what a mutation actually changed, by comparing the local database before and
 * after it ran.
 *
 * This is what lets the whole of `src/lib/domain` stay the single implementation of every
 * rule. Rather than describing each operation to the server in its own vocabulary, the
 * client runs the operation it already knows how to run and then reports the rows that
 * moved. A new repository method needs no new sync code at all.
 *
 * Diffing whole snapshots is only sane because the dataset is bounded by a three-project
 * WIP limit — a few hundred rows, compared field-free by identity and `updatedAt`.
 */

interface Tracked {
	id: string;
	updatedAt: number;
}

function changedRows<T extends Tracked>(before: readonly T[], after: readonly T[]): T[] {
	const previous = new Map(before.map((row) => [row.id, row]));
	return after.filter((row) => {
		const old = previous.get(row.id);
		// New, or touched. `updatedAt` is bumped by every repository write, so this is
		// exact for anything the app itself did.
		return !old || old.updatedAt !== row.updatedAt;
	});
}

/** Weeks have no `updatedAt`, so they are compared structurally. */
function changedWeeks(before: Snapshot['weeks'], after: Snapshot['weeks']): Snapshot['weeks'] {
	const previous = new Map(before.map((w) => [w.id, JSON.stringify(w)]));
	return after.filter((w) => previous.get(w.id) !== JSON.stringify(w));
}

function changedSettings(before: SettingsMap, after: SettingsMap): Partial<SettingsMap> {
	const out: Record<string, unknown> = {};
	for (const key of Object.keys(after) as SettingKey[]) {
		if (before[key] !== after[key]) out[key] = after[key];
	}
	return out as Partial<SettingsMap>;
}

export function diffSnapshots(before: Snapshot, after: Snapshot): SyncPayload {
	return {
		projects: changedRows(before.projects, after.projects),
		tasks: changedRows(before.tasks, after.tasks),
		inboxItems: changedRows(before.inboxItems, after.inboxItems),
		fixedDates: changedRows(before.fixedDates, after.fixedDates),
		weeks: changedWeeks(before.weeks, after.weeks),
		settings: changedSettings(before.settings, after.settings)
	};
}

export function isEmptyPayload(payload: SyncPayload): boolean {
	return (
		payload.projects.length === 0 &&
		payload.tasks.length === 0 &&
		payload.inboxItems.length === 0 &&
		payload.fixedDates.length === 0 &&
		payload.weeks.length === 0 &&
		Object.keys(payload.settings).length === 0
	);
}

export function countPayload(payload: SyncPayload): number {
	return (
		payload.projects.length +
		payload.tasks.length +
		payload.inboxItems.length +
		payload.fixedDates.length +
		payload.weeks.length +
		Object.keys(payload.settings).length
	);
}

/**
 * Merges rows arriving from the server into the shape `importAll` expects.
 *
 * A pull is partial — only what changed above the cursor — so the current local rows have
 * to be layered underneath it, with the server's copy winning on any id it mentions.
 * Tombstones arrive as ordinary rows carrying `deletedAt`, which is exactly why nothing
 * is ever hard-deleted.
 */
export function applyPull(local: Snapshot, incoming: SyncPayload): SyncPayload {
	const merge = <T extends { id: string }>(current: readonly T[], next: readonly T[]): T[] => {
		const byId = new Map(current.map((row) => [row.id, row]));
		for (const row of next) byId.set(row.id, row);
		return [...byId.values()];
	};

	return {
		projects: merge(local.projects, incoming.projects),
		tasks: merge(local.tasks, incoming.tasks),
		inboxItems: merge(local.inboxItems, incoming.inboxItems),
		fixedDates: merge(local.fixedDates, incoming.fixedDates),
		weeks: merge(local.weeks, incoming.weeks),
		settings: { ...local.settings, ...incoming.settings }
	};
}
