import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import type { Env } from "./index";

/**
 * For tests: the save API's database as a real SQLite one in memory, with the real migrations
 * applied, behind the few D1 calls the API makes.
 */
export function memoryDatabase(): { env: Env; db: DatabaseSync } {
	const db = new DatabaseSync(":memory:");
	db.exec(readFileSync(new URL("../migrations/0001_guest_saves.sql", import.meta.url), "utf8"));
	const env: Env = {
		DB: {
			prepare(query: string) {
				let values: unknown[] = [];
				const statement = {
					bind(...next: unknown[]) {
						values = next;
						return statement;
					},
					async first<T>() {
						const row = db.prepare(query).get(...(values as never[]));
						return (row ?? null) as T | null;
					},
				};
				return statement;
			},
		},
	};
	return { env, db };
}

/** A browser's cookie jar for one origin, as far as the save API needs one. */
export class CookieJar {
	private readonly cookies = new Map<string, string>();

	public header(): string {
		return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
	}

	public take(response: Response): void {
		const set = response.headers.get("set-cookie");
		if (!set) return;
		const [pair] = set.split(";");
		const at = pair.indexOf("=");
		this.cookies.set(pair.slice(0, at), pair.slice(at + 1));
	}

	public clear(): void {
		this.cookies.clear();
	}
}
