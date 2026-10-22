import { z } from "zod";
import { handle, jsonError } from "@/lib/api";
import { dummyHash, verifyPassword } from "@/lib/auth/password";
import { createSessionCookie, type Role } from "@/lib/auth/session";
import { featureStatus } from "@/lib/config";
import { query, queryOne } from "@/lib/db";
import { clientIp, rateLimit } from "@/lib/ratelimit";

const Body = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(500) });

export const POST = handle(async (req: Request) => {
  if (!featureStatus().auth) return jsonError("Sign-in is not configured (DATABASE_URL and SESSION_SECRET are required).", 503);
  const limit = rateLimit(`login:${clientIp(req.headers)}`, 8, 15 * 60_000);
  if (!limit.ok) return jsonError("Too many sign-in attempts. Try again later.", 429);
  const { email, password } = Body.parse(await req.json());
  const user = await queryOne<{ id: string; email: string; role: Role; password_hash: string }>(
    "select id, email, role, password_hash from users where email = $1",
    [email],
  );
  // Compare against a dummy hash when the user doesn't exist to keep timing similar.
  const ok = await verifyPassword(password, user?.password_hash ?? dummyHash());
  if (!user || !ok) return jsonError("Email or password is incorrect.", 401);
  await query("update users set last_login_at = now() where id = $1", [user.id]);
  await createSessionCookie({ id: user.id, email: user.email, role: user.role });
  return Response.json({ user: { email: user.email, role: user.role } });
});
