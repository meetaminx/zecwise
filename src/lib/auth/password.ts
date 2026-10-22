import bcrypt from "bcryptjs";

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12) throw new Error("Passwords must be at least 12 characters.");
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

let dummy: string | null = null;
/** A real bcrypt hash used when an email is unknown, so failed logins take the same time either way. */
export function dummyHash(): string {
  dummy ??= bcrypt.hashSync("zecwise-timing-equalizer", 12);
  return dummy;
}
