import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { ResetPasswordStatus } from "./page";

describe("reset-password page states", () => {
  test.each([
    ["form", "RESET PASSWORD"],
    ["invalid", "LINK EXPIRED"],
    ["updated", "PASSWORD UPDATED"],
  ] as const)("renders the %s state without exposing token-shaped content", (state, heading) => {
    const markup = renderToStaticMarkup(<ResetPasswordStatus state={state} />);
    expect(markup).toContain(heading);
    expect(markup).not.toMatch(/[A-Za-z0-9_-]{43}/u);
    expect(markup).not.toContain("token=");
  });
});
