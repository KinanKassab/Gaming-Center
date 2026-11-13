import { formatDateTimeForDisplay, formatMinorAmountForDisplay } from "@/i18n/format";
import type { AppLocale } from "@/i18n/locales";
import type { LedgerLine } from "@/modules/finance/customer-ledger";

export function CustomerStatementTable(props: {
  locale: AppLocale;
  currency: string;
  lines: LedgerLine[];
  timeZone?: string;
  labels: {
    date: string;
    description: string;
    charge: string;
    credit: string;
    balance: string;
    empty: string;
  };
  kindLabels: Record<LedgerLine["entryKind"], string>;
}) {
  if (props.lines.length === 0) {
    return <p>{props.labels.empty}</p>;
  }
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>{props.labels.date}</th>
            <th>{props.labels.description}</th>
            <th>{props.labels.charge}</th>
            <th>{props.labels.credit}</th>
            <th>{props.labels.balance}</th>
          </tr>
        </thead>
        <tbody>
          {props.lines.map((line) => (
            <tr key={line.id}>
              <td>{formatDateTimeForDisplay(line.occurredAt, props.locale, props.timeZone)}</td>
              <td>
                {props.kindLabels[line.entryKind]}
                {line.description ? ` — ${line.description}` : ""}
              </td>
              <td>
                {line.direction === "DEBIT"
                  ? formatMinorAmountForDisplay(line.amountMinor, props.currency, props.locale)
                  : ""}
              </td>
              <td>
                {line.direction === "CREDIT"
                  ? formatMinorAmountForDisplay(line.amountMinor, props.currency, props.locale)
                  : ""}
              </td>
              <td>{formatMinorAmountForDisplay(line.balanceMinor, props.currency, props.locale)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
