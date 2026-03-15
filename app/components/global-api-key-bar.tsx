"use client";

import { useState, useEffect } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Key, Eye, EyeOff, Briefcase, Sparkles, Search, FileText, Lock } from "lucide-react";
import {
  getJobsApiKey,
  setJobsApiKey,
  removeJobsApiKey,
  validateJobsKey,
} from "@/app/job/search/lib/jobs-api";
import { Button } from "@/app/job/search/components/ui/button";
import { Input } from "@/app/job/search/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/app/job/search/components/ui/dialog";
import { ResumeLibrary } from "@/app/job/search/components/resume-library";
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
    label: "JD & Resume Assistant",
    icon: Sparkles,
    description: "Analyse JDs and resumes, chat, and generate cover letters",
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
  const [mounted, setMounted] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [apiKey, setApiKeyValue] = useState("");
  const [showApiKey, setShowApiKey] = useState(false);
  const [apiKeyError, setApiKeyError] = useState("");
  const [jobsApiKey, setJobsApiKeyValue] = useState("");
  const [showJobsApiKey, setShowJobsApiKey] = useState(false);
  const [jobsApiKeyError, setJobsApiKeyError] = useState("");
  const [jobsConfigured, setJobsConfigured] = useState(false);
  const [jobsSaveMessage, setJobsSaveMessage] = useState("");
  const [activeTab, setActiveTab] = useState<"keys" | "resumes">("keys");

  useEffect(() => {
    const id = setTimeout(() => {
      setMounted(true);
      setJobsConfigured(!!getJobsApiKey());
    }, 0);
    return () => clearTimeout(id);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    const onUpdate = () => {
      setJobsConfigured(!!getJobsApiKey());
    };
    window.addEventListener("apiKeyUpdated", onUpdate);
    return () => window.removeEventListener("apiKeyUpdated", onUpdate);
  }, [mounted]);

  const handleOpen = () => {
    setApiKeyValue("");
    setJobsApiKeyValue(getJobsApiKey() || "");
    setApiKeyError("");
    setJobsApiKeyError("");
    setJobsSaveMessage("");
    setActiveTab("keys");
    setIsOpen(true);
  };

  const handleSaveJobs = () => {
    const trimmed = jobsApiKey.trim();
    if (!trimmed) {
      removeJobsApiKey();
      setJobsApiKeyError("");
      setJobsConfigured(false);
      window.dispatchEvent(new Event("apiKeyUpdated"));
      return;
    }
    if (!validateJobsKey(trimmed)) {
      setJobsApiKeyError("Format: sk-live- followed by 40 characters");
      return;
    }
    setJobsApiKey(trimmed);
    setJobsApiKeyError("");
    setJobsConfigured(true);
    setJobsSaveMessage("Jobs API key saved in this browser.");
    setTimeout(() => setJobsSaveMessage(""), 3000);
    window.dispatchEvent(new Event("apiKeyUpdated"));
  };

  useEffect(() => {
    const openDialog = () => setIsOpen(true);
    window.addEventListener("openApiKeyDialog", openDialog);
    return () => window.removeEventListener("openApiKeyDialog", openDialog);
  }, []);

  const configuredCount = jobsConfigured ? 1 : 0;

  return (
    <>
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
            <button
              type="button"
              onClick={handleOpen}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-beige-300 bg-white px-3 py-1.5 text-sm font-medium text-stone-700 shadow-sm hover:bg-beige-50 focus:outline-none focus:ring-2 focus:ring-orange-brand/20"
            >
              <Key className="h-4 w-4 shrink-0" />
              <span className="hidden sm:inline">
                {mounted
                  ? configuredCount >= 1
                    ? "Settings: Configured"
                    : "Settings"
                  : "Settings"}
              </span>
              <span className="sm:hidden">Settings</span>
            </button>
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

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent
          className={`${activeTab === "resumes" ? "max-w-4xl" : "max-w-md"} max-h-[90vh] overflow-y-auto`}
        >
          <DialogHeader>
            <DialogTitle>Settings</DialogTitle>
            <DialogDescription>
              Keys stay in your browser. Resumes are stored in your tracker storage and linked to
              your signed-in account.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-2 rounded-lg bg-beige-100 p-1">
              <button
                type="button"
                onClick={() => setActiveTab("keys")}
                className={`inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  activeTab === "keys"
                    ? "bg-white text-stone-800 shadow-sm"
                    : "text-stone-600 hover:text-stone-800"
                }`}
              >
                <Key className="h-4 w-4" />
                API Keys
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("resumes")}
                className={`inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  activeTab === "resumes"
                    ? "bg-white text-stone-800 shadow-sm"
                    : "text-stone-600 hover:text-stone-800"
                }`}
              >
                <FileText className="h-4 w-4" />
                Resumes
              </button>
            </div>

            {activeTab === "keys" ? (
              <div className="space-y-6">
                <div className="space-y-2 border-t border-beige-300 pt-2">
                  <label className="text-sm font-medium text-stone-700">Jobs API Key</label>
                  <p className="text-xs text-stone-500">
                    Used to fetch job listings. Get a key at{" "}
                    <a
                      href="http://indianapi.in/jobs-api"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-orange-dark underline"
                    >
                      indianapi.in/jobs-api
                    </a>
                  </p>
                  <div className="relative">
                    <Input
                      type={showJobsApiKey ? "text" : "password"}
                      value={jobsApiKey}
                      onChange={(e) => {
                        setJobsApiKeyValue(e.target.value);
                        setJobsApiKeyError("");
                        setJobsSaveMessage("");
                      }}
                      placeholder="sk-live-..."
                      className={jobsApiKeyError ? "border-red-500" : ""}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-full"
                      onClick={() => setShowJobsApiKey(!showJobsApiKey)}
                    >
                      {showJobsApiKey ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  {jobsApiKeyError && <p className="text-sm text-red-600">{jobsApiKeyError}</p>}
                  {!jobsApiKeyError && jobsSaveMessage && (
                    <p className="text-sm text-green-600">{jobsSaveMessage}</p>
                  )}
                  <p className="text-xs text-stone-500">
                    Format: sk-live- followed by 40 characters.
                  </p>
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" size="sm" onClick={handleSaveJobs}>
                      {jobsApiKey.trim() ? "Save Jobs Key" : "Remove Jobs Key"}
                    </Button>
                    {getJobsApiKey() && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          removeJobsApiKey();
                          setJobsApiKeyValue("");
                          setJobsConfigured(false);
                          window.dispatchEvent(new Event("apiKeyUpdated"));
                        }}
                      >
                        Clear
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <ResumeLibrary
                compact
                title="Resume Storage"
                description="Upload, preview, and delete PDFs stored in your tracker."
              />
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
