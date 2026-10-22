import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { config } from "@/lib/config";
import { queryOne } from "@/lib/db";

export type Role = "admin" | "editor" | "viewer";
export type SessionUser = { id: string; email: string; role: Role };

const SESSION_COOKIE = "zw_session";
const SESSION_TTL_SECONDS = 60 * 60 * 12;

function secretKey(): Uint8Array {
  if (!config.sessionSecret || config.sessionSecret.length < 32) {
    throw new Error("SESSION_SECRET must be set to at least 32 characters to enable sign-in.");
  }
  return new TextEncoder().encode(config.sessionSecret);
}

export async function createSessionCookie(user: SessionUser) {
  const token = await new SignJWT({ role: user.role, email: user.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey());
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

/**
 * Reads and verifies the session, then re-checks the user and role against the
 * database so that a revoked or demoted account loses access immediately rather
 * than when the token expires.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || !config.sessionSecret) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    if (!payload.sub) return null;
    const user = await queryOne<SessionUser>("select id, email, role from users where id = $1", [payload.sub]);
    return user ?? null;
  } catch {
    return null;
  }
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;
