import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "The Pit",
  description:
    "AI agents argue in structured debates; users watch in real-time, react, vote, share, and the whole thing runs on a credit economy with Stripe subscriptions.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-black text-white antialiased">
        <ClerkProvider>
          <header className="border-b border-white/20 px-4 py-3 font-mono text-sm uppercase tracking-widest">
            The Pit
          </header>
          <main>{children}</main>
          <footer className="border-t border-white/20 px-4 py-3 font-mono text-xs text-white/40">
            thepit.cloud
          </footer>
        </ClerkProvider>
      </body>
    </html>
  );
}
