// @vitest-environment jsdom

import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConnectionBackground } from "./connection-loading-screen";

describe("connection background", () => {
  it("shows a lightweight preview until the full background has decoded", () => {
    const { container } = render(<ConnectionBackground />);
    const preview = container.querySelector<HTMLImageElement>(".connection-background-preview");
    const full = container.querySelector<HTMLImageElement>(".connection-background");

    expect(preview?.getAttribute("src")).toContain("loading-background-preview.webp?v=320q35-1");
    expect(full?.getAttribute("src")).toContain("loading-background.webp?v=1280q65-1");
    expect(full?.dataset.loaded).toBe("false");

    fireEvent.load(full!);

    expect(full?.dataset.loaded).toBe("true");
  });

  it("reveals a full background that finished loading before React attached its handler", async () => {
    const complete = vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
    const naturalWidth = vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(1280);

    const { container } = render(<ConnectionBackground />);

    await waitFor(() => {
      expect(container.querySelector<HTMLImageElement>(".connection-background")?.dataset.loaded).toBe("true");
    });

    complete.mockRestore();
    naturalWidth.mockRestore();
  });
});
