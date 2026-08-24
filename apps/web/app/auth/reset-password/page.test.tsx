import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import {
  consumeResetTokenFromLocation,
  ResetPasswordStatus,
  submitResetPassword,
} from "./page";

describe("reset-password page states", () => {
  test.each([
    ["form", "RESET PASSWORD"],
    ["submitting", "RESET PASSWORD"],
    ["invalid", "LINK EXPIRED"],
    ["updated", "PASSWORD UPDATED"],
  ] as const)("renders the %s state without exposing token-shaped content", (state, heading) => {
    const markup = renderToStaticMarkup(<ResetPasswordStatus state={state} />);
    expect(markup).toContain(heading);
    expect(markup).not.toMatch(/[A-Za-z0-9_-]{43}/u);
    expect(markup).not.toContain("token=");
    if (state === "submitting") expect(markup).toContain("disabled");
  });

  test("reads only the fragment token and immediately strips it from browser history", () => {
    const replaceState = vi.fn();
    const token = consumeResetTokenFromLocation(
      new URL("https://rcmania.live/auth/reset-password?token=query-leak#token=fragment-secret"),
      replaceState,
    );
    expect(token).toBe("fragment-secret");
    expect(replaceState).toHaveBeenCalledWith({}, "", "/auth/reset-password");
  });

  test("ignores a second submit while the first request is pending", async () => {
    let settle!: (response: Response) => void;
    const fetcher = vi.fn(() => new Promise<Response>((resolve) => {
      settle = resolve;
    }));
    const gate = { current: false };

    const first = submitResetPassword({
      token: "fragment-secret",
      password: "new correct horse battery",
      gate,
      fetcher,
    });
    const second = submitResetPassword({
      token: "fragment-secret",
      password: "new correct horse battery",
      gate,
      fetcher,
    });
    expect(fetcher).toHaveBeenCalledOnce();
    await expect(second).resolves.toBeNull();
    settle(new Response(null, { status: 200 }));
    await expect(first).resolves.toBe("updated");
  });
});
