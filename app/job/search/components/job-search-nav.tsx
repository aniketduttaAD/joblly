"use client";

import { FileText, MessageSquare, Plus } from "lucide-react";
import { Button } from "@/app/job/search/components/ui/button";
import { useChatStore } from "@/app/job/search/stores/chat-store";

export function JobSearchSubNav({
  currentView,
  onViewChange,
}: {
  currentView: "resumes" | "create-chat" | "chats";
  onViewChange: (view: "resumes" | "create-chat" | "chats") => void;
}) {
  const { chats } = useChatStore();

  return (
    <nav className="mb-6 flex gap-2 border-b border-border pb-4">
      <Button
        variant={currentView === "resumes" ? "default" : "ghost"}
        size="sm"
        onClick={() => onViewChange("resumes")}
      >
        <FileText className="mr-2 h-4 w-4" />
        Resumes
      </Button>
      <Button
        variant={currentView === "create-chat" ? "default" : "ghost"}
        size="sm"
        onClick={() => onViewChange("create-chat")}
      >
        <Plus className="mr-2 h-4 w-4" />
        New Chat
      </Button>
      <Button
        variant={currentView === "chats" ? "default" : "ghost"}
        size="sm"
        onClick={() => onViewChange("chats")}
      >
        <MessageSquare className="mr-2 h-4 w-4" />
        Chats ({chats.length})
      </Button>
    </nav>
  );
}
