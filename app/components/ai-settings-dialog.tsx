"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/app/job/search/components/ui/dialog";
import { Button } from "@/app/job/search/components/ui/button";
import { fetchWithAuth } from "@/lib/auth-client";
import { sfn } from "@/lib/supabase-api";
import { cn } from "@/app/job/search/lib/utils";
import { GEMINI_CHAT_MODEL, OPENAI_CHAT_MODEL } from "@/lib/ai-chat-models";

type AiProvider = "openai" | "gemini";

type AiSettingsGet = {
  useSystemAi: boolean;
  provider: AiProvider;
  hasOpenAiKey: boolean;
  hasGeminiKey: boolean;
  encryptionConfigured: boolean;
};

type AiSettingsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function AiSettingsDialog({ open, onOpenChange }: AiSettingsDialogProps) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [useSystemAi, setUseSystemAi] = useState(true);
  const [provider, setProvider] = useState<AiProvider>("openai");
  const [encryptionConfigured, setEncryptionConfigured] = useState(true);
  const [hasOpenAiKey, setHasOpenAiKey] = useState(false);
  const [hasGeminiKey, setHasGeminiKey] = useState(false);
  const [openaiInput, setOpenaiInput] = useState("");
  const [geminiInput, setGeminiInput] = useState("");
  const [openaiDirty, setOpenaiDirty] = useState(false);
  const [geminiDirty, setGeminiDirty] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetchWithAuth(sfn("ai-settings"), { cache: "no-store" });
      const data = (await res.json().catch(() => ({}))) as AiSettingsGet & { error?: string };
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Could not load settings.");
        return;
      }
      setUseSystemAi(Boolean(data.useSystemAi));
      setProvider(data.provider === "gemini" ? "gemini" : "openai");
      setHasOpenAiKey(Boolean(data.hasOpenAiKey));
      setHasGeminiKey(Boolean(data.hasGeminiKey));
      setEncryptionConfigured(data.encryptionConfigured !== false);
      setOpenaiInput("");
      setGeminiInput("");
      setOpenaiDirty(false);
      setGeminiDirty(false);
    } catch {
      setError("Could not load settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const body: Record<string, unknown> = { useSystemAi, provider };
      if (!useSystemAi) {
        if (openaiDirty) body.openaiKey = openaiInput.trim();
        if (geminiDirty) body.geminiKey = geminiInput.trim();
      }
      const res = await fetchWithAuth(sfn("ai-settings"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : "Save failed.");
        return;
      }
      onOpenChange(false);
    } catch {
      setError("Save failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "left-0 right-0 top-auto bottom-0 max-h-[min(92vh,800px)] w-full max-w-full translate-x-0 translate-y-0 gap-0 overflow-y-auto rounded-t-2xl rounded-b-none border-x-0 border-b-0 border-beige-300 bg-beige-50 p-0 text-stone-800 shadow-xl",
          "data-[state=open]:slide-in-from-bottom-8 data-[state=closed]:slide-out-to-bottom-8",
          "md:left-[50%] md:right-auto md:top-[50%] md:bottom-auto md:max-h-[85vh] md:w-full md:max-w-lg md:translate-x-[-50%] md:translate-y-[-50%] md:rounded-2xl md:border md:border-beige-300 md:p-0 md:data-[state=open]:slide-in-from-left-1/2 md:data-[state=open]:slide-in-from-top-[48%] md:data-[state=closed]:slide-out-to-left-1/2 md:data-[state=closed]:slide-out-to-top-[48%]"
        )}
      >
        <div className="border-b border-beige-300 px-6 py-4">
          <DialogHeader>
            <DialogTitle className="text-stone-800">AI settings</DialogTitle>
            <DialogDescription className="text-stone-600">
              Choose OpenAI or Gemini, and either the app&apos;s server keys or your own (stored
              encrypted in an HttpOnly cookie).
            </DialogDescription>
            <p className="mt-3 rounded-lg border border-beige-300 bg-white/90 px-3 py-2 text-xs leading-relaxed text-stone-600">
              <span className="font-medium text-stone-700">
                Job chat models (fixed, not changeable):
              </span>{" "}
              with OpenAI the app uses{" "}
              <code className="rounded bg-beige-200 px-1">{OPENAI_CHAT_MODEL}</code>; with Gemini it
              uses <code className="rounded bg-beige-200 px-1">{GEMINI_CHAT_MODEL}</code>. Other AI
              features (parse, cover letter, etc.) may use different models.
            </p>
          </DialogHeader>
        </div>

        <div className="space-y-6 px-6 py-5">
          {error ? (
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          ) : null}

          {loading ? (
            <p className="text-sm text-stone-500">Loading…</p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-4 rounded-xl border border-beige-300 bg-white px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-stone-800">Use app server keys</p>
                  <p className="text-xs text-stone-500">
                    When off, requests use keys you provide (BYOK).
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={useSystemAi}
                  onClick={() => {
                    setUseSystemAi((v) => !v);
                    setOpenaiDirty(false);
                    setGeminiDirty(false);
                    setOpenaiInput("");
                    setGeminiInput("");
                  }}
                  className={cn(
                    "relative h-9 w-16 shrink-0 rounded-full border transition-colors",
                    useSystemAi
                      ? "border-orange-brand bg-orange-brand"
                      : "border-beige-400 bg-beige-200"
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-1 h-7 w-7 rounded-full bg-white shadow transition-transform",
                      useSystemAi ? "left-8 translate-x-0" : "left-1"
                    )}
                  />
                </button>
              </div>

              <div>
                <p className="mb-2 text-sm font-medium text-stone-800">Provider</p>
                <div className="relative flex rounded-xl border border-beige-300 bg-beige-100/80 p-1">
                  <span
                    className={cn(
                      "pointer-events-none absolute inset-y-1 left-1 w-[calc(50%-6px)] rounded-lg bg-white shadow-sm transition-transform duration-200 ease-out",
                      provider === "gemini" && "translate-x-[calc(100%+12px)]"
                    )}
                  />
                  <button
                    type="button"
                    onClick={() => setProvider("openai")}
                    className={cn(
                      "relative z-10 flex-1 rounded-lg py-2.5 text-sm font-medium transition-colors",
                      provider === "openai"
                        ? "text-stone-900"
                        : "text-stone-500 hover:text-stone-700"
                    )}
                  >
                    OpenAI
                  </button>
                  <button
                    type="button"
                    onClick={() => setProvider("gemini")}
                    className={cn(
                      "relative z-10 flex-1 rounded-lg py-2.5 text-sm font-medium transition-colors",
                      provider === "gemini"
                        ? "text-stone-900"
                        : "text-stone-500 hover:text-stone-700"
                    )}
                  >
                    Gemini
                  </button>
                </div>
              </div>

              {!useSystemAi ? (
                <div className="space-y-4">
                  {!encryptionConfigured ? (
                    <p className="text-sm text-amber-800">
                      Personal keys cannot be stored until the server sets{" "}
                      <code className="rounded bg-beige-200 px-1">AI_COOKIE_SECRET</code>.
                    </p>
                  ) : null}
                  <div>
                    <label
                      className="mb-1 block text-xs font-medium text-stone-600"
                      htmlFor="ai-openai-key"
                    >
                      OpenAI API key
                      {hasOpenAiKey && !openaiDirty ? (
                        <span className="ml-2 text-stone-400">(saved — type to replace)</span>
                      ) : null}
                    </label>
                    <input
                      id="ai-openai-key"
                      type="password"
                      autoComplete="off"
                      value={openaiInput}
                      onChange={(e) => {
                        setOpenaiInput(e.target.value);
                        setOpenaiDirty(true);
                      }}
                      className="w-full rounded-lg border border-beige-300 bg-white px-3 py-2 text-sm text-stone-800 outline-none ring-orange-brand/20 focus:ring-2"
                      placeholder="sk-…"
                    />
                  </div>
                  <div>
                    <label
                      className="mb-1 block text-xs font-medium text-stone-600"
                      htmlFor="ai-gemini-key"
                    >
                      Gemini API key
                      {hasGeminiKey && !geminiDirty ? (
                        <span className="ml-2 text-stone-400">(saved — type to replace)</span>
                      ) : null}
                    </label>
                    <input
                      id="ai-gemini-key"
                      type="password"
                      autoComplete="off"
                      value={geminiInput}
                      onChange={(e) => {
                        setGeminiInput(e.target.value);
                        setGeminiDirty(true);
                      }}
                      className="w-full rounded-lg border border-beige-300 bg-white px-3 py-2 text-sm text-stone-800 outline-none ring-orange-brand/20 focus:ring-2"
                      placeholder="AIza…"
                    />
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>

        <DialogFooter className="border-t border-beige-300 bg-beige-100/80 px-6 py-4 sm:justify-end">
          <Button
            type="button"
            variant="outline"
            className="border-beige-300"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            className="bg-orange-brand text-white hover:bg-orange-brand/90"
            disabled={saving || loading}
            onClick={() => void handleSave()}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
