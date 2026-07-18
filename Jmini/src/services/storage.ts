import { invoke } from "@tauri-apps/api/core";

export interface Conversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface StoredMessage {
  id: number;
  conversation_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
}

export interface Memory {
  id: number;
  kind: string;
  content: string;
  importance: number;
  confidence: number;
  created_at: string;
  updated_at: string;
}

export function createConversation(title?: string) {
  return invoke<Conversation>("create_conversation", { title });
}

export function listConversations() {
  return invoke<Conversation[]>("list_conversations");
}

export function getMessages(conversationId: string) {
  return invoke<StoredMessage[]>("get_messages", { conversationId });
}

export function saveMessage(conversationId: string, role: StoredMessage["role"], content: string) {
  return invoke<StoredMessage>("save_message", {
    conversationId,
    role,
    content,
  });
}

export function deleteConversation(conversationId: string) {
  return invoke("delete_conversation", { conversationId });
}

export function renameConversation(conversationId: string, title: string) {
  return invoke("rename_conversation", { conversationId, title });
}

export function listMemories() {
  return invoke<Memory[]>("list_memories");
}

export function deleteMemory(memoryId: number) {
  return invoke("delete_memory", { memoryId });
}

export function saveMemory(
  kind: string,
  content: string,
  importance = 3,
  confidence = 0.7,
  embedding?: number[],
) {
  return invoke<Memory>("save_memory", {
    kind,
    content,
    importance,
    confidence,
    embedding,
  });
}

export function searchMemories(query: string, queryEmbedding?: number[], limit = 6) {
  return invoke<Memory[]>("search_memories", {
    query,
    queryEmbedding,
    limit,
  });
}
