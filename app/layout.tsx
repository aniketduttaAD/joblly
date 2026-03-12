import type { Metadata, Viewport } from "next";
import "./globals.css";
import { GlobalApiKeyBar } from "./components/global-api-key-bar";
import { AppAuthProvider } from "./components/app-auth-provider";

export const metadata: Metadata = {
  title: "Job Search & Tracker",
  description: "Track applications, search jobs, and analyse JDs with AI.",
  applicationName: "Job Search & Application Copilot",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Job Search & Tracker",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: "/icon.png",
    apple: "/icon.png",
  },
  openGraph: {
    type: "website",
    siteName: "Job Search & Tracker",
    title: "Job Search & Tracker",
    description: "Track applications, search jobs, and analyse JDs with AI.",
  },
  twitter: {
    card: "summary",
    title: "Job Search & Tracker",
    description: "Track applications, search jobs, and analyse JDs with AI.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#f97316",
  userScalable: true,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-beige-50 font-sans text-stone-800 antialiased">
        <AppAuthProvider>
          <GlobalApiKeyBar />
          {children}
        </AppAuthProvider>
      </body>
    </html>
  );
}
