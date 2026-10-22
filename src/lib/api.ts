import "server-only";
import { AuthError } from "@/lib/auth/guard";
import { DatabaseNotConfiguredError } from "@/lib/db";
import { errorMessage, log } from "@/lib/log";
import { connection } from "next/server";
import { ZodError } from "zod";

export function jsonError(message: string, status: number, extra: Record<string, unknown> = {}) {
  return Response.json({ error: message, ...extra }, { status });
}

/** Wraps a route handler so auth, validation and configuration errors map to clean JSON responses. */
export function handle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    // Every API route depends on the request (cookies, body, DB state), so opt out of
    // prerendering before entering the try block; Next signals this by throwing.
    await connection();
    try {
      return await fn(...args);
    } catch (err) {
      if (err instanceof AuthError) return jsonError(err.message, err.status);
      if (err instanceof ZodError) return jsonError("Invalid request.", 400, { issues: err.issues });
      if (err instanceof DatabaseNotConfiguredError) return jsonError(err.message, 503, { code: "database_not_configured" });
      log("error", "api.unhandled", { error: errorMessage(err) });
      return jsonError("Something went wrong on the server.", 500);
    }
  };
}
