import { EXAMPLE_DATES, EXAMPLE_INBOX, EXAMPLE_PROJECTS, exampleDate } from '$lib/domain/example';
import type { CairnRepository } from '$lib/repo';

/**
 * Writes the worked example through the ordinary repository methods.
 *
 * Deliberately not a bulk insert: going through `createProject`, `addTask` and
 * `addFixedDate` means the example is subject to exactly the same invariants as anything
 * the user creates — one next action per project, a week stamped on every task — so it
 * can never seed a state the app could not otherwise reach.
 */
export async function seedExample(repo: CairnRepository, now: Date = new Date()): Promise<void> {
	for (const project of EXAMPLE_PROJECTS) {
		const created = await repo.createProject(project.title);
		for (const task of project.tasks) {
			await repo.addTask({
				projectId: created.id,
				title: task.title,
				asNextAction: task.isNextAction === true
			});
		}
	}

	for (const entry of EXAMPLE_DATES) {
		await repo.addFixedDate({
			title: entry.title,
			date: exampleDate(entry.inDays, now),
			note: entry.note
		});
	}

	// Oldest first, so the inbox's newest-first ordering reads naturally.
	for (const text of [...EXAMPLE_INBOX].reverse()) {
		await repo.captureInboxItem(text);
	}
}
