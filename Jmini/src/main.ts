import { extractMemories, findRelevantMemories, remember } from "./services/memory";
import { sendMessage, type ModelMessage } from "./services/llama";
import {
  createConversation,
  deleteMemory,
  getMessages,
  listConversations,
  listMemories,
  saveMessage,
  type Conversation,
  type Memory,
} from "./services/storage";

let activeConversation: Conversation;
let conversationMessages: ModelMessage[] = [];

function createMessageElement(message: ModelMessage): HTMLElement {
  const row = document.createElement("article");
  row.className = `message-row ${message.role}`;
  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.textContent = message.role === "user" ? "You" : "J";
  const content = document.createElement("div");
  content.className = "message-content";
  content.textContent = typeof message.content === "string" ? message.content : "Image attachment";
  row.append(avatar, content);
  return row;
}

function renderConversation(messagesElement: HTMLElement, emptyState: HTMLElement) {
  emptyState.hidden = conversationMessages.length > 0;
  messagesElement.querySelectorAll(".message-row").forEach((message) => message.remove());
  for (const message of conversationMessages) {
    messagesElement.append(createMessageElement(message));
  }
  messagesElement.scrollTop = messagesElement.scrollHeight;
}

function renderConversationList(listElement: HTMLElement, conversations: Conversation[]) {
  listElement.replaceChildren();
  for (const conversation of conversations) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `conversation-item${conversation.id === activeConversation.id ? " active" : ""}`;
    button.dataset.conversationId = conversation.id;
    button.textContent = conversation.title;
    listElement.append(button);
  }
}

function renderMemories(listElement: HTMLElement, memories: Memory[]) {
  listElement.replaceChildren();
  if (memories.length === 0) {
    const empty = document.createElement("p");
    empty.className = "memory-empty";
    empty.textContent = "No memories saved yet.";
    listElement.append(empty);
    return;
  }
  for (const memory of memories) {
    const item = document.createElement("article");
    item.className = "memory-item";
    const content = document.createElement("div");
    content.textContent = memory.content;
    const meta = document.createElement("small");
    meta.textContent = `${memory.kind} · confidence ${Math.round(memory.confidence * 100)}%`;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "memory-remove";
    remove.textContent = "Remove";
    remove.addEventListener("click", async () => {
      await deleteMemory(memory.id);
      renderMemories(listElement, await listMemories());
    });
    item.append(content, meta, remove);
    listElement.append(item);
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  const form = document.querySelector<HTMLFormElement>("#chat-form");
  const input = document.querySelector<HTMLTextAreaElement>("#chat-input");
  const sendButton = document.querySelector<HTMLButtonElement>("#send-button");
  const imageButton = document.querySelector<HTMLButtonElement>("#image-button");
  const imageInput = document.querySelector<HTMLInputElement>("#image-input");
  const attachmentStatus = document.querySelector<HTMLElement>("#attachment-status");
  const newChatButton = document.querySelector<HTMLButtonElement>("#new-chat-button");
  const messagesElement = document.querySelector<HTMLElement>("#messages");
  const emptyState = document.querySelector<HTMLElement>("#empty-state");
  const serverStatus = document.querySelector<HTMLElement>("#server-status");
  const conversationList = document.querySelector<HTMLElement>("#conversation-list");
  const memoryButton = document.querySelector<HTMLButtonElement>("#memory-button");
  const memoryDialog = document.querySelector<HTMLDialogElement>("#memory-dialog");
  const memoryClose = document.querySelector<HTMLButtonElement>("#memory-close");
  const memoryList = document.querySelector<HTMLElement>("#memory-list");
  const memoryForm = document.querySelector<HTMLFormElement>("#memory-form");
  const memoryInput = document.querySelector<HTMLInputElement>("#memory-input");

  if (!form || !input || !sendButton || !imageButton || !imageInput || !attachmentStatus || !newChatButton || !messagesElement || !emptyState || !serverStatus || !conversationList || !memoryButton || !memoryDialog || !memoryClose || !memoryList || !memoryForm || !memoryInput) {
    throw new Error("Chat interface could not be initialized");
  }

  let pendingImage: { name: string; dataUrl: string } | undefined;

  const refreshConversations = async () => renderConversationList(conversationList, await listConversations());
  const openConversation = async (conversation: Conversation) => {
    activeConversation = conversation;
    const storedMessages = await getMessages(conversation.id);
    conversationMessages = storedMessages.map(({ role, content }) => ({ role, content }));
    renderConversation(messagesElement, emptyState);
    await refreshConversations();
    serverStatus.textContent = "Conversation loaded locally";
  };

  const conversations = await listConversations();
  activeConversation = conversations[0] ?? await createConversation();
  await openConversation(activeConversation);

  const resizeInput = () => {
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
  };
  input.addEventListener("input", resizeInput);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });

  imageButton.addEventListener("click", () => imageInput.click());
  imageInput.addEventListener("change", () => {
    const file = imageInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      pendingImage = { name: file.name, dataUrl: reader.result as string };
      attachmentStatus.hidden = false;
      attachmentStatus.textContent = `Attached: ${file.name}`;
    };
    reader.readAsDataURL(file);
  });

  newChatButton.addEventListener("click", async () => {
    await openConversation(await createConversation());
    input.focus();
  });

  conversationList.addEventListener("click", async (event) => {
    const target = event.target as HTMLElement;
    const id = target.closest<HTMLButtonElement>(".conversation-item")?.dataset.conversationId;
    if (!id) return;
    const selected = (await listConversations()).find((conversation) => conversation.id === id);
    if (selected) await openConversation(selected);
  });

  memoryButton.addEventListener("click", async () => {
    renderMemories(memoryList, await listMemories());
    memoryDialog.showModal();
  });
  memoryClose.addEventListener("click", () => memoryDialog.close());
  memoryForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const content = memoryInput.value.trim();
    if (!content) return;
    await remember(content, "fact", 3, 1);
    memoryInput.value = "";
    renderMemories(memoryList, await listMemories());
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = input.value.trim();
    if ((!message && !pendingImage) || sendButton.disabled) return;

    const imageForRequest = pendingImage?.dataUrl;
    const messageForStorage = pendingImage ? `${message || "Describe this image"} [Image: ${pendingImage.name}]` : message;

    const history = [...conversationMessages];
    conversationMessages.push({ role: "user", content: messageForStorage });
    await saveMessage(activeConversation.id, "user", messageForStorage);
    input.value = "";
    pendingImage = undefined;
    imageInput.value = "";
    attachmentStatus.hidden = true;
    resizeInput();
    renderConversation(messagesElement, emptyState);
    sendButton.disabled = true;
    input.disabled = true;
    serverStatus.textContent = "Searching local memory…";

    try {
      const memories = await findRelevantMemories(messageForStorage);
      serverStatus.textContent = "Jmini is thinking…";
      const answer = await sendMessage(message || "Describe this image", history, memories.map((memory) => memory.content), imageForRequest);
      conversationMessages.push({ role: "assistant", content: answer });
      await saveMessage(activeConversation.id, "assistant", answer);
      void extractMemories(message, answer).catch(() => undefined);
      serverStatus.textContent = "Connected to local model";
      await refreshConversations();
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown error";
      const errorMessage = `I couldn't reach the local model server. ${detail}`;
      conversationMessages.push({ role: "assistant", content: errorMessage });
      await saveMessage(activeConversation.id, "assistant", errorMessage);
      serverStatus.textContent = "Local model unavailable";
    } finally {
      sendButton.disabled = false;
      input.disabled = false;
      renderConversation(messagesElement, emptyState);
      input.focus();
    }
  });

  input.focus();
});
