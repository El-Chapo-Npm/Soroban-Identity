/** Recovery phrase backup UI (issue #1256). */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { RecoveryPhraseBackup } from "./RecoveryPhraseBackup";

let seed = 12345;
const random = () => ((seed = (seed * 1103515245 + 12345) % 0x80000000) / 0x80000000);

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
  });
});

describe("RecoveryPhraseBackup (#1256)", () => {
  it("requires confirming three words before completing the backup", async () => {
    const onComplete = vi.fn();
    render(<RecoveryPhraseBackup onComplete={onComplete} storageKey="test-backup-1" random={random} />);

    fireEvent.click(screen.getByTestId("backup-begin"));
    const words = [...screen.getByTestId("backup-phrase").querySelectorAll("li")].map(
      (li) => li.textContent ?? "",
    );
    expect(words).toHaveLength(12);

    const continueButton = screen.getByTestId("backup-continue") as HTMLButtonElement;
    expect(continueButton.disabled).toBe(true);
    fireEvent.click(screen.getByTestId("backup-acknowledged"));
    expect(continueButton.disabled).toBe(false);
    fireEvent.click(continueButton);

    const inputs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
      .map((position) => screen.queryByTestId(`backup-answer-${position}`))
      .filter((el): el is HTMLElement => el !== null);
    expect(inputs).toHaveLength(3);

    // A wrong answer must block completion.
    fireEvent.change(inputs[0], { target: { value: "definitely-wrong" } });
    inputs.slice(1).forEach((input, index) => {
      fireEvent.change(input, { target: { value: words[index + 1] } });
    });
    fireEvent.click(screen.getByTestId("backup-confirm"));
    expect(await screen.findByTestId("backup-error")).toBeTruthy();
    expect(onComplete).not.toHaveBeenCalled();

    // Correct answers at every requested position complete the flow.
    const requestedPositions = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].filter((position) =>
      screen.queryByTestId(`backup-answer-${position}`),
    );
    requestedPositions.forEach((position, index) => {
      const input = screen.getByTestId(`backup-answer-${position}`);
      fireEvent.change(input, { target: { value: words[position - 1] } });
      void index;
    });
    fireEvent.click(screen.getByTestId("backup-confirm"));

    expect(await screen.findByTestId("backup-complete")).toBeTruthy();
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(store.get("test-backup-1")).toMatch(/^[a-f0-9]{64}$/);
  });

  it("does not store the phrase itself", async () => {
    const onComplete = vi.fn();
    render(<RecoveryPhraseBackup onComplete={onComplete} storageKey="test-backup-2" random={random} />);
    fireEvent.click(screen.getByTestId("backup-begin"));
    const words = [...screen.getByTestId("backup-phrase").querySelectorAll("li")].map(
      (li) => li.textContent ?? "",
    );

    fireEvent.click(screen.getByTestId("backup-acknowledged"));
    fireEvent.click(screen.getByTestId("backup-continue"));

    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].forEach((position) => {
      const input = screen.queryByTestId(`backup-answer-${position}`);
      if (input) fireEvent.change(input, { target: { value: words[position - 1] } } as never);
    });
    fireEvent.click(screen.getByTestId("backup-confirm"));

    await waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    const stored = store.get("test-backup-2") ?? "";
    expect(stored).not.toContain(words.join(" "));
    expect(stored).toMatch(/^[a-f0-9]{64}$/);
  });
});
