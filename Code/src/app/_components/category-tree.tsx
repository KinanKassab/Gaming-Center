"use client";

import { useState, type ReactNode } from "react";
import { useT } from "@/i18n/provider";

const PAGE_SIZE = 3;

export type CategoryGroup<T> = {
  id: string;
  label: string;
  items: T[];
};

export function CategoryTree<T>(props: {
  groups: CategoryGroup<T>[];
  listClassName: string;
  itemKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
}) {
  const t = useT();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [visible, setVisible] = useState<Record<string, number>>({});

  return (
    <div className="category-tree">
      {props.groups.map((group) => {
        const expanded = open[group.id] !== false;
        const shown = visible[group.id] ?? PAGE_SIZE;
        const items = group.items.slice(0, shown);
        const hasMore = group.items.length > shown;
        return (
          <section key={group.id} className="category-tree-group">
            <button
              type="button"
              className="category-tree-toggle"
              aria-expanded={expanded}
              onClick={() => setOpen((current) => ({ ...current, [group.id]: !expanded }))}
            >
              <span>{group.label}</span>
              <span className="hint">{group.items.length}</span>
            </button>
            {expanded ? (
              <>
                <div className={props.listClassName}>
                  {items.map((item) => (
                    <div key={props.itemKey(item)} className="category-tree-item">
                      {props.renderItem(item)}
                    </div>
                  ))}
                </div>
                {hasMore ? (
                  <button
                    type="button"
                    className="btn-secondary category-tree-more"
                    onClick={() =>
                      setVisible((current) => ({
                        ...current,
                        [group.id]: (current[group.id] ?? PAGE_SIZE) + PAGE_SIZE,
                      }))
                    }
                  >
                    {t("common.showMore")}
                  </button>
                ) : null}
              </>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
