import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Semblocks",
  description: "Semantic search over local research archives.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-page-bg text-neutral-800 font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
