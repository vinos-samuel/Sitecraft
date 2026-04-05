import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "OmniLead | Intelligent Business Discovery",
  description: "AI-driven lead generation and automated outreach CRM.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <div className="bg-gradient"></div>
        <nav className="navbar">
          <div className="logo">OmniLead</div>
        </nav>
        {children}
      </body>
    </html>
  );
}
