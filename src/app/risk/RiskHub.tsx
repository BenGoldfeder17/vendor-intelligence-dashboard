"use client";
import DomainHub from "@/components/DomainHub";
import RiskMonitor from "@/components/RiskMonitor";
import MarginWatch from "@/components/MarginWatch";
import PoCombined from "@/components/PoCombined";
export default function RiskHub() {
  return (
    <DomainHub
      param="panel"
      tabs={[
        { id: "monitor", label: "Risk monitor", icon: "ti-shield-half",
          render: () => <RiskMonitor /> },
        { id: "crap", label: "Margin watch", icon: "ti-alert-triangle",
          render: () => <MarginWatch /> },
        { id: "confirmation", label: "PO & confirmation", icon: "ti-file-check",
          render: () => <PoCombined initialView="confirmation" /> },
      ]}
    />
  );
}
