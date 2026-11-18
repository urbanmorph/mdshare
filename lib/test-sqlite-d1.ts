// Test helper: real SQLite (D1 is SQLite) with the production migrations, behind the slice of
// the D1 API the server uses (prepare/bind/first/all/run, batch). Counts round trips.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { hashToken, tokenPrefix } from "./tokens.ts";

type Args = unknown[];

export function sqliteD1() {
  const d = new DatabaseSync(":memory:");
  const dir = new URL("../migrations/", import.meta.url);
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    d.exec(readFileSync(new URL(f, dir), "utf8"));
  }
  let roundTrips = 0;

  const returnsRows = (sql: string) => /^\s*(SELECT|WITH)\b/i.test(sql) || /\bRETURNING\b/i.test(sql);
  const exec = (sql: string, args: Args) => {
    const s = d.prepare(sql);
    if (returnsRows(sql)) return { results: s.all(...(args as never[])), meta: { changes: 0 } };
    const r = s.run(...(args as never[]));
    return { results: [], meta: { changes: Number(r.changes) } };
  };

  type Stmt = {
    sql: string;
    args: Args;
    bind(...a: Args): Stmt;
    all(): Promise<{ results: unknown[] }>;
    first(): Promise<unknown>;
    run(): Promise<{ meta: { changes: number } }>;
  };
  const stmt = (sql: string, args: Args = []): Stmt => ({
    sql,
    args,
    bind: (...a: Args) => stmt(sql, a),
    all: async () => { roundTrips++; return { results: d.prepare(sql).all(...(args as never[])) }; },
    first: async () => { roundTrips++; return d.prepare(sql).get(...(args as never[])) ?? null; },
    run: async () => { roundTrips++; return exec(sql, args); },
  });

  const db = {
    prepare: (sql: string) => stmt(sql),
    // D1 runs a batch as one transaction, in one round trip
    batch: async (stmts: Stmt[]) => {
      roundTrips++;
      d.exec("BEGIN");
      try {
        const out = stmts.map((s) => exec(s.sql, s.args));
        d.exec("COMMIT");
        return out;
      } catch (err) {
        d.exec("ROLLBACK");
        throw err;
      }
    },
  } as unknown as D1Database;

  return { d, db, roundTrips: () => roundTrips };
}

export function addDoc(d: DatabaseSync, id: string, title = `Doc ${id}`, expiresAt = "2099-01-01T00:00:00.000Z") {
  d.prepare(
    "INSERT INTO documents (id, title, content, content_hash, expires_at) VALUES (?, ?, ?, ?, ?)"
  ).run(id, title, `# ${title}`, `hash-${id}`, expiresAt);
}

export async function addLink(
  d: DatabaseSync,
  docId: string,
  token: string,
  permission: string,
  opts: { active?: number; expiresAt?: string | null; id?: string } = {}
) {
  d.prepare(
    `INSERT INTO links (id, document_id, token_prefix, token_hash, permission, is_active, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    opts.id ?? `link-${token}`,
    docId,
    tokenPrefix(token),
    await hashToken(token),
    permission,
    opts.active ?? 1,
    opts.expiresAt ?? null
  );
}
