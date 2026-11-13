"use client";

import type { ReactNode } from "react";
import { EmptyState } from "@/app/_components/page-ui";
import { Skeleton } from "@/app/_components/feedback";
import { useT } from "@/i18n/provider";

export type DataTableColumn<T> = {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
  hideOnMobile?: boolean;
};

export function DataTable<T>(props: {
  columns: Array<DataTableColumn<T>>;
  rows: T[];
  rowKey: (row: T) => string;
  toolbar?: ReactNode;
  filters?: ReactNode;
  empty?: ReactNode;
  loading?: boolean;
  pagination?: ReactNode;
  selectedKey?: string;
}) {
  const t = useT();
  return (
    <div className="data-table">
      {props.toolbar || props.filters ? (
        <div className="data-table-toolbar">
          {props.filters}
          {props.toolbar}
        </div>
      ) : null}
      {props.loading ? (
        <Skeleton lines={4} />
      ) : props.rows.length === 0 ? (
        (props.empty ?? <EmptyState title={t("ui.tableEmpty")} />)
      ) : (
        <>
          <div className="table-scroll desktop-table">
            <table>
              <thead>
                <tr>
                  {props.columns.map((column) => (
                    <th key={column.key} {...(column.className ? { className: column.className } : {})}>
                      {column.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {props.rows.map((row) => {
                  const key = props.rowKey(row);
                  return (
                    <tr key={key} aria-selected={props.selectedKey === key}>
                      {props.columns.map((column) => (
                        <td key={column.key} {...(column.className ? { className: column.className } : {})}>
                          {column.cell(row)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="record-cards">
            {props.rows.map((row) => {
              const key = props.rowKey(row);
              return (
                <article key={key} className="record-card">
                  {props.columns
                    .filter((column) => !column.hideOnMobile)
                    .map((column) => (
                      <p key={column.key}>
                        <span className="type-caption">{column.header}</span>
                        <br />
                        {column.cell(row)}
                      </p>
                    ))}
                </article>
              );
            })}
          </div>
        </>
      )}
      {props.pagination}
    </div>
  );
}
