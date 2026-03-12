"use client";

import { use } from "react";
import { ChatInterface } from "@/app/job/search/components/chat-interface";

export default function ChatPage({ params }: { params: Promise<{ chatId: string }> }) {
  const { chatId } = use(params);

  return (
    <div className="min-h-screen bg-background">
      <div className="h-screen flex flex-col">
        <div className="flex-1 min-h-0 px-4 pb-4">
          <ChatInterface chatId={chatId} />
        </div>
      </div>
    </div>
  );
}
