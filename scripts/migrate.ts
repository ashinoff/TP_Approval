import pg from 'pg';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export async function migrate(url: string, password: string) {
  const db = new pg.Client({connectionString:url}); await db.connect();
  try {
    await db.query('SELECT pg_advisory_lock(817623)');
    const role = await db.query("SELECT 1 FROM pg_roles WHERE rolname='tp_runtime'");
    if (!role.rowCount) await db.query('CREATE ROLE tp_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS');
    const literal = await db.query('SELECT quote_literal($1) AS value',[password]);
    await db.query(`ALTER ROLE tp_runtime PASSWORD ${literal.rows[0].value}`);
    await db.query('CREATE TABLE IF NOT EXISTS public.schema_migrations(name text PRIMARY KEY, hash text NOT NULL, applied_at timestamptz DEFAULT now())');
    for (const name of (await readdir('db/migrations')).filter(n=>n.endsWith('.sql')).sort()) {
      const sql=await readFile(`db/migrations/${name}`,'utf8'); const hash=createHash('sha256').update(sql).digest('hex');
      const old=await db.query('SELECT hash FROM public.schema_migrations WHERE name=$1',[name]);
      if(old.rowCount) { if(old.rows[0].hash!==hash) throw new Error(`Migration changed: ${name}`); continue; }
      await db.query('BEGIN');
      try { await db.query(sql); await db.query('INSERT INTO public.schema_migrations(name,hash) VALUES($1,$2)',[name,hash]); await db.query('COMMIT'); }
      catch(e) { await db.query('ROLLBACK'); throw e; }
    }
  } finally { await db.end(); }
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  if(!process.env.MIGRATION_DATABASE_URL || !process.env.RUNTIME_DB_PASSWORD) throw new Error('Set MIGRATION_DATABASE_URL and RUNTIME_DB_PASSWORD');
  await migrate(process.env.MIGRATION_DATABASE_URL,process.env.RUNTIME_DB_PASSWORD);
  console.log('Миграции применены');
}
