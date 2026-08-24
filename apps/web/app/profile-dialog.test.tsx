// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, test, vi } from "vitest";

import { ProfileDialog } from "./profile-dialog";

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

describe("ProfileDialog", () => {
  test("loads only the private profile fields and offers all six bundled avatars", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, {
      email: "driver@example.com",
      nickname: "Night Racer",
      avatarKey: "racer-red",
    })));
    render(<ProfileDialog onClose={vi.fn()} onDeleted={vi.fn()} onSaved={vi.fn()} open />);

    expect(screen.getByRole("status").textContent).toContain("LOADING PROFILE");
    expect((await screen.findByDisplayValue("driver@example.com")).hasAttribute("readonly")).toBe(true);
    expect(screen.getByDisplayValue("Night Racer")).toBeTruthy();
    expect(screen.getAllByRole("radio")).toHaveLength(6);
    expect((screen.getByRole("radio", { name: "Racer red" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("button", { name: /delete account/iu })).toBeTruthy();
  });

  test("saves nickname and selected avatar to the own-profile API", async () => {
    const user = userEvent.setup();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, {
        email: "driver@example.com",
        nickname: "Night Racer",
        avatarKey: "racer-red",
      }))
      .mockResolvedValueOnce(jsonResponse(200, {
        email: "driver@example.com",
        nickname: "Track Ghost",
        avatarKey: "wheel-fire",
      }));
    vi.stubGlobal("fetch", fetchMock);
    const onSaved = vi.fn();
    render(<ProfileDialog onClose={vi.fn()} onDeleted={vi.fn()} onSaved={onSaved} open />);

    const nickname = await screen.findByLabelText(/^nickname/iu);
    await user.clear(nickname);
    await user.type(nickname, "Track Ghost");
    await user.click(screen.getByRole("radio", { name: "Wheel fire" }));
    await user.click(screen.getByRole("button", { name: /save profile/iu }));

    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/account/profile", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ nickname: "Track Ghost", avatarKey: "wheel-fire" }),
    }));
    expect((await screen.findByRole("status")).textContent).toContain("Profile saved");
    expect(onSaved).toHaveBeenCalledWith({
      email: "driver@example.com",
      nickname: "Track Ghost",
      avatarKey: "wheel-fire",
    });
  });

  test("shows an inline conflict without disclosing another account", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("fetch", vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, {
        email: "driver@example.com",
        nickname: "Night Racer",
        avatarKey: "racer-red",
      }))
      .mockResolvedValueOnce(jsonResponse(409, { error: "Profile update unavailable" })));
    render(<ProfileDialog onClose={vi.fn()} onDeleted={vi.fn()} onSaved={vi.fn()} open />);

    await screen.findByLabelText(/^nickname/iu);
    await user.click(screen.getByRole("button", { name: /save profile/iu }));
    expect((await screen.findByRole("alert")).textContent).toContain("That nickname is unavailable.");
    expect(screen.getByRole("alert").textContent).not.toContain("owner");
  });

  test("requires exact confirmation before deleting the signed-in account", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, {
        email: "driver@example.com",
        nickname: "Night Racer",
        avatarKey: "racer-red",
      }))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true, message: "Account deleted." }));
    vi.stubGlobal("fetch", fetchMock);
    const onDeleted = vi.fn();
    render(<ProfileDialog onClose={vi.fn()} onDeleted={onDeleted} onSaved={vi.fn()} open />);

    await screen.findByLabelText(/^nickname/iu);
    await user.click(screen.getByRole("button", { name: /delete account/iu }));
    expect(screen.getByRole("heading", { name: /delete account permanently/iu })).toBeTruthy();
    expect(screen.getByRole("link", { name: /terms of service/iu }).getAttribute("href")).toBe("/terms");
    expect(screen.getByRole("link", { name: /privacy policy/iu }).getAttribute("href")).toBe("/privacy");

    const confirmButton = screen.getByRole("button", { name: /permanently delete account/iu }) as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);
    await user.type(screen.getByLabelText(/type delete/iu), "DELET");
    expect(confirmButton.disabled).toBe(true);
    await user.type(screen.getByLabelText(/type delete/iu), "E");
    expect(confirmButton.disabled).toBe(false);
    await user.click(confirmButton);

    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/account/delete", expect.objectContaining({
      method: "DELETE",
      body: JSON.stringify({ confirmation: "DELETE" }),
    }));
    expect(onDeleted).toHaveBeenCalledOnce();
  });

  test("keeps the newest profile when an aborted load resolves late", async () => {
    const firstLoad = deferred<Response>();
    const secondLoad = deferred<Response>();
    const fetchMock = vi.fn()
      .mockReturnValueOnce(firstLoad.promise)
      .mockReturnValueOnce(secondLoad.promise);
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = render(
      <ProfileDialog onClose={vi.fn()} onDeleted={vi.fn()} onSaved={vi.fn()} open />,
    );

    rerender(<ProfileDialog onClose={vi.fn()} onDeleted={vi.fn()} onSaved={vi.fn()} open={false} />);
    rerender(<ProfileDialog onClose={vi.fn()} onDeleted={vi.fn()} onSaved={vi.fn()} open />);
    const firstRequest = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(firstRequest.signal?.aborted).toBe(true);

    await act(async () => {
      secondLoad.resolve(jsonResponse(200, {
        email: "new@example.com",
        nickname: "Newest Racer",
        avatarKey: "racer-cyan",
      }));
      await secondLoad.promise;
    });
    expect(await screen.findByDisplayValue("Newest Racer")).toBeTruthy();

    await act(async () => {
      firstLoad.resolve(jsonResponse(200, {
        email: "old@example.com",
        nickname: "Stale Racer",
        avatarKey: "racer-red",
      }));
      await firstLoad.promise;
    });
    expect(screen.getByDisplayValue("Newest Racer")).toBeTruthy();
    expect(screen.queryByDisplayValue("Stale Racer")).toBeNull();
  });

  test("does not save or notify after the profile dialog closes", async () => {
    const user = userEvent.setup();
    const saveRequest = deferred<Response>();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, {
        email: "driver@example.com",
        nickname: "Night Racer",
        avatarKey: "racer-red",
      }))
      .mockReturnValueOnce(saveRequest.promise)
      .mockResolvedValueOnce(jsonResponse(200, {
        email: "driver@example.com",
        nickname: "Night Racer",
        avatarKey: "racer-red",
      }));
    vi.stubGlobal("fetch", fetchMock);
    const onSaved = vi.fn();
    const { rerender } = render(
      <ProfileDialog onClose={vi.fn()} onDeleted={vi.fn()} onSaved={onSaved} open />,
    );

    await screen.findByLabelText(/^nickname/iu);
    await user.click(screen.getByRole("button", { name: /save profile/iu }));
    rerender(<ProfileDialog onClose={vi.fn()} onDeleted={vi.fn()} onSaved={onSaved} open={false} />);
    const saveInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(saveInit.signal?.aborted).toBe(true);

    await act(async () => {
      saveRequest.resolve(jsonResponse(200, {
        email: "driver@example.com",
        nickname: "Night Racer",
        avatarKey: "racer-red",
      }));
      await saveRequest.promise;
    });
    expect(onSaved).not.toHaveBeenCalled();

    rerender(<ProfileDialog onClose={vi.fn()} onDeleted={vi.fn()} onSaved={onSaved} open />);
    expect(await screen.findByDisplayValue("Night Racer")).toBeTruthy();
    expect((screen.getByRole("button", { name: /save profile/iu }) as HTMLButtonElement).disabled).toBe(false);
  });

  test("cannot dismiss the dialog while permanent deletion is running", async () => {
    const user = userEvent.setup();
    const deleteRequest = deferred<Response>();
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, {
        email: "driver@example.com",
        nickname: "Night Racer",
        avatarKey: "racer-red",
      }))
      .mockReturnValueOnce(deleteRequest.promise));
    const onClose = vi.fn();
    render(<ProfileDialog onClose={onClose} onDeleted={vi.fn()} onSaved={vi.fn()} open />);

    await screen.findByLabelText(/^nickname/iu);
    await user.click(screen.getByRole("button", { name: /delete account/iu }));
    await user.type(screen.getByLabelText(/type delete/iu), "DELETE");
    await user.click(screen.getByRole("button", { name: /permanently delete account/iu }));

    const dialog = screen.getByRole("dialog", { name: /delete account permanently/iu });
    fireEvent(dialog, new Event("cancel", { bubbles: true, cancelable: true }));
    const closeButton = screen.getByRole("button", { name: /close profile dialog/iu }) as HTMLButtonElement;
    expect(closeButton.disabled).toBe(true);
    await user.click(closeButton);
    expect(onClose).not.toHaveBeenCalled();
  });

  test("does not report deletion after the parent closes the dialog", async () => {
    const user = userEvent.setup();
    const deleteRequest = deferred<Response>();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, {
        email: "driver@example.com",
        nickname: "Night Racer",
        avatarKey: "racer-red",
      }))
      .mockReturnValueOnce(deleteRequest.promise);
    vi.stubGlobal("fetch", fetchMock);
    const onDeleted = vi.fn();
    const { rerender } = render(
      <ProfileDialog onClose={vi.fn()} onDeleted={onDeleted} onSaved={vi.fn()} open />,
    );

    await screen.findByLabelText(/^nickname/iu);
    await user.click(screen.getByRole("button", { name: /delete account/iu }));
    await user.type(screen.getByLabelText(/type delete/iu), "DELETE");
    await user.click(screen.getByRole("button", { name: /permanently delete account/iu }));
    rerender(<ProfileDialog onClose={vi.fn()} onDeleted={onDeleted} onSaved={vi.fn()} open={false} />);
    const deleteInit = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(deleteInit.signal?.aborted).toBe(true);

    await act(async () => {
      deleteRequest.resolve(jsonResponse(200, { ok: true, message: "Account deleted." }));
      await deleteRequest.promise;
    });
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
