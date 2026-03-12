import type { Metadata } from "next";
import { ErrorBoundary } from "@/app/job/search/components/error-boundary";

export const metadata: Metadata = {
  title: "Job Search & Tracker",
  description: "JD & Resume Assistant and Job Search.",
};

export default function JobLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <ErrorBoundary>{children}</ErrorBoundary>;
}
