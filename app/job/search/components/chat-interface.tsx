"use client";

import { useState, useEffect, useRef } from "react";
import { useChatStore } from "@/app/job/search/stores/chat-store";
import { useResumeStore } from "@/app/job/search/stores/resume-store";
import { useJDStore } from "@/app/job/search/stores/jd-store";
import { Button } from "@/app/job/search/components/ui/button";
import { Card, CardContent } from "@/app/job/search/components/ui/card";
import { Textarea } from "@/app/job/search/components/ui/textarea";
import { Input } from "@/app/job/search/components/ui/input";
import { Send, Copy, Trash2, FileText, Briefcase, Loader2 } from "lucide-react";
import type { Message, JobDescription } from "@/app/job/search/types";
import { useAppAuth } from "@/app/components/app-auth-provider";
import { sfn } from "@/lib/supabase-api";

interface ChatInterfaceProps {
  chatId: string;
}

export function ChatInterface({ chatId }: ChatInterfaceProps) {
  const { appFetch } = useAppAuth();
  const { currentChat, selectChat, addMessage, deleteChat } = useChatStore();
  const { resumes, loadResumes } = useResumeStore();
  const { getJD } = useJDStore();

  const [userInput, setUserInput] = useState("");
  const [extraInstructions, setExtraInstructions] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");
  const [jd, setJd] = useState<JobDescription | null>(null);
  const [resume, setResume] = useState<{ id: string; name: string } | null>(null);
  const [addToTrackerLoading, setAddToTrackerLoading] = useState(false);
  const [lastCoverLetter, setLastCoverLetter] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadResumes();
  }, [loadResumes]);

  useEffect(() => {
    selectChat(chatId);
  }, [chatId, selectChat]);

  useEffect(() => {
    if (currentChat?.jdId) {
      getJD(currentChat.jdId)
        .then((jd) => setJd(jd || null))
        .catch(() => {});
    }
  }, [currentChat?.jdId, getJD]);

  useEffect(() => {
    if (!currentChat?.resumeId) return;
    const chatResume = resumes.find((r) => r.id === currentChat.resumeId);
    if (chatResume) {
      setResume({ id: chatResume.id, name: chatResume.name });
      return;
    }
    setResume({ id: currentChat.resumeId, name: "Resume deleted" });
  }, [currentChat?.resumeId, resumes, loadResumes]);

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [currentChat?.messages, streamingContent]);

  useEffect(() => {
    if (isStreaming && messagesEndRef.current) {
      const timer = setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [isStreaming]);

  const handleSendMessage = async () => {
    if (!userInput.trim() || !currentChat) return;

    const userMessage: Omit<Message, "id" | "timestamp"> = {
      role: "user",
      content: userInput,
      extraInstructions: extraInstructions || undefined,
    };

    await addMessage(currentChat.id, userMessage);

    setUserInput("");
    setExtraInstructions("");

    setIsStreaming(true);
    setStreamingContent("");

    try {
      const chatResume = resumes.find((r) => r.id === currentChat.resumeId);
      const jdData = jd;

      if (!chatResume || !jdData) {
        alert("Resume or Job Description not found. Please try again.");
        setIsStreaming(false);
        return;
      }

      const { getApiKey } = await import("@/app/job/search/utils/api-key");
      const apiKey = getApiKey();

      if (!apiKey) {
        alert(
          'Please set your OpenAI API key first. Use "Set API Key" in the bar at the top of the app.'
        );
        setIsStreaming(false);
        return;
      }

      let retrievedResumeSections: string[] = [];
      let retrievedJDSections: string[] = [];

      try {
        const { generateQueryEmbedding, searchEmbeddings } =
          await import("@/app/job/search/utils/embeddings");

        const queryEmbedding = await generateQueryEmbedding(userInput);

        const resumeEmbeddings = await searchEmbeddings(queryEmbedding, chatResume.id, "resume", 5);
        retrievedResumeSections = resumeEmbeddings.map((e) => e.text);

        const jdEmbeddings = await searchEmbeddings(queryEmbedding, jdData.id, "jd", 5);
        retrievedJDSections = jdEmbeddings.map((e) => e.text);
      } catch (ragError) {
        retrievedResumeSections = [];
        retrievedJDSections = [];
      }

      const response = await fetch(sfn("chat"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-openai-api-key": apiKey,
        },
        body: JSON.stringify({
          resumeData: chatResume,
          jdData: jdData,
          question: userInput,
          extraInstructions: extraInstructions || undefined,
          chatHistory: currentChat.messages.slice(-10).map((msg) => ({
            role: msg.role,
            content: msg.content,
          })),
          retrievedResumeSections:
            retrievedResumeSections.length > 0 ? retrievedResumeSections : undefined,
          retrievedJDSections: retrievedJDSections.length > 0 ? retrievedJDSections : undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage =
          errorData.error || "Failed to get response. Please check your API key and try again.";
        throw new Error(errorMessage);
      }

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") {
              break;
            }
            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                fullContent += parsed.content;
                setStreamingContent(fullContent);
              }
            } catch {}
          }
        }
      }

      if (fullContent.trim()) {
        const assistantMessage: Omit<Message, "id" | "timestamp"> = {
          role: "assistant",
          content: fullContent,
        };
        await addMessage(currentChat.id, assistantMessage);
      } else {
        await addMessage(currentChat.id, {
          role: "assistant",
          content: "Sorry, I didn't receive a response. Please try again.",
        });
      }
    } catch (error) {
      await addMessage(currentChat.id, {
        role: "assistant",
        content: "Sorry, I encountered an error. Please try again.",
      });
    } finally {
      setIsStreaming(false);
      setTimeout(() => setStreamingContent(""), 100);
    }
  };

  const handleCopyMessage = (content: string) => {
    navigator.clipboard.writeText(content);
  };

  const handleDeleteChat = async () => {
    if (!currentChat) return;
    if (confirm("Are you sure you want to delete this chat? This action cannot be undone.")) {
      await deleteChat(currentChat.id);
      window.location.href = "/job/search";
    }
  };

  const handleCreateCoverLetter = async () => {
    if (!currentChat || !resume || !jd) return;

    setIsStreaming(true);
    setStreamingContent("");

    try {
      const chatResume = resumes.find((r) => r.id === currentChat.resumeId);
      if (!chatResume || !jd) {
        alert("Resume or Job Description not found. Please try again.");
        setIsStreaming(false);
        return;
      }

      const { getApiKey } = await import("@/app/job/search/utils/api-key");
      const apiKey = getApiKey();

      if (!apiKey) {
        alert(
          'Please set your OpenAI API key first. Use "Set API Key" in the bar at the top of the app.'
        );
        setIsStreaming(false);
        return;
      }

      const response = await fetch(sfn("cover-letter"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-openai-api-key": apiKey,
        },
        body: JSON.stringify({
          resumeData: chatResume,
          jdData: jd,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        const errorMessage =
          errorData.error ||
          "Failed to generate cover letter. Please check your API key and try again.";
        throw new Error(errorMessage);
      }

      if (!response.body) throw new Error("No response body");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.slice(6);
            if (data === "[DONE]") {
              break;
            }
            try {
              const parsed = JSON.parse(data);
              if (parsed.content) {
                fullContent += parsed.content;
                setStreamingContent(fullContent);
              }
            } catch {}
          }
        }
      }

      if (fullContent.trim()) {
        const coverLetterMessage: Omit<Message, "id" | "timestamp"> = {
          role: "assistant",
          content: fullContent,
        };
        await addMessage(currentChat.id, coverLetterMessage);
        setLastCoverLetter(fullContent);
      } else {
        await addMessage(currentChat.id, {
          role: "assistant",
          content: "Sorry, I didn't receive a response. Please try again.",
        });
      }
    } catch (error) {
      await addMessage(currentChat.id, {
        role: "assistant",
        content: "Sorry, I encountered an error generating the cover letter. Please try again.",
      });
    } finally {
      setIsStreaming(false);
      setTimeout(() => setStreamingContent(""), 100);
    }
  };

  const handleCopyCoverLetter = () => {
    const text = lastCoverLetter || streamingContent;
    if (!text.trim()) return;
    navigator.clipboard.writeText(text);
  };

  const handleDownloadCoverLetter = () => {
    const text = lastCoverLetter || streamingContent;
    if (!text.trim()) return;
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cover-letter.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleAddToTrackerFromJD = async () => {
    if (!currentChat || !jd) {
      alert("Job description not loaded yet. Please wait a moment and try again.");
      return;
    }

    const roleTitle = jd.extracted?.roleTitle?.trim();
    const company = jd.extracted?.company?.trim();

    if (!roleTitle || !company) {
      alert(
        "Unable to determine both job title and company from the JD. Please make sure the JD includes a clear role title and company name."
      );
      return;
    }

    setAddToTrackerLoading(true);
    try {
      try {
        const resExisting = await appFetch(sfn("jobs"));
        const dataExisting = await resExisting.json().catch(() => ({}));
        if (Array.isArray((dataExisting as { jobs?: unknown }).jobs)) {
          const existingJobs = (dataExisting as { jobs: { title: string; company: string }[] })
            .jobs;
          const key = `${roleTitle.toLowerCase()}::${company.toLowerCase()}`;
          const exists = existingJobs.some(
            (j) =>
              j.title &&
              j.company &&
              `${j.title.trim().toLowerCase()}::${j.company.trim().toLowerCase()}` === key
          );
          if (
            exists &&
            !window.confirm(
              "A job with the same title and company already exists in the tracker. Do you still want to add this job?"
            )
          ) {
            setAddToTrackerLoading(false);
            return;
          }
        }
      } catch {}

      const body = {
        title: roleTitle,
        company,
        location: "",
        role: roleTitle,
        experience: "",
        jobType: "",
        jdRaw: jd.content,
        education:
          jd.extracted?.requiredSkills && jd.extracted.requiredSkills.length
            ? jd.extracted.requiredSkills.join(", ")
            : undefined,
        source: "JD & Resume Assistant",
      };

      const res = await appFetch(sfn("jobs"), {
        method: "POST",
        body: JSON.stringify(body),
      });

      const data = await res.json().catch(() => ({}));

      if (res.status === 401) {
        alert(
          "Sign in on the main tracker page before adding jobs from the JD & Resume Assistant."
        );
        return;
      }

      if (!res.ok) {
        const message =
          (data as { error?: string; detail?: string }).error ??
          (data as { error?: string; detail?: string }).detail ??
          "Failed to add job to tracker.";
        alert(message);
        return;
      }

      alert("Job added to Job Application Tracker.");
    } catch {
      alert("Failed to add job to tracker. Please try again.");
    } finally {
      setAddToTrackerLoading(false);
    }
  };

  if (!currentChat) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Loading chat...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Fixed Header */}
      <div className="flex-shrink-0 border-b bg-card p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-2xl font-bold">{currentChat.title}</h2>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleAddToTrackerFromJD}
              disabled={addToTrackerLoading || !jd}
              className="flex items-center gap-2"
              title="Create a job entry in the main tracker from this JD"
            >
              {addToTrackerLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Briefcase className="h-4 w-4" />
              )}
              Add to job tracker
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCreateCoverLetter}
              disabled={isStreaming || !resume || !jd}
              className="flex items-center gap-2"
            >
              <FileText className="h-4 w-4" />
              Create Cover Letter
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleCopyCoverLetter}
              disabled={!lastCoverLetter && !streamingContent}
              className="flex items-center gap-1"
              title="Copy the last generated cover letter"
            >
              <Copy className="h-4 w-4" />
              Copy letter
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDownloadCoverLetter}
              disabled={!lastCoverLetter && !streamingContent}
              className="flex items-center gap-1"
              title="Download the last generated cover letter as a text file"
            >
              <FileText className="h-4 w-4" />
              Download .txt
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDeleteChat}
              className="flex items-center gap-2"
            >
              <Trash2 className="h-4 w-4" />
              Delete Chat
            </Button>
          </div>
        </div>

        {/* Context Summary */}
        <div className="flex flex-wrap gap-4 text-sm">
          <div>
            <span className="font-medium text-muted-foreground">Resume:</span>{" "}
            <span className="text-foreground">{resume?.name || "Loading..."}</span>
          </div>
          {jd?.extracted?.roleTitle && jd.extracted.roleTitle !== "Description:" && (
            <div>
              <span className="font-medium text-muted-foreground">Job:</span>{" "}
              <span className="text-foreground">{jd.extracted.roleTitle}</span>
            </div>
          )}
          {jd?.extracted?.company && (
            <div>
              <span className="font-medium text-muted-foreground">Company:</span>{" "}
              <span className="text-foreground">{jd.extracted.company}</span>
            </div>
          )}
        </div>
      </div>

      {/* Scrollable Messages Area */}
      <div className="flex-1 overflow-y-auto space-y-4 p-4 min-h-0">
        {currentChat.messages.length === 0 && !isStreaming && (
          <div className="text-center text-muted-foreground py-8">
            <p className="text-lg mb-2">Start a conversation</p>
            <p className="text-sm">Ask questions about your resume and the job description</p>
          </div>
        )}
        {currentChat.messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === "user" ? "justify-end" : "justify-start"} animate-in fade-in slide-in-from-bottom-2`}
          >
            <Card
              className={`max-w-[85%] shadow-sm ${
                message.role === "user"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-white border border-border shadow-sm"
              }`}
            >
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 whitespace-pre-wrap leading-relaxed">
                    {message.content}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`h-7 w-7 shrink-0 ${
                      message.role === "user"
                        ? "text-primary-foreground hover:bg-primary-foreground/20"
                        : ""
                    }`}
                    onClick={() => handleCopyMessage(message.content)}
                    title="Copy message"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </Button>
                </div>
                {message.extraInstructions && (
                  <div
                    className={`mt-3 text-xs ${
                      message.role === "user" ? "opacity-80" : "opacity-70"
                    }`}
                  >
                    <span className="font-medium">Extra instructions:</span>{" "}
                    {message.extraInstructions}
                  </div>
                )}
                <div
                  className={`mt-2 text-xs ${
                    message.role === "user" ? "opacity-70" : "opacity-60"
                  }`}
                >
                  {new Date(message.timestamp).toLocaleTimeString()}
                </div>
              </CardContent>
            </Card>
          </div>
        ))}

        {/* Streaming message */}
        {isStreaming && (
          <div className="flex justify-start animate-in fade-in slide-in-from-bottom-2">
            <Card className="max-w-[85%] bg-white border border-border shadow-sm">
              <CardContent className="p-4">
                <div className="whitespace-pre-wrap leading-relaxed">
                  {streamingContent || <span className="text-muted-foreground">Thinking...</span>}
                </div>
                {streamingContent && (
                  <div className="mt-2 text-xs opacity-60 flex items-center gap-1">
                    <span className="inline-block w-2 h-2 bg-primary rounded-full animate-pulse"></span>
                    Typing...
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Fixed Input Area at Bottom */}
      <div className="flex-shrink-0 border-t bg-card shadow-lg p-4">
        <div className="space-y-3 max-w-5xl mx-auto">
          <div>
            <label className="text-sm font-medium mb-1.5 block text-foreground">
              Extra Instructions (Optional)
            </label>
            <Input
              value={extraInstructions}
              onChange={(e) => setExtraInstructions(e.target.value)}
              placeholder="e.g., Keep it concise, focus on technical skills..."
              className="text-sm"
            />
          </div>
          <div className="flex gap-2">
            <Textarea
              value={userInput}
              onChange={(e) => setUserInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              placeholder="Ask a question about your resume and the job description..."
              rows={3}
              className="flex-1 resize-none"
              disabled={isStreaming}
            />
            <Button
              onClick={handleSendMessage}
              disabled={!userInput.trim() || isStreaming}
              size="icon"
              className="h-12 w-12 shrink-0"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
