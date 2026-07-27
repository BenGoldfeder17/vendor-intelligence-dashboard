"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";

export interface HubTab {
  id: string;
  label: string;
  icon?: string; // tabler name
  render: () => ReactNode;
}

/**
 * A domain hub: a horizontal tab bar over several existing views. Reads ?panel=
 * (and ?verdict=, ?view= etc., left intact for the child to read) so a triage
 * signal can deep-link straight to the right tab. Tabs mount lazily — only the
 * active view renders, so we never fire every sub-view's fetches at once.
 */
export default function DomainHub({
  tabs,
  param = "panel",
  defaultTab,
}: {
  tabs: HubTab[];
  param?: string;
  defaultTab?: string;
}) {
  const search = useSearchParams();
  const fromUrl = search.get(param);
  const initial =
    (fromUrl && tabs.some((t) => t.id === fromUrl) && fromUrl) || defaultTab || tabs[0]?.id;
  const [active, setActive] = useState(initial);

  // Follow deep-link changes (e.g. clicking another triage signal while here).
  useEffect(() => {
    if (fromUrl && tabs.some((t) => t.id === fromUrl)) setActive(fromUrl);
  }, [fromUrl, tabs]);

  const current = tabs.find((t) => t.id === active) ?? tabs[0];

  return (
    <div className="hub">
      <div className="hub-tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={t.id === active ? "hub-tab on" : "hub-tab"}
            onClick={() => {
              setActive(t.id);
              // keep the URL shareable without a full navigation
              const url = new URL(window.location.href);
              url.searchParams.set(param, t.id);
              window.history.replaceState(null, "", url.toString());
            }}
          >
            {t.icon && <i className={`ti ${t.icon}`} aria-hidden="true" />}
            {t.label}
          </button>
        ))}
      </div>
      <div className="hub-body">{current?.render()}</div>
    </div>
  );
}
