import { hash as hashArgon2 } from "@node-rs/argon2";
import { describe, expect, test } from "vitest";

import { hashPassword, verifyPassword } from "./password";

describe("password primitives", () => {
  test("rejects an 11-character password instead of accepting a below-policy credential", async () => {
    await expect(hashPassword("abcdefghijk")).rejects.toThrow(
      "Password must contain 12 to 128 characters",
    );
  });

  test("rejects a 129-character password instead of silently truncating it", async () => {
    await expect(hashPassword("x".repeat(129))).rejects.toThrow(
      "Password must contain 12 to 128 characters",
    );
  });

  test("accepts 128 Unicode characters when an astral character uses two UTF-16 code units", async () => {
    await expect(hashPassword(`${"x".repeat(127)}🏁`)).resolves.toMatch(/^\$argon2id\$/);
  });

  test("authenticates a correct Unicode passphrase instead of rejecting a valid credential", async () => {
    const storedHash = await hashPassword("correct horse 🏁");

    await expect(verifyPassword(storedHash, "correct horse 🏁")).resolves.toEqual({
      valid: true,
      needsRehash: false,
    });
  });

  test("refuses an incorrect password instead of authenticating any password against a stored hash", async () => {
    const storedHash = await hashPassword("correct horse 🏁");

    await expect(verifyPassword(storedHash, "wrong password")).resolves.toEqual({
      valid: false,
      needsRehash: false,
    });
  });

  test("uses a fresh salt instead of producing one reusable password hash", async () => {
    const firstHash = await hashPassword("correct horse 🏁");
    const secondHash = await hashPassword("correct horse 🏁");

    expect(firstHash).not.toBe(secondHash);
  });

  test("marks a valid hash with less than 19456 KiB of memory for rehash", async () => {
    const weakHash = await hashArgon2("correct horse 🏁", {
      algorithm: 2,
      memoryCost: 8192,
      timeCost: 2,
      parallelism: 1,
      outputLen: 32,
    });

    await expect(verifyPassword(weakHash, "correct horse 🏁")).resolves.toEqual({
      valid: true,
      needsRehash: true,
    });
  });

  test("returns an invalid result for malformed stored hashes instead of throwing into authentication routes", async () => {
    await expect(verifyPassword("not-an-argon2-hash", "correct horse 🏁")).resolves.toEqual({
      valid: false,
      needsRehash: false,
    });
  });
});
