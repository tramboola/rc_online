import { hash, verify } from "@node-rs/argon2";

const passwordPolicy = {
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32,
  algorithm: 2,
} as const;

const passwordLengthError = "Password must contain 12 to 128 characters";

export async function hashPassword(password: string): Promise<string> {
  assertPasswordLength(password);

  return hash(password, passwordPolicy);
}

export async function verifyPassword(
  storedHash: string,
  password: string,
): Promise<{ valid: boolean; needsRehash: boolean }> {
  if (!hasValidPasswordLength(password)) {
    return { valid: false, needsRehash: false };
  }

  try {
    const valid = await verify(storedHash, password);

    return {
      valid,
      needsRehash: valid && !matchesPasswordPolicy(storedHash),
    };
  } catch {
    return { valid: false, needsRehash: false };
  }
}

function assertPasswordLength(password: string): void {
  if (!hasValidPasswordLength(password)) {
    throw new Error(passwordLengthError);
  }
}

function hasValidPasswordLength(password: string): boolean {
  let length = 0;

  for (const _character of password) {
    length += 1;

    if (length > 128) {
      return false;
    }
  }

  return length >= 12;
}

function matchesPasswordPolicy(storedHash: string): boolean {
  const match = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$[^$]+\$([^$]+)$/.exec(
    storedHash,
  );

  if (!match) {
    return false;
  }

  const memoryCost = match[1];
  const timeCost = match[2];
  const parallelism = match[3];
  const digest = match[4];

  if (!memoryCost || !timeCost || !parallelism || !digest) {
    return false;
  }

  return (
    Number(memoryCost) >= passwordPolicy.memoryCost &&
    Number(timeCost) >= passwordPolicy.timeCost &&
    Number(parallelism) === passwordPolicy.parallelism &&
    Buffer.from(digest, "base64").byteLength >= passwordPolicy.outputLen
  );
}
