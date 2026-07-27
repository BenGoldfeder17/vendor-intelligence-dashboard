"use client";
import DomainHub from "@/components/DomainHub";
import Overview from "@/components/Overview";
import InsightsView from "@/components/InsightsView";

export default function SalesHub() {
  return (
    <DomainHub
      param="view"
      tabs={[
        { id: "overview", label: "Overview", icon: "ti-chart-line", render: () => <Overview /> },
        { id: "drags", label: "Drags & drivers", icon: "ti-arrows-up-down", render: () => <InsightsView /> },
      ]}
    />
  );
}
