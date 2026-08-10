import type { Project } from '$lib/types';

/**
 * The work-in-progress limit is a *soft* cap: exceeding it is allowed, but never
 * silently.
 *
 * A one-time "are you sure" dialog is the wrong shape for this — you click through it
 * and the constraint is gone. Instead `wipStatus` reports an over-limit state that the
 * home screen renders as a persistent, calm banner for as long as it lasts. Same
 * freedom, but the constraint stays legible, which is the point of the product.
 */

export const MIN_WIP_LIMIT = 1;
export const MAX_WIP_LIMIT = 10;
export const DEFAULT_WIP_LIMIT = 3;

export function isLive(project: Project): boolean {
	return project.deletedAt === null;
}

export function activeProjects(projects: readonly Project[]): Project[] {
	return projects.filter((p) => isLive(p) && p.status === 'active');
}

export function parkedProjects(projects: readonly Project[]): Project[] {
	return projects.filter((p) => isLive(p) && p.status === 'parked');
}

/**
 * An active project with no Next Action is *stalled* — GTD's term for a project that
 * cannot move because nobody has decided what "moving" means. It is flagged, not
 * scolded.
 */
export function stalledProjects(projects: readonly Project[]): Project[] {
	return activeProjects(projects).filter((p) => p.nextActionId === null);
}

export interface WipStatus {
	activeCount: number
	limit: number;
	/** Strictly more active projects than the limit allows. */
	isOverLimit: boolean;
	/** Exactly at the limit — the next project will push you over. */
	isAtLimit: boolean;
	/** How many projects you could add before crossing the limit. Never negative. */
	headroom: number;
	/** How far past the limit you are. Zero unless `isOverLimit`. */
	excess: number;
}

export function clampWipLimit(limit: number): number {
	if (!Number.isFinite(limit)) return DEFAULT_WIP_LIMIT;
	const rounded = Math.round(limit);
	return Math.min(MAX_WIP_LIMIT, Math.max(MIN_WIP_LIMIT, rounded));
}

export function wipStatus(projects: readonly Project[], limit: number): WipStatus {
	const safeLimit = clampWipLimit(limit);
	const activeCount = activeProjects(projects).length;

	return {
		activeCount,
		limit: safeLimit,
		isOverLimit: activeCount > safeLimit,
		isAtLimit: activeCount === safeLimit,
		headroom: Math.max(0, safeLimit - activeCount),
		excess: Math.max(0, activeCount - safeLimit)
	};
}

export type AddProjectDecision =
	| { kind: 'ok'; status: WipStatus }
	/**
	 * Adding is still permitted — this is a soft cap. `parkCandidates` gives the
	 * dialog something concrete to offer instead of a bare warning.
	 */
	| { kind: 'warn'; status: WipStatus; parkCandidates: Project[] };

/**
 * Decides what should happen when the user tries to start another project.
 *
 * Returns `warn` when the new project would sit at or beyond the limit, so the prompt
 * appears *before* you cross the line rather than after.
 */
export function decideAddProject(
	projects: readonly Project[],
	limit: number
): AddProjectDecision {
	const status = wipStatus(projects, limit);

	if (status.activeCount < status.limit) {
		return { kind: 'ok', status };
	}

	// Offer the least recently touched projects first: the ones you have not moved in
	// a while are the honest candidates for parking.
	const parkCandidates = [...activeProjects(projects)].sort((a, b) => a.updatedAt - b.updatedAt);

	return { kind: 'warn', status, parkCandidates };
}

/** Sentence shown in the over-limit banner. Plain, no exclamation, no red. */
export function overLimitMessage(status: WipStatus): string {
	const { activeCount, limit } = status;
	return `${activeCount} active projects, ${limit} is your limit. Parking one will make the rest easier to finish.`;
}
