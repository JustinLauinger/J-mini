const LLAMA_URL = "http://127.0.0.1:8080";
const VISION_URL = "http://127.0.0.1:8082";

export type MessageContent = string | Array<TextContentPart | ImageContentPart>;

interface TextContentPart {
  type: "text";
  text: string;
}

interface ImageContentPart {
  type: "image_url";
  image_url: { url: string };
}

export interface ModelMessage {
  role: "system" | "user" | "assistant";
  content: MessageContent;
}

interface ChatCompletionResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

export async function sendMessage(message: string, history: ModelMessage[] = [], memories: string[] = [], imageDataUrl?: string): Promise<string> {
  const memoryContext = memories.length > 0
    ? `\nRelevant local memories:\n${memories.map((memory) => `- ${memory}`).join("\n")}`
    : "";
  const requestContent: MessageContent = imageDataUrl
    ? [
        { type: "text", text: message },
        { type: "image_url", image_url: { url: imageDataUrl } },
      ]
    : message;
  const response = await fetch(`${imageDataUrl ? VISION_URL : LLAMA_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages: [
        { role: "system", content: `You are Jmini, Justin Lauinger's helpful personal assistant. Use relevant memories naturally, but do not mention the memory system unless asked.${memoryContext}` },
        ...history,
        { role: "user", content: requestContent },
      ],
      temperature: 0.7,
      max_tokens: 500,
      stream: false,
    }),
  });

  if (!response.ok) {
    throw new Error(`Model server returned ${response.status}`);
  }

  const data = (await response.json()) as ChatCompletionResponse;
  const responseContent = data.choices[0]?.message.content;

  if (!responseContent) {
    throw new Error("Model server returned an empty response");
  }

  return responseContent;
}
