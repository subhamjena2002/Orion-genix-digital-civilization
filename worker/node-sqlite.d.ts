// The little of Node's built-in SQLite the tests use (worker/testing.ts); @types/node 20 predates it.
declare module "node:sqlite" {
	export class DatabaseSync {
		constructor(path: string);
		exec(sql: string): void;
		prepare(sql: string): { get(...values: unknown[]): unknown; run(...values: unknown[]): unknown };
	}
}
