"use client";

import { ResumeManager } from "@/app/job/search/components/resume-manager";

export default function ResumeManagerPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="container mx-auto px-4 py-6 max-w-6xl">
        <main>
          <ResumeManager />
        </main>
      </div>
    </div>
  );
}
