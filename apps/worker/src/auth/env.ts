export type Env = Record<string, string | undefined>;

const PLACEHOLDER = /replace[-_ ]?me|change[-_ ]?me|placeholder/i;

/** A secret fit to use, or null. `.env.example` ships `replace-me`, which must never work. */
export function secret(env: Env, name: string, minLength: number): string | null {
  const value = env[name]?.trim() ?? "";
  return value.length >= minLength && !PLACEHOLDER.test(value) ? value : null;
}
