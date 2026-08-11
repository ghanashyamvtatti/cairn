import type { FixedDate, InboxItem, Project, SettingsMap, Task, Week } from '$lib/types';

/**
 * The wire format, shared by the client and the server so they cannot drift.
 *
 * Rows rather than named mutations. The alternative — an endpoint per repository method —
 * would mean reimplementing every rule in `src/lib/domain` a second time in SQL, and two
 * implementations of a rule are two chances to disagree. Instead the client computes the
 * resulting rows with the logic it already has, pushes them, and the database enforces
 * the invariants that must hold no matter which device is writing (one next action per
 * project, one open week per account) through partial unique indexes.
 *
 * Safety comes from `baseSeq`: the client says which version of the world it based its
 * change on, and the server refuses the write if any row it touches has moved on since.
 * That turns a lost update into a visible retry.
 */

export interface SyncPayload {
	projects: Project[];
	tasks: Task[];
	inboxItems: InboxItem[];
	fixedDates: FixedDate[];
	weeks: Week[];
	settings: Partial<SettingsMap>;
}

export interface SyncPull extends SyncPayload {
	/** The account's cursor after this read. Pass it back as `since` next time. */
	seq: number;
}

export interface SyncPush extends Partial<SyncPayload> {
	/** The cursor the client held when it computed these rows. */
	baseSeq: number;
}

export type SyncPushResult =
	| ({ ok: true } & SyncPull)
	/**
	 * Someone else changed one of these rows first. The client re-pulls, replays the
	 * user's intent against the fresh state, and pushes again — rather than silently
	 * overwriting the other device.
	 */
	| { ok: false; conflict: true; seq: number };

export const EMPTY_PAYLOAD: SyncPayload = {
	projects: [],
	tasks: [],
	inboxItems: [],
	fixedDates: [],
	weeks: [],
	settings: {}
};

/** Tables that carry rows with ids, in a fixed order so writes are deterministic. */
export const SYNC_TABLES = ['projects', 'tasks', 'inboxItems', 'fixedDates', 'weeks'] as const;
export type SyncTable = (typeof SYNC_TABLES)[number];

export function isEmptyPush(push: SyncPush): boolean {
	return (
		SYNC_TABLES.every((table) => (push[table]?.length ?? 0) === 0) &&
		Object.keys(push.settings ?? {}).length === 0
	);
}
