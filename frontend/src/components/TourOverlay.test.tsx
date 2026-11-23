import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import TourOverlay from "./TourOverlay";

describe("TourOverlay", () => {
  it("uses the canonical holder path and advances through its steps", async () => {
    const user = userEvent.setup();
    render(<TourOverlay open path="holder" onClose={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: /holder onboarding tour/i })).toBeInTheDocument();
    expect(screen.getByText("Welcome to your holder wallet")).toBeInTheDocument();
    expect(screen.getByText("Step 1 of 7")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Resolve a DID")).toBeInTheDocument();
    expect(screen.getByText("Step 2 of 7")).toBeInTheDocument();
  });

  it("reports a skipped tour to the state owner", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TourOverlay open path="issuer" onClose={onClose} />);

    await user.click(screen.getByRole("button", { name: "Skip tour" }));

    expect(onClose).toHaveBeenCalledWith("skipped");
  });
});
