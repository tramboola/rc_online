import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { VerificationStatus } from "./page";

describe("verification page states", () => {
  test.each([
    ["verifying", "VERIFYING EMAIL"],
    ["verified", "EMAIL VERIFIED"],
    ["invalid", "LINK INVALID OR EXPIRED"],
  ] as const)("renders the %s state without exposing token-shaped content", (state, heading) => {
    const markup = renderToStaticMarkup(<VerificationStatus state={state} />);
    expect(markup).toContain(heading);
    expect(markup).not.toMatch(/[A-Za-z0-9_-]{43}/u);
    expect(markup).not.toContain("token=");
  });
});
