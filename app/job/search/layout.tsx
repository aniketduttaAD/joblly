import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "JD & Resume Assistant | Job Application Tracker",
  description: "Analyse JDs and resumes, get answers and insights, and improve your applications.",
};

export default function JobSearchLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return <>{children}</>;
}
