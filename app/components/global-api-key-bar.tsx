"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Briefcase, Sparkles, Search, Lock } from "lucide-react";
import { useAppAuth } from "@/app/components/app-auth-provider";

const navItems = [
  {
    href: "/",
    label: "Job Application Tracker",
    icon: Briefcase,
    description: "Your saved job applications and statuses",
  },
  {
    href: "/job/search",
    label: "Resume Manager",
    icon: Sparkles,
    description: "Upload and manage your resumes (max 5)",
  },
  {
    href: "/job/explorer",
    label: "Job Search",
    icon: Search,
    description: "External job listings from the Jobs API",
  },
] as const;

export function GlobalApiKeyBar() {
  const pathname = usePathname();
  const { authRequired, authenticated, signOut, user } = useAppAuth();

  return (
    <header className="sticky top-0 z-50 border-b border-beige-300 bg-beige-100/95 backdrop-blur supports-[backdrop-filter]:bg-beige-100/80">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5 sm:px-6">
        <div className="flex min-w-0 flex-1 items-center gap-3 sm:gap-4">
          <Link
            href="/"
            className="flex shrink-0 items-center gap-2 text-stone-800 hover:opacity-90"
          >
            <Image src="/icon.png" alt="" width={28} height={28} className="rounded-lg" />
          </Link>
          <nav
            className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto whitespace-nowrap pb-1 sm:gap-2 sm:pb-0"
            aria-label="Main"
          >
            {navItems.map(({ href, label, icon: Icon, description }) => {
              const isActive = href === "/" ? pathname === "/" : pathname?.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  title={description}
                  className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-medium transition-colors sm:px-3 ${
                    isActive
                      ? "bg-orange-brand text-white"
                      : "text-stone-600 hover:bg-beige-200 hover:text-stone-800"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="hidden sm:inline">{label}</span>
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {authRequired && authenticated && (
            <button
              type="button"
              onClick={() => {
                void signOut();
              }}
              title={user?.email ? `Signed in as ${user.email}` : "Sign out"}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-beige-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 shadow-sm hover:bg-beige-50 focus:outline-none focus:ring-2 focus:ring-orange-brand/20"
            >
              <Lock className="h-4 w-4 shrink-0" />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
