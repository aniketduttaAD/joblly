"use client";

import { useState, useEffect } from "react";
import { useResumeStore } from "@/app/job/search/stores/resume-store";
import { useChatStore } from "@/app/job/search/stores/chat-store";
import { useJDStore } from "@/app/job/search/stores/jd-store";
import { Button } from "@/app/job/search/components/ui/button";
import { useRouter } from "next/navigation";
import { FileText, Loader2 } from "lucide-react";

interface ChatCreationFlowProps {
  initialJdText?: string;
}

export function ChatCreationFlow({ initialJdText }: ChatCreationFlowProps) {
  const router = useRouter();
  const { resumes, selectedResumeId, selectResume, getSelectedResume, loadResumes, isLoading } =
    useResumeStore();
  const { setChatCreationState, createChat, resetChatCreation } = useChatStore();
  const { addJD } = useJDStore();

  const [jdText, setJdText] = useState(initialJdText ?? "");
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    loadResumes(true);
  }, [loadResumes]);

  useEffect(() => {
    if (initialJdText !== undefined) setJdText(initialJdText);
  }, [initialJdText]);

  useEffect(() => {
    if (resumes.length > 0 && !selectedResumeId) {
      selectResume(resumes[0].id);
    }
  }, [resumes, selectedResumeId, selectResume]);

  useEffect(() => {
    setChatCreationState({ jdText });
  }, [jdText, setChatCreationState]);

  const selectedResume = getSelectedResume();
  const canCreateChat = !!selectedResume && jdText.trim().length > 0;

  const handleCreateChat = async () => {
    if (!canCreateChat || !selectedResumeId) return;

    setIsCreating(true);
    try {
      const { extractJDInfo } = await import("@/app/job/search/utils/jd-extractor");
      const extracted = await extractJDInfo(jdText);

      const tempChatId = "temp-" + crypto.randomUUID();
      const jdId = await addJD({
        chatId: tempChatId,
        content: jdText,
        extracted,
      });

      const chatId = await createChat(selectedResumeId, jdId);

      const jdStore = useJDStore.getState();
      await jdStore.updateJD(jdId, { chatId });

      router.push(`/job/search/chat/${chatId}`);
      resetChatCreation();
    } catch (error) {
    } finally {
      setIsCreating(false);
    }
  };

  const goToSearch = () => {
    router.push("/job/search");
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-2">
        <Loader2 className="h-8 w-8 animate-spin text-stone-400" />
        <p className="text-sm text-stone-500">Loading resumes…</p>
      </div>
    );
  }

  if (resumes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-4 text-center">
        <FileText className="h-12 w-12 text-stone-300" />
        <p className="text-sm text-stone-600">No resumes yet.</p>
        <p className="text-xs text-stone-500">Add a resume in Job Search to start a chat.</p>
        <Button onClick={goToSearch} variant="default">
          Go to Job Search
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs font-medium text-stone-500 uppercase tracking-wide block mb-1.5">
          Resume
        </label>
        <select
          value={selectedResumeId ?? ""}
          onChange={(e) => selectResume(e.target.value || null)}
          className="w-full h-10 rounded-lg border border-beige-300 bg-white px-3 text-sm text-stone-800 focus:border-orange-brand focus:outline-none focus:ring-2 focus:ring-orange-brand/20"
        >
          {resumes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name}
            </option>
          ))}
        </select>
        {selectedResume && (
          <p className="mt-1.5 text-xs text-stone-500">
            {selectedResume.parsedContent.skills.length} skills ·{" "}
            {selectedResume.parsedContent.experience.length} experiences
            {selectedResume.updatedAt && (
              <> · Updated {selectedResume.updatedAt.toLocaleDateString()}</>
            )}
          </p>
        )}
      </div>

      <div>
        <label className="text-xs font-medium text-stone-500 uppercase tracking-wide block mb-1.5">
          Job description
        </label>
        <textarea
          value={jdText}
          onChange={(e) => setJdText(e.target.value)}
          placeholder="Paste the job description here..."
          rows={14}
          className="w-full rounded-lg border border-beige-300 bg-stone-50/80 px-3 py-2.5 font-mono text-sm text-stone-800 placeholder-stone-400 focus:border-orange-brand focus:outline-none focus:ring-2 focus:ring-orange-brand/20 resize-y min-h-[200px] leading-relaxed"
          spellCheck={false}
        />
      </div>

      <Button
        onClick={handleCreateChat}
        disabled={!canCreateChat || isCreating}
        className="w-full"
        size="lg"
      >
        {isCreating ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Creating…
          </>
        ) : (
          "Create chat"
        )}
      </Button>
    </div>
  );
}
