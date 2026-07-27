"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavSyncButton } from "@/components/sync-ui";

const LINKS = [
  { href: "/", label: "Triage", icon: "ti-alert-hexagon", match: (p: string) => p === "/" },
  { href: "/risk", label: "Revenue risk", icon: "ti-shield-half", match: (p: string) => p.startsWith("/risk") },
  { href: "/sales", label: "Sales", icon: "ti-chart-line", match: (p: string) => p.startsWith("/sales") },
  { href: "/listings", label: "Listings", icon: "ti-list-details", match: (p: string) => p.startsWith("/listings") || p.startsWith("/product") },
];

export default function Nav() {
  const pathname = usePathname() || "/";
  return (
    <nav className="nav">
      <div className="nav-links">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className={l.match(pathname) ? "nav-link on" : "nav-link"}>
            <i className={`ti ${l.icon}`} aria-hidden="true" />
            {l.label}
          </Link>
        ))}
      </div>
      <NavSyncButton />
    </nav>
  );
}
