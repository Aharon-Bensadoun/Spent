import type { TransactionWithCategory } from "./types";

function escapeCsvCell(value: string | number | null | undefined): string {
  if (value == null) return "";
  const str = String(value);
  if (/[",\r\n]/.test(str)) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function row(values: (string | number | null | undefined)[]): string {
  return values.map(escapeCsvCell).join(",");
}

const HEADERS = [
  "Date",
  "Processed Date",
  "Description",
  "Memo",
  "Charged Amount",
  "Charged Currency",
  "Original Amount",
  "Original Currency",
  "Category",
  "Kind",
  "Status",
  "Provider",
  "Account Number",
  "Type",
  "Installment",
];

function formatInstallment(txn: TransactionWithCategory): string {
  if (txn.installmentNumber == null || txn.installmentTotal == null) {
    return "";
  }
  return `${txn.installmentNumber}/${txn.installmentTotal}`;
}

export function transactionsToCsv(transactions: TransactionWithCategory[]): string {
  const lines = [row(HEADERS)];

  for (const txn of transactions) {
    lines.push(
      row([
        txn.date,
        txn.processedDate,
        txn.description,
        txn.memo,
        txn.chargedAmount,
        txn.chargedCurrency,
        txn.originalAmount,
        txn.originalCurrency,
        txn.categoryName,
        txn.kind,
        txn.status,
        txn.provider,
        txn.accountNumber,
        txn.type,
        formatInstallment(txn),
      ])
    );
  }

  return lines.join("\r\n");
}

export function downloadCsv(content: string, filename: string): void {
  const blob = new Blob(["\uFEFF", content], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
