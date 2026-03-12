"use client";

import { useState, useEffect } from "react";
import { ResumeManager } from "@/app/job/search/components/resume-manager";
import { ChatCreationFlow } from "@/app/job/search/components/chat-creation-flow";
import { useChatStore } from "@/app/job/search/stores/chat-store";
import { JobSearchSubNav } from "@/app/job/search/components/job-search-nav";
import { Button } from "@/app/job/search/components/ui/button";
import { Card, CardContent } from "@/app/job/search/components/ui/card";
import { Copy, Trash2 } from "lucide-react";
import Link from "next/link";

type View = "resumes" | "create-chat" | "chats";

export default function Home() {
  const [currentView, setCurrentView] = useState<View>("resumes");
  const { chats, loadChats, duplicateChat, deleteChat } = useChatStore();

  useEffect(() => {
    loadChats();
  }, [loadChats]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="container mx-auto px-4 py-6 max-w-6xl">
        <JobSearchSubNav currentView={currentView} onViewChange={setCurrentView} />

        {/* Main Content */}
        <main>
          {currentView === "resumes" && <ResumeManager />}
          {currentView === "create-chat" && <ChatCreationFlow />}
          {currentView === "chats" && (
            <div className="space-y-4">
              {chats.length === 0 ? (
                <Card>
                  <CardContent className="pt-6">
                    <p className="text-center text-muted-foreground">
                      No chats yet. Create a new chat to get started.
                    </p>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                  {chats.map((chat) => (
                    <Card key={chat.id} className="hover:shadow-md transition-shadow">
                      <CardContent className="p-6">
                        <div className="flex items-start justify-between mb-2">
                          <Link href={`/job/search/chat/${chat.id}`} className="flex-1">
                            <h3 className="font-semibold hover:text-primary transition-colors">
                              {chat.title}
                            </h3>
                          </Link>
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={async (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                try {
                                  const newChatId = await duplicateChat(chat.id);
                                  await loadChats();
                                  window.location.href = `/job/search/chat/${newChatId}`;
                                } catch (error) {}
                              }}
                              title="Duplicate chat"
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={async (e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (
                                  confirm(
                                    "Are you sure you want to delete this chat? This action cannot be undone."
                                  )
                                ) {
                                  try {
                                    await deleteChat(chat.id);
                                    await loadChats();
                                  } catch (error) {}
                                }
                              }}
                              title="Delete chat"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                        <Link href={`/job/search/chat/${chat.id}`}>
                          <p className="text-sm text-muted-foreground">
                            {chat.messages.length}{" "}
                            {chat.messages.length === 1 ? "message" : "messages"}
                          </p>
                          <p className="text-xs text-muted-foreground mt-2">
                            Updated {new Date(chat.updatedAt).toLocaleDateString()}
                          </p>
                        </Link>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
