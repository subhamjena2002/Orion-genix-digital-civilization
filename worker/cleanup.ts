import type { Env } from "./index";

/**
 * The daily tidy-up (wrangler.jsonc `triggers.crons`): rows nobody can use any more.
 *
 *  - Sessions past their expiry. A session is deleted when it's presented after it expires, but
 *    one whose cookie is gone (cleared, a private window closed) is never presented again.
 *  - Email links that were used, or have expired. Either way they can't be used again.
 *
 * Deleted a few thousand rows at a time, so one run never holds the database for long; a backlog
 * bigger than a run's share is finished the next day.
 */

const BATCH = 2000;
const MAX_BATCHES = 25;

export interface CleanupReport {
	sessions: number;
	emailTokens: number;
}

/** Deletes in batches until a batch comes back short (or the run's share is used). */
async function deleteInBatches(env: Env, query: string, now: number): Promise<number> {
	let total = 0;
	for (let batch = 0; batch < MAX_BATCHES; batch++) {
		const { meta } = await env.DB.prepare(query).bind(now, BATCH).run();
		total += meta.changes;
		if (meta.changes < BATCH) break;
	}
	return total;
}

export async function cleanUp(env: Env, now = Date.now()): Promise<CleanupReport> {
	const sessions = await deleteInBatches(
		env,
		"DELETE FROM sessions WHERE token_hash IN (SELECT token_hash FROM sessions WHERE expires_at <= ?1 LIMIT ?2)",
		now,
	);
	const emailTokens = await deleteInBatches(
		env,
		"DELETE FROM email_tokens WHERE token_hash IN (SELECT token_hash FROM email_tokens WHERE used_at IS NOT NULL OR expires_at <= ?1 LIMIT ?2)",
		now,
	);
	// Counts only: nothing about whose rows they were.
	console.log(`cleanup: ${sessions} expired sessions, ${emailTokens} used or expired email links`);
	return { sessions, emailTokens };
}
