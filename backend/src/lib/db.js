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
