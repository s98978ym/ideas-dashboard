import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Slack AI Analysis Dashboard",
  description: "Collect, analyze, and act on Slack messages with AI-powered workflows",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
