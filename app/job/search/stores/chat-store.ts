import { create } from "zustand";
import type { Chat, Message, ChatCreationState } from "@/app/job/search/types";
import { db } from "@/app/job/search/lib/db";

interface ChatStore {
  chats: Chat[];
  currentChat: Chat | null;
  chatCreationState: ChatCreationState;
  isLoading: boolean;
  error: string | null;

  // Actions
  loadChats: () => Promise<void>;
  createChat: (resumeId: string, jdId: string, title?: string) => Promise<string>;
  selectChat: (id: string) => Promise<void>;
  addMessage: (chatId: string, message: Omit<Message, "id" | "timestamp">) => Promise<void>;
  updateMessage: (chatId: string, messageId: string, updates: Partial<Message>) => Promise<void>;
  duplicateChat: (id: string) => Promise<string>;
  deleteChat: (id: string) => Promise<void>;
  setChatCreationState: (state: Partial<ChatCreationState>) => void;
  resetChatCreation: () => void;
}

export const useChatStore = create<ChatStore>((set, get) => ({
  chats: [],
  currentChat: null,
  chatCreationState: {
    selectedResumeId: null,
    jdText: "",
    isConfirmed: false,
  },
  isLoading: false,
  error: null,

  loadChats: async () => {
    set({ isLoading: true, error: null });
    try {
      const chats = await db.chats.toArray();
      // Load messages for each chat
      const chatsWithMessages = await Promise.all(
        chats.map(async (chat) => {
          const messages = await db.messages.where("chatId").equals(chat.id).sortBy("timestamp");
          return { ...chat, messages };
        })
      );
      set({ chats: chatsWithMessages, isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "Failed to load chats",
        isLoading: false,
      });
    }
  },

  createChat: async (resumeId, jdId, title) => {
    const id = crypto.randomUUID();
    const now = new Date();
    const chat: Chat = {
      id,
      resumeId,
      jdId,
      title: title || `Chat ${now.toLocaleDateString()}`,
      messages: [],
      createdAt: now,
      updatedAt: now,
    };

    await db.chats.add(chat);
    await get().loadChats();
    return id;
  },

  selectChat: async (id) => {
    const chat = await db.chats.get(id);
    if (chat) {
      const messages = await db.messages.where("chatId").equals(id).sortBy("timestamp");
      set({ currentChat: { ...chat, messages } });
    }
  },

  addMessage: async (chatId, messageData) => {
    const message: Message = {
      ...messageData,
      id: crypto.randomUUID(),
      timestamp: new Date(),
      chatId, // Store chatId with message for proper indexing and persistence
    };

    await db.messages.add(message);
    await db.chats.update(chatId, { updatedAt: new Date() });
    await get().selectChat(chatId);
  },

  updateMessage: async (chatId, messageId, updates) => {
    await db.messages.update(messageId, updates);
    await get().selectChat(chatId);
  },

  duplicateChat: async (id) => {
    const originalChat = await db.chats.get(id);
    if (!originalChat) throw new Error("Chat not found");

    const messages = await db.messages.where("chatId").equals(id).sortBy("timestamp");

    const newId = crypto.randomUUID();
    const now = new Date();
    const newChat: Chat = {
      ...originalChat,
      id: newId,
      title: `${originalChat.title} (Copy)`,
      messages: [],
      createdAt: now,
      updatedAt: now,
    };

    await db.chats.add(newChat);

    // Duplicate messages
    for (const msg of messages) {
      await db.messages.add({
        ...msg,
        id: crypto.randomUUID(),
        chatId: newId, // Update chatId for duplicated messages
        timestamp: new Date(),
      });
    }

    await get().loadChats();
    return newId;
  },

  deleteChat: async (id) => {
    // Delete all messages first
    await db.messages.where("chatId").equals(id).delete();
    await db.chats.delete(id);
    await get().loadChats();
    if (get().currentChat?.id === id) {
      set({ currentChat: null });
    }
  },

  setChatCreationState: (state) => {
    set((prev) => ({
      chatCreationState: { ...prev.chatCreationState, ...state },
    }));
  },

  resetChatCreation: () => {
    set({
      chatCreationState: {
        selectedResumeId: null,
        jdText: "",
        isConfirmed: false,
      },
    });
  },
}));
