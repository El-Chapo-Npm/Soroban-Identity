import React, { useMemo, useState } from "react";
import type { StreamedContractEvent } from "../hooks/useContractEvents";

export type TransactionHistoryTableProps = {
  transactions: StreamedContractEvent[];
};
type SortKey = "timestamp" | "type" | "ledger" | "fee";

function feeValue(transaction: StreamedContractEvent): number {
  const value = transaction.feeCharged ?? transaction.fee;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatFee(transaction: StreamedContractEvent): string {
  const value = transaction.feeCharged ?? transaction.fee;
  return value === undefined ? "—" : String(value);
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function TransactionHistoryTable({ transactions }: TransactionHistoryTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>("timestamp");
  const [descending, setDescending] = useState(true);
  const sorted = useMemo(() => [...transactions].sort((a, b) => {
    let left: string | number = a[sortKey] as string | number;
    let right: string | number = b[sortKey] as string | number;
    if (sortKey === "fee") { left = feeValue(a); right = feeValue(b); }
    if (sortKey === "timestamp") { left = Date.parse(a.timestamp) || 0; right = Date.parse(b.timestamp) || 0; }
    if (left < right) return descending ? 1 : -1;
    if (left > right) return descending ? -1 : 1;
    return 0;
  }), [transactions, sortKey, descending]);

  const changeSort = (key: SortKey) => {
    if (key === sortKey) setDescending((value) => !value);
    else { setSortKey(key); setDescending(key === "timestamp"); }
  };
  const sortLabel = (key: SortKey) => `${key}${sortKey === key ? (descending ? " (descending)" : " (ascending)") : ""}`;
  const header = (key: SortKey, label: string) => (
    <button type="button" onClick={() => changeSort(key)} aria-label={`Sort by ${label}`}>
      {label}{sortKey === key ? (descending ? " ↓" : " ↑") : ""}
    </button>
  );

  return (
    <section aria-labelledby="transaction-history-title">
      <h2 id="transaction-history-title">Transaction history</h2>
      <p>On-chain identity transactions, sorted by timestamp.</p>
      <table>
        <caption className="sr-only">Sortable transaction history</caption>
        <thead><tr>
          <th scope="col">{header("timestamp", "Date")}</th>
          <th scope="col">{header("type", "Type")}</th>
          <th scope="col">Transaction hash</th>
          <th scope="col">{header("ledger", "Ledger")}</th>
          <th scope="col">{header("fee", "Fee")}</th>
        </tr></thead>
        <tbody>
          {sorted.length === 0 ? <tr><td colSpan={5}>No on-chain transactions found.</td></tr> : sorted.map((transaction) => (
            <tr key={transaction.id}>
              <td>{formatDate(transaction.timestamp)}</td>
              <td>{transaction.type}</td>
              <td><a href={`https://stellar.expert/explorer/public/tx/${transaction.txHash}`} target="_blank" rel="noreferrer">{transaction.txHash}</a></td>
              <td>{transaction.ledger}</td>
              <td>{formatFee(transaction)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <span className="sr-only">Active sort: {sortLabel(sortKey)}</span>
    </section>
  );
}
