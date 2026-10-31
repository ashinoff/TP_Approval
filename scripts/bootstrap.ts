import pg from 'pg';
import { z } from 'zod';
// Explicit one-time trusted provisioning: no default accounts or passwords.
const env=z.object({MIGRATION_DATABASE_URL:z.string().min(1),BOOTSTRAP_ISSUER:z.url(),BOOTSTRAP_SUBJECT:z.string().min(1),BOOTSTRAP_NAME:z.string().min(1)}).parse(process.env);
const db=new pg.Client({connectionString:env.MIGRATION_DATABASE_URL});await db.connect();
try {
  await db.query('BEGIN');
  const user=(await db.query('INSERT INTO app.users(issuer,subject,name) VALUES($1,$2,$3) ON CONFLICT(issuer,subject) DO UPDATE SET name=excluded.name RETURNING id',[env.BOOTSTRAP_ISSUER,env.BOOTSTRAP_SUBJECT,env.BOOTSTRAP_NAME])).rows[0];
  await db.query("INSERT INTO app.roles(user_id,role) VALUES($1,'TECH_ADMIN') ON CONFLICT DO NOTHING",[user.id]);
  await db.query('COMMIT');console.log(`Технический администратор привязан: ${user.id}`);
}catch(e){await db.query('ROLLBACK');throw e;}finally{await db.end();}
