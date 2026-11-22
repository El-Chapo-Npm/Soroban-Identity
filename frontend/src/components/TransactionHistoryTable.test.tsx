import { fireEvent, render, screen } from "@testing-library/react";
import TransactionHistoryTable from "./TransactionHistoryTable";
import type { StreamedContractEvent } from "../hooks/useContractEvents";

const transactions: StreamedContractEvent[] = [
  { id: "older", type: "did_registered", contractId: "identity", topic: [], value: {}, ledger: 10, txHash: "tx-old", timestamp: "2026-01-01T00:00:00Z", fee: 3 },
  { id: "newer", type: "credential_issued", contractId: "identity", topic: [], value: {}, ledger: 20, txHash: "tx-new", timestamp: "2026-01-02T00:00:00Z", fee: 1 },
];

describe("TransactionHistoryTable", () => {
  it("sorts transactions when a sortable column is selected", () => {
    render(<TransactionHistoryTable transactions={transactions} />);
    const rows = screen.getAllByRole("row");
    expect(rows[1].textContent).toContain("tx-new");
    fireEvent.click(screen.getByRole("button", { name: "Sort by Ledger" }));
    const sortedRows = screen.getAllByRole("row");
    expect(sortedRows[1].textContent).toContain("tx-old");
  });

  it("shows an explicit empty state", () => {
    render(<TransactionHistoryTable transactions={[]} />);
    expect(screen.getByText("No on-chain transactions found.")).toBeTruthy();
  });
});
