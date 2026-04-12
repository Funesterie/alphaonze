import * as React from "react";

export type PirateInspectorTab = {
  id: string;
  label: string;
  caption?: string;
  badge?: React.ReactNode;
  content: React.ReactNode;
};

type PirateInspectorProps = {
  title: string;
  eyebrow?: string;
  tabs: PirateInspectorTab[];
  activeTab: string;
  onChange: (tabId: string) => void;
  className?: string;
};

export default function PirateInspector({
  title,
  eyebrow = "Infos",
  tabs,
  activeTab,
  onChange,
  className = "",
}: PirateInspectorProps) {
  const resolvedActiveTab = tabs.find((tab) => tab.id === activeTab) || tabs[0];

  return (
    <section className={`casino-inspector ${className}`.trim()}>
      <div className="casino-inspector__header">
        <span className="casino-chip">{eyebrow}</span>
        <strong>{title}</strong>
      </div>

      <div className="casino-inspector__tabs" role="tablist" aria-label={title}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`casino-inspector__tab ${tab.id === resolvedActiveTab.id ? "is-active" : ""}`}
            role="tab"
            aria-selected={tab.id === resolvedActiveTab.id}
            onClick={() => onChange(tab.id)}
          >
            <span>{tab.label}</span>
            {tab.badge ? <b>{tab.badge}</b> : null}
          </button>
        ))}
      </div>

      <div className="casino-inspector__panel" role="tabpanel" aria-label={resolvedActiveTab.label}>
        {resolvedActiveTab.caption ? <p className="casino-inspector__caption">{resolvedActiveTab.caption}</p> : null}
        {resolvedActiveTab.content}
      </div>
    </section>
  );
}
