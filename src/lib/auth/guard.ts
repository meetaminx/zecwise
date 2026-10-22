import "server-only";
import { getSessionUser, type Role, type SessionUser } from "./session";

const RANK: Record<Role, number> = { viewer: 1, editor: 2, admin: 3 };

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403,
  ) {
    super(message);
  }
}

/**
 * Server-enforced role check for admin API routes. Viewers can read the
 * dashboard, editors can manage sources and documents, admins can do everything.
 */
export async function requireRole(minimum: Role): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AuthError("Sign in required.", 401);
  if (RANK[user.role] < RANK[minimum]) throw new AuthError("You do not have permission to do that.", 403);
  return user;
}

export function hasRole(user: SessionUser | null, minimum: Role): boolean {
  return Boolean(user && RANK[user.role] >= RANK[minimum]);
}
