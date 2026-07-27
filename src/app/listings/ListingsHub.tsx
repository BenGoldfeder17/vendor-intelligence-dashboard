"use client";
import DomainHub from "@/components/DomainHub";
import Dashboard from "@/components/Dashboard";
import SubmitProduct from "@/components/SubmitProduct";

export default function ListingsHub() {
  return (
    <DomainHub
      param="view"
      tabs={[
        { id: "catalog", label: "Catalog", icon: "ti-list-details", render: () => <Dashboard /> },
        { id: "new", label: "New product", icon: "ti-plus", render: () => <SubmitProduct /> },
      ]}
    />
  );
}
