import type { Metadata } from "next";
import { Newsreader, Caveat, Dancing_Script, Allura, Mr_Dafoe } from "next/font/google";
import "./globals.css";

const newsreader = Newsreader({
  variable: "--font-newsreader",
  subsets: ["latin", "latin-ext"],
  weight: ["200", "300", "400", "500", "600"],
  style: ["normal", "italic"],
});

const caveat = Caveat({
  variable: "--font-caveat",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600"],
});

const dancingScript = Dancing_Script({
  variable: "--font-dancing-script",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "600"],
});

const allura = Allura({
  variable: "--font-allura",
  subsets: ["latin"],
  weight: "400",
});

const mrDafoe = Mr_Dafoe({
  variable: "--font-mr-dafoe",
  subsets: ["latin"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "Puumerkki",
  description: "A quiet desk for documents that need a signature.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${newsreader.variable} ${caveat.variable} ${dancingScript.variable} ${allura.variable} ${mrDafoe.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
