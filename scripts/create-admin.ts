import "dotenv/config";
import { Pool } from "pg";
import { hashPassword } from "../src/lib/auth/password";

/**
 * Creates or updates a dashboard user.
 *   npm run create-admin -- you@example.com 'a long password' [admin|editor|viewer]
 */
async function main() {
  const [email, password, role = "admin"] = process.argv.slice(2);
  if (!email || !password) throw new Error("Usage: npm run create-admin -- <email> <password> [admin|editor|viewer]");
  if (!["admin", "editor", "viewer"].includes(role)) throw new Error("Role must be admin, editor or viewer");
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const hash = await hashPassword(password);
  await pool.query(
    `insert into users (email, password_hash, role) values ($1, $2, $3)
     on conflict (email) do update set password_hash = excluded.password_hash, role = excluded.role`,
    [email.trim().toLowerCase(), hash, role],
  );
  await pool.end();
  console.log(`${email} is now ${role}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
