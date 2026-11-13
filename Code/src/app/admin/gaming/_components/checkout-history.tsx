"use client";

import { DataTable } from "@/app/_components/data-table";

export type CheckoutHistoryRow = {
  id: string;
  received: string;
  method: string;
  amount: string;
  status: string;
};

export function CheckoutPaymentHistory(props: {
  emptyLabel: string;
  columns: {
    received: string;
    method: string;
    amount: string;
    status: string;
  };
  rows: CheckoutHistoryRow[];
}) {
  return (
    <DataTable
      columns={[
        { key: "received", header: props.columns.received, cell: (row) => row.received },
        { key: "method", header: props.columns.method, cell: (row) => row.method },
        { key: "amount", header: props.columns.amount, cell: (row) => row.amount },
        { key: "status", header: props.columns.status, cell: (row) => row.status },
      ]}
      rows={props.rows}
      rowKey={(row) => row.id}
      empty={<p>{props.emptyLabel}</p>}
    />
  );
}
