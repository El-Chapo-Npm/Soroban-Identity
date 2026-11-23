import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe } from "vitest-axe";
import NotificationPreferences from "./NotificationPreferences";

const STORAGE_KEY = "soroban-identity.notification-preferences.v1";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("NotificationPreferences", () => {
  it("provides accessible email and in-app channel preferences with honest local-only disclosure", async () => {
    const { container } = render(<NotificationPreferences />);

    expect(
      (screen.getByRole("checkbox", { name: "Email notifications" }) as HTMLInputElement).checked
    ).toBe(false);
    expect(
      (screen.getByRole("checkbox", { name: "In-app notifications" }) as HTMLInputElement).checked
    ).toBe(true);
    expect(screen.getByText(/saved in this browser only/i)).toBeTruthy();
    expect(screen.getByText(/email delivery is not connected/i)).toBeTruthy();
    expect((await axe(container)).violations).toHaveLength(0);
  });

  it("persists updated channel preferences on this device and restores them on remount", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<NotificationPreferences />);

    await user.click(screen.getByRole("checkbox", { name: "Email notifications" }));
    await user.click(screen.getByRole("checkbox", { name: "In-app notifications" }));
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}")).toEqual({
      email: true,
      inApp: false,
    });

    unmount();
    render(<NotificationPreferences />);
    expect(
      (screen.getByRole("checkbox", { name: "Email notifications" }) as HTMLInputElement).checked
    ).toBe(true);
    expect(
      (screen.getByRole("checkbox", { name: "In-app notifications" }) as HTMLInputElement).checked
    ).toBe(false);
  });

  it("falls back safely when stored preferences are malformed", () => {
    window.localStorage.setItem(STORAGE_KEY, "not-json");
    render(<NotificationPreferences />);

    expect(
      (screen.getByRole("checkbox", { name: "Email notifications" }) as HTMLInputElement).checked
    ).toBe(false);
    expect(
      (screen.getByRole("checkbox", { name: "In-app notifications" }) as HTMLInputElement).checked
    ).toBe(true);
  });
});
