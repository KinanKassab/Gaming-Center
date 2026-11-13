import type { ReactNode } from "react";
import Link from "next/link";
import { StatusChip, type StatusTone } from "@/app/_components/status-chip";
import { IconBack } from "@/app/_components/icons";

export function BackLink(props: { href: string; children: ReactNode }) {
  return (
    <Link className="back-link" href={props.href}>
      <IconBack />
      {props.children}
    </Link>
  );
}

export function PageHeader(props: {
  title: string;
  description?: string | undefined;
  context?: ReactNode;
  actions?: ReactNode;
  secondaryActions?: ReactNode;
  filters?: ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <h1>{props.title}</h1>
        {props.description ? <p>{props.description}</p> : null}
        {props.context ? <div className="page-header-context">{props.context}</div> : null}
      </div>
      {props.actions || props.secondaryActions ? (
        <div className="page-header-actions">
          {props.secondaryActions}
          {props.actions}
        </div>
      ) : null}
      {props.filters ? <div className="page-header-filters">{props.filters}</div> : null}
    </div>
  );
}

export function StatusBadge(props: { tone?: StatusTone | undefined; children: ReactNode }) {
  if (props.tone) {
    return <StatusChip tone={props.tone}>{props.children}</StatusChip>;
  }
  return <StatusChip>{props.children}</StatusChip>;
}

export function EmptyState(props: { title: string; body?: string | undefined; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <h2>{props.title}</h2>
      {props.body ? <p>{props.body}</p> : null}
      {props.action}
    </div>
  );
}

export function StatCard(props: {
  label: string;
  value: string;
  hint?: string | undefined;
  action?: ReactNode;
}) {
  return (
    <div className="stat-card">
      <div className="stat-label">{props.label}</div>
      <div className="stat-value">{props.value}</div>
      {props.hint ? <p className="hint">{props.hint}</p> : null}
      {props.action ? <div className="stat-card-action">{props.action}</div> : null}
    </div>
  );
}

export function AccessDenied(props: { title?: string | undefined; message?: string | undefined }) {
  return (
    <EmptyState
      title={props.title ?? "You cannot open this page"}
      body={props.message ?? "Your role does not include this action. Ask an owner if you need access."}
    />
  );
}

export function SelectOrganizationNotice(props: { title?: string | undefined; body?: string | undefined }) {
  return (
    <EmptyState
      title={props.title ?? "Choose a gaming center"}
      body={props.body ?? "Select an organization from the dashboard to continue."}
    />
  );
}
