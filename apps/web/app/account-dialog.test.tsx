// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";

import { AccountDialog } from "./account-dialog";

const authMocks = vi.hoisted(() => ({ signIn: vi.fn() }));

vi.mock("next-auth/react", () => ({ signIn: authMocks.signIn }));

function jsonResponse(status: number, body: Record<string, unknown>) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

beforeAll(() => {
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute("open", "");
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, "close", {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.removeAttribute("open");
    },
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("AccountDialog", () => {
  test("opens an accessible sign-in view and closes from the native Escape cancel event", async () => {
    const onClose = vi.fn();
    render(<AccountDialog onClose={onClose} onSignedIn={vi.fn()} open returnTo="/preflight" />);

    const dialog = screen.getByRole("dialog", { name: "Sign in to RC Mania" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByRole("button", { name: /sign in with google/iu })).toBeTruthy();
    expect(screen.getByRole("button", { name: /show create account form/iu })).toBeTruthy();
    expect(screen.getByRole("button", { name: /forgot password/iu })).toBeTruthy();
    expect(screen.getByRole("link", { name: /terms of service/iu }).getAttribute("href")).toBe("/terms");
    expect(screen.getByRole("link", { name: /privacy policy/iu }).getAttribute("href")).toBe("/privacy");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText(/email/iu)));

    fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  test("starts Google sign-in with the current return path", async () => {
    const user = userEvent.setup();
    render(<AccountDialog onClose={vi.fn()} onSignedIn={vi.fn()} open returnTo="/pricing" />);

    await user.click(screen.getByRole("button", { name: /sign in with google/iu }));
    expect(authMocks.signIn).toHaveBeenCalledWith("google", { redirectTo: "/pricing" });
  });

  test("clears credentials and restores sign-in after closing and reopening", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(
      <AccountDialog onClose={onClose} onSignedIn={vi.fn()} open returnTo="/" />,
    );

    await user.click(screen.getByRole("button", { name: /show create account form/iu }));
    await user.type(screen.getByLabelText(/email/iu), "driver@example.com");
    await user.type(screen.getByLabelText(/^password$/iu), "correct horse 12");
    await user.type(screen.getByLabelText(/confirm password/iu), "correct horse 12");
    await user.click(screen.getByRole("button", { name: /close account dialog/iu }));
    expect(onClose).toHaveBeenCalledOnce();

    rerender(<AccountDialog onClose={onClose} onSignedIn={vi.fn()} open={false} returnTo="/" />);
    rerender(<AccountDialog onClose={onClose} onSignedIn={vi.fn()} open returnTo="/" />);

    expect(screen.getByRole("heading", { name: /sign in to rc mania/iu })).toBeTruthy();
    expect(screen.queryByLabelText(/confirm password/iu)).toBeNull();
    expect((screen.getByLabelText(/email/iu) as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText(/^password$/iu) as HTMLInputElement).value).toBe("");
  });

  test("registers without a mandatory checkbox and shows verification with resend", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(202, { ok: true, message: "Check your inbox." }))
      .mockResolvedValueOnce(jsonResponse(202, { ok: true, message: "Check your inbox." }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AccountDialog onClose={vi.fn()} onSignedIn={vi.fn()} open returnTo="/" />);

    await user.click(screen.getByRole("button", { name: /show create account form/iu }));
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByRole("link", { name: /terms of service/iu }).getAttribute("href")).toBe("/terms");
    expect(screen.getByRole("link", { name: /privacy policy/iu }).getAttribute("href")).toBe("/privacy");
    await user.type(screen.getByLabelText(/email/iu), "driver@example.com");
    await user.type(screen.getByLabelText(/^password$/iu), "correct horse 12");
    await user.type(screen.getByLabelText(/confirm password/iu), "correct horse 12");
    const createButtons = screen.getAllByRole("button", { name: /create account/iu });
    await user.click(createButtons.at(-1)!);

    expect(await screen.findByRole("heading", { name: /check your inbox/iu })).toBeTruthy();
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/account/register", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ email: "driver@example.com", password: "correct horse 12" }),
    }));
    await user.click(screen.getByRole("button", { name: /resend verification email/iu }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/account/resend-verification", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ email: "driver@example.com" }),
    }));
    expect((await screen.findByRole("status")).textContent).toContain("Verification email requested");
  });

  test("shows field errors and keeps password sign-in failures generic", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(401, {
      ok: false,
      message: "Unable to sign in.",
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AccountDialog onClose={vi.fn()} onSignedIn={vi.fn()} open returnTo="/" />);

    await user.type(screen.getByLabelText(/email/iu), "not-an-email");
    await user.type(screen.getByLabelText(/^password$/iu), "short");
    await user.click(screen.getByRole("button", { name: /sign in with email/iu }));
    expect(screen.getByText("Enter a valid email address.")).toBeTruthy();
    expect(screen.getByText("Use 12 to 128 characters.")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    await user.clear(screen.getByLabelText(/email/iu));
    await user.clear(screen.getByLabelText(/^password$/iu));
    await user.type(screen.getByLabelText(/email/iu), "driver@example.com");
    await user.type(screen.getByLabelText(/^password$/iu), "correct horse 12");
    await user.click(screen.getByRole("button", { name: /sign in with email/iu }));
    expect((await screen.findByRole("alert")).textContent).toContain("Unable to sign in.");
  });

  test("submits password recovery and shows the generic pending state", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(202, {
      ok: true,
      message: "If this email can be used, check your inbox.",
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<AccountDialog onClose={vi.fn()} onSignedIn={vi.fn()} open returnTo="/" />);

    await user.click(screen.getByRole("button", { name: /forgot password/iu }));
    expect(screen.getByRole("heading", { name: /reset password/iu })).toBeTruthy();
    await user.type(screen.getByLabelText(/email/iu), "driver@example.com");
    await user.click(screen.getByRole("button", { name: /send reset link/iu }));

    expect(fetchMock).toHaveBeenCalledWith("/api/account/forgot-password", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ email: "driver@example.com" }),
    }));
    expect(await screen.findByRole("heading", { name: /check your inbox/iu })).toBeTruthy();
  });

  test("keeps a rate-limited password recovery request in place with an inline error", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(429, {
      ok: false,
      message: "Too many attempts. Try again later.",
    })));
    render(<AccountDialog onClose={vi.fn()} onSignedIn={vi.fn()} open returnTo="/" />);

    await user.click(screen.getByRole("button", { name: /forgot password/iu }));
    await user.type(screen.getByLabelText(/email/iu), "driver@example.com");
    await user.click(screen.getByRole("button", { name: /send reset link/iu }));

    expect((await screen.findByRole("alert")).textContent).toContain("Too many attempts. Try again later.");
    expect(screen.getByRole("heading", { name: /reset password/iu })).toBeTruthy();
  });

  test("refreshes the authenticated page after email sign-in", async () => {
    const user = userEvent.setup();
    const onSignedIn = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, {
      ok: true,
      message: "Signed in.",
    })));
    render(<AccountDialog onClose={vi.fn()} onSignedIn={onSignedIn} open returnTo="/" />);

    await user.type(screen.getByLabelText(/email/iu), "driver@example.com");
    await user.type(screen.getByLabelText(/^password$/iu), "correct horse 12");
    await user.click(screen.getByRole("button", { name: /sign in with email/iu }));
    await waitFor(() => expect(onSignedIn).toHaveBeenCalledOnce());
  });

  test("does not complete an email sign-in after the dialog closes and reopens", async () => {
    const user = userEvent.setup();
    const request = deferred<Response>();
    const fetchMock = vi.fn().mockReturnValue(request.promise);
    vi.stubGlobal("fetch", fetchMock);
    const onSignedIn = vi.fn();
    const onClose = vi.fn();
    const { rerender } = render(
      <AccountDialog onClose={onClose} onSignedIn={onSignedIn} open returnTo="/" />,
    );

    await user.type(screen.getByLabelText(/email/iu), "driver@example.com");
    await user.type(screen.getByLabelText(/^password$/iu), "correct horse 12");
    await user.click(screen.getByRole("button", { name: /sign in with email/iu }));
    await user.click(screen.getByRole("button", { name: /close account dialog/iu }));
    rerender(<AccountDialog onClose={onClose} onSignedIn={onSignedIn} open={false} returnTo="/" />);
    rerender(<AccountDialog onClose={onClose} onSignedIn={onSignedIn} open returnTo="/" />);

    const requestInit = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(requestInit.signal?.aborted).toBe(true);
    await act(async () => {
      request.resolve(jsonResponse(200, { ok: true, message: "Signed in." }));
      await request.promise;
    });

    expect(onSignedIn).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: /sign in to rc mania/iu })).toBeTruthy();
  });

  test("does not let a stale registration response replace a newly selected view", async () => {
    const user = userEvent.setup();
    const request = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn().mockReturnValue(request.promise));
    render(<AccountDialog onClose={vi.fn()} onSignedIn={vi.fn()} open returnTo="/" />);

    await user.click(screen.getByRole("button", { name: /show create account form/iu }));
    await user.type(screen.getByLabelText(/email/iu), "driver@example.com");
    await user.type(screen.getByLabelText(/^password$/iu), "correct horse 12");
    await user.type(screen.getByLabelText(/confirm password/iu), "correct horse 12");
    await user.click(screen.getAllByRole("button", { name: /create account/iu }).at(-1)!);
    await user.click(screen.getByRole("button", { name: /show sign in form/iu }));

    await act(async () => {
      request.resolve(jsonResponse(202, { ok: true, message: "Check your inbox." }));
      await request.promise;
    });

    expect(screen.getByRole("heading", { name: /sign in to rc mania/iu })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /check your inbox/iu })).toBeNull();
  });
});
