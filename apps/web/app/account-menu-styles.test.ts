import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

const stylesUrl = new URL("./styles.css", import.meta.url);

describe("account menu layout", () => {
  test("keeps the data panel dropdown absolutely positioned", async () => {
    const css = await readFile(stylesUrl, "utf8");

    expect(css).toMatch(
      /\.account-shell \.account-menu\s*\{[^}]*position:\s*absolute;/su,
    );
  });
});
