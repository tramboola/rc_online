// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";

import { AccountControl } from "./account-control";

const authMocks = vi.hoisted(() => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
  useSession: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/preflight",
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("next-auth/react", () => authMocks);

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("AccountControl", () => {
  test("opens the full account dialog for a signed-out visitor", async () => {
    authMocks.useSession.mockReturnValue({ data: null, status: "unauthenticated" });
    const user = userEvent.setup();
    render(<AccountControl />);

    expect(screen.getByRole("button", { name: "SIGN IN ACCOUNT" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "SIGN IN ACCOUNT" }));
    expect(screen.getByRole("dialog", { name: "Sign in to RC Mania" })).toBeTruthy();
  });

  test("orders edit profile before plans and sign out while preserving admin balance", async () => {
    authMocks.useSession.mockReturnValue({
      data: {
        user: {
          id: "admin-1",
          role: "admin",
          name: "Private Google Name",
          email: "admin@example.com",
          image: null,
          balance: { currency: "USD", amountMinor: 750 },
          nickname: "Track Admin",
          avatarKey: "helmet-lime",
        },
        expires: "2026-08-31T00:00:00.000Z",
      },
      status: "authenticated",
    });
    const user = userEvent.setup();
    render(<AccountControl />);

    await user.click(screen.getByRole("button", { name: /\$7\.50 BALANCE/u }));
    const labels = screen.getAllByRole("menuitem").map((item) => item.textContent?.trim());
    expect(labels).toEqual(["EDIT PROFILE", "MANAGE BALANCE & PLANS", "SIGN OUT"]);
    expect(screen.getByText("Track Admin")).toBeTruthy();
    expect(screen.queryByText("Private Google Name")).toBeNull();
  });
});
