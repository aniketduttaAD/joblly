"use client";

import { useState, useEffect } from "react";
import { useResumeStore } from "@/app/job/search/stores/resume-store";
import { useChatStore } from "@/app/job/search/stores/chat-store";
import { useJDStore } from "@/app/job/search/stores/jd-store";
import { Button } from "@/app/job/search/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/app/job/search/components/ui/card";
import { Textarea } from "@/app/job/search/components/ui/textarea";
import { Check, AlertCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { hasApiKey } from "@/app/job/search/utils/api-key";

export function ChatCreationFlow() {
  const router = useRouter();
  const { resumes, selectedResumeId, selectResume, getSelectedResume } = useResumeStore();
  const { setChatCreationState, createChat, resetChatCreation } = useChatStore();
  const { addJD } = useJDStore();

  const [jdText, setJdText] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [apiKeyExists, setApiKeyExists] = useState(false);

  useEffect(() => {
    setChatCreationState({ jdText });
    setApiKeyExists(hasApiKey());
    const handleStorageChange = () => {
      setApiKeyExists(hasApiKey());
    };
    window.addEventListener("storage", handleStorageChange);

    window.addEventListener("apiKeyUpdated", handleStorageChange);

    return () => {
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("apiKeyUpdated", handleStorageChange);
    };
  }, [jdText, setChatCreationState]);

  const selectedResume = getSelectedResume();
  const canCreateChat = selectedResume?.isVerified && jdText.trim().length > 0 && apiKeyExists;

  const handleCreateChat = async () => {
    if (!canCreateChat || !selectedResumeId) return;

    if (!hasApiKey()) {
      alert(
        'Please set your OpenAI API key first. Use "Set API Key" in the bar at the top of the app.'
      );
      return;
    }

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

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold mb-2">Create New Chat</h2>
        <p className="text-muted-foreground">
          Select a verified resume and provide a job description to start a new chat session.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Step 1: Select Resume</CardTitle>
          <CardDescription>Choose a verified resume to use for this chat session.</CardDescription>
        </CardHeader>
        <CardContent>
          {resumes.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <p>No resumes available. Please upload and verify a resume first.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {resumes
                .filter((r) => r.isVerified)
                .map((resume) => (
                  <Card
                    key={resume.id}
                    className={`cursor-pointer transition-colors ${
                      selectedResumeId === resume.id
                        ? "ring-2 ring-primary bg-primary/5"
                        : "hover:bg-accent"
                    }`}
                    onClick={() => selectResume(resume.id)}
                  >
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="font-semibold">{resume.name}</h3>
                          <p className="text-sm text-muted-foreground">
                            {resume.parsedContent.skills.length} skills •{" "}
                            {resume.parsedContent.experience.length} experiences
                          </p>
                        </div>
                        {selectedResumeId === resume.id && (
                          <Check className="h-5 w-5 text-primary" />
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              {resumes.filter((r) => r.isVerified).length === 0 && (
                <div className="text-center py-8">
                  <AlertCircle className="h-12 w-12 mx-auto text-yellow-500 mb-2" />
                  <p className="text-muted-foreground">
                    No verified resumes. Please verify a resume first.
                  </p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Step 2: Provide Job Description</CardTitle>
          <CardDescription>Paste the complete job description for this position.</CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={jdText}
            onChange={(e) => setJdText(e.target.value)}
            placeholder="Paste the job description here..."
            rows={12}
            className="font-mono text-sm"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Step 3: Confirm & Create</CardTitle>
          <CardDescription>Review your selections and create the chat session.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              {selectedResume ? (
                <Check className="h-4 w-4 text-green-600" />
              ) : (
                <AlertCircle className="h-4 w-4 text-yellow-600" />
              )}
              <span className="text-sm">Resume: {selectedResume?.name || "Not selected"}</span>
            </div>
            <div className="flex items-center gap-2">
              {jdText.trim().length > 0 ? (
                <Check className="h-4 w-4 text-green-600" />
              ) : (
                <AlertCircle className="h-4 w-4 text-yellow-600" />
              )}
              <span className="text-sm">
                Job Description: {jdText.trim().length > 0 ? "Provided" : "Not provided"}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {apiKeyExists ? (
                <Check className="h-4 w-4 text-green-600" />
              ) : (
                <AlertCircle className="h-4 w-4 text-yellow-600" />
              )}
              <span className="text-sm">API Key: {apiKeyExists ? "Set" : "Not set"}</span>
            </div>
          </div>

          <Button
            onClick={handleCreateChat}
            disabled={!canCreateChat || isCreating}
            className="w-full"
            size="lg"
          >
            {isCreating ? "Creating..." : "Create Chat Session"}
          </Button>

          {!canCreateChat && (
            <div className="space-y-2">
              {!apiKeyExists && (
                <div className="flex items-center gap-2 text-sm text-yellow-600 p-2 bg-yellow-50 rounded">
                  <AlertCircle className="h-4 w-4" />
                  <span>Set your API key in the bar at the top of the app to create a chat.</span>
                </div>
              )}
              <p className="text-sm text-muted-foreground text-center">
                {!apiKeyExists
                  ? "Set your API key (top bar), select a verified resume, and provide a job description to continue."
                  : "Please select a verified resume and provide a job description to continue."}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
