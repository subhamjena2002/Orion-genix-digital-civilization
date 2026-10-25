import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import type { Env } from "./index";

/**
 * For tests: the save API's database as a real SQLite one in memory, with the real migrations
 * applied, behind the few D1 calls the API makes.
 */
export function memoryDatabase(): { env: Env; db: DatabaseSync } {
	const db = new DatabaseSync(":memory:");
	const migrations = new URL("../migrations/", import.meta.url);
	for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(file, migrations), "utf8"));
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
					async run() {
						const result = db.prepare(query).run(...(values as never[])) as { changes: number | bigint };
						return { meta: { changes: Number(result.changes) } };
					},
				};
				return statement;
			},
		},
	};
	return { env, db };
}

/** A browser's cookie jar for one origin, as far as the API needs one: Max-Age=0 removes a cookie. */
export class CookieJar {
	private readonly cookies = new Map<string, string>();

	public header(): string {
		return [...this.cookies].map(([name, value]) => `${name}=${value}`).join("; ");
	}

	public take(response: Response): void {
		for (const set of response.headers.getSetCookie()) {
			const [pair] = set.split(";");
			const at = pair.indexOf("=");
			const name = pair.slice(0, at);
			if (/;\s*Max-Age=0(;|$)/i.test(set)) this.cookies.delete(name);
			else this.cookies.set(name, pair.slice(at + 1));
		}
	}

	public get(name: string): string | undefined {
		return this.cookies.get(name);
	}

	public clear(): void {
		this.cookies.clear();
	}
}
