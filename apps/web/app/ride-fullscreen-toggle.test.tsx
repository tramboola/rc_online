// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RideFullscreenToggle } from "./ride-fullscreen-toggle";

describe("RideFullscreenToggle", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("requests fullscreen for the ride surface from a user action", async () => {
    const target = document.createElement("div");
    const requestFullscreen = vi.fn(async () => undefined);
    Object.defineProperty(target, "requestFullscreen", {
      configurable: true,
      value: requestFullscreen,
    });

    render(<RideFullscreenToggle target={{ current: target }} />);
    fireEvent.click(screen.getByRole("button", { name: "FULL SCREEN" }));

    await waitFor(() => expect(requestFullscreen).toHaveBeenCalledTimes(1));
  });

  it("explains when fullscreen is unavailable instead of failing silently", async () => {
    const target = document.createElement("div");

    render(<RideFullscreenToggle target={{ current: target }} />);
    fireEvent.click(screen.getByRole("button", { name: "FULL SCREEN" }));

    expect((await screen.findByRole("status")).textContent).toBe("FULLSCREEN UNAVAILABLE");
  });
});
