import type { Metadata } from "next";
import Link from "next/link";
import Nav from "@/components/Nav";
import { DateRangeProvider } from "@/components/DateRangeContext";
import FloatingDateBar from "@/components/FloatingDateBar";
import "./globals.css";
import { identity } from "@/config/app.config";

export const metadata: Metadata = {
  title: identity.appName,
  description: `${identity.appName} — marketplace vendor analytics`,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <DateRangeProvider>
          <header className="topbar">
            <Link href="/" className="brand">
              {identity.appMark}
            </Link>
            <Nav />
          </header>
          <main className="container">{children}</main>
          <FloatingDateBar />
        </DateRangeProvider>
      </body>
    </html>
  );
}
