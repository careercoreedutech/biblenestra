// Database access. In Cloudflare Workers we talk to Neon over HTTPS with the serverless driver;
// tests and the local dev server inject an in-process Postgres (PGlite) as env.__db.
// Every helper takes plain SQL with $1…$n parameters (never string-concatenate user input).
import { neon } from '@neondatabase/serverless';

const cache = new Map();

export function getDb(env) {
  if (env.__db) return env.__db;
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  let sql = cache.get(env.DATABASE_URL);
  if (!sql) { sql = neon(env.DATABASE_URL); cache.set(env.DATABASE_URL, sql); }
  return {
    async query(text, params = []) { return sql.query(text, params); },
  };
}

export async function q(env, text, params) {
  return getDb(env).query(text, params);
}

export async function one(env, text, params) {
  const rows = await q(env, text, params);
  return rows[0] || null;
}

// WALLET CORE: several statements as ONE Postgres transaction (all commit or none). On Neon this is the HTTP driver's
// non-interactive transaction (sql.transaction: one HTTPS request, BEGIN … COMMIT on the server, READ COMMITTED);
// locally / in tests it is a PGlite transaction. Statements cannot read each other's results in JS — chain them in SQL
// (e.g. keyed by the same id / ref) or put dependent writes in one statement with data-modifying CTEs.
// statements: [[text, params], …] → array of row arrays (one per statement).
export async function tx(env, statements) {
  if (env.__db) {
    const db = env.__db;
    if (typeof db.transaction === 'function') return db.transaction(statements);
    if (db.pg && typeof db.pg.transaction === 'function') {
      return db.pg.transaction(async (t) => {
        const out = [];
        for (const [text, params] of statements) out.push((await t.query(text, params || [])).rows);
        return out;
      });
    }
    throw new Error('tx() needs a transactional test database');
  }
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not configured');
  let sql = cache.get(env.DATABASE_URL);
  if (!sql) { sql = neon(env.DATABASE_URL); cache.set(env.DATABASE_URL, sql); }
  return sql.transaction((t) => statements.map(([text, params]) => t.query(text, params || [])));
}
