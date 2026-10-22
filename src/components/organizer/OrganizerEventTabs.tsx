"use client";

import { useState, type ReactNode } from "react";

import { cx } from "@/components/ui/cx";
import { ORGANIZER_EVENT_TABS, type OrganizerEventTabId } from "@/lib/organizer/event-tabs";

const tabClass =
  "inline-flex min-h-11 items-center whitespace-nowrap rounded-lg border px-4 text-base font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-byla-blue";

function shownOnMobile(section: OrganizerEventTabId, tab: OrganizerEventTabId) {
  return tab === section ? "" : "hidden lg:block";
}

type Props = {
  eventId: string;
  initialTab?: OrganizerEventTabId;
  evento: ReactNode;
  vendas: ReactNode;
  pedidos: ReactNode;
  portaria: ReactNode;
  pedidosEquipe: ReactNode;
  financeiro: ReactNode;
  deleteSection: ReactNode;
};

export function OrganizerEventTabs({
  eventId,
  initialTab = "evento",
  evento,
  vendas,
  pedidos,
  portaria,
  pedidosEquipe,
  financeiro,
  deleteSection,
}: Props) {
  const [tab, setTab] = useState<OrganizerEventTabId>(() =>
    ORGANIZER_EVENT_TABS.some((item) => item.id === initialTab) ? initialTab : "evento",
  );

  function selectTab(next: OrganizerEventTabId) {
    setTab(next);
    const path =
      next === "evento"
        ? `/organizador/eventos/${eventId}`
        : `/organizador/eventos/${eventId}?aba=${next}`;
    window.history.replaceState(null, "", path);
  }

  return (
    <>
      <nav aria-label="Partes do evento" className="mt-6 lg:hidden">
        <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
          {ORGANIZER_EVENT_TABS.map((item) => {
            const current = item.id === tab;
            return (
              <li className="shrink-0" key={item.id}>
                <button
                  aria-current={current ? "page" : undefined}
                  className={cx(
                    tabClass,
                    current
                      ? "border-byla-action bg-byla-action text-white"
                      : "border-byla-border text-foreground hover:bg-byla-overlay",
                  )}
                  onClick={() => selectTab(item.id)}
                  type="button"
                >
                  {item.label}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="mt-6 grid gap-10 lg:mt-8 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start lg:gap-8">
        <section aria-labelledby="evento-titulo" className={shownOnMobile("evento", tab)}>
          {evento}
        </section>

        <div className={cx("grid min-w-0 gap-10", tab === "evento" ? "hidden lg:grid" : "")}>
          <section aria-labelledby="vendas-titulo" className={shownOnMobile("vendas", tab)}>
            {vendas}
          </section>
          <section aria-labelledby="portaria-titulo" className={shownOnMobile("portaria", tab)}>
            {portaria}
          </section>
          <section aria-labelledby="pedidos-equipe-titulo" className={shownOnMobile("pedidos-equipe", tab)}>
            {pedidosEquipe}
          </section>
          <section aria-labelledby="pedidos-titulo" className={shownOnMobile("pedidos", tab)}>
            {pedidos}
          </section>
          <section aria-labelledby="financeiro-titulo" className={shownOnMobile("financeiro", tab)}>
            {financeiro}
          </section>
        </div>
      </div>

      <div className={cx("mt-10", shownOnMobile("evento", tab))}>{deleteSection}</div>
    </>
  );
}
