import { saveMemory, searchMemories, type Memory } from "./storage";

const EMBEDDING_URL = "http://127.0.0.1:8081/embedding";

interface EmbeddingResponse {
  embedding?: number[];
  data?: Array<{ embedding: number[] }>;
}

async function embed(text: string): Promise<number[] | undefined> {
  try {
    const response = await fetch(EMBEDDING_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: text }),
    });
    if (!response.ok) return undefined;
    const data = (await response.json()) as EmbeddingResponse;
    return data.embedding ?? data.data?.[0]?.embedding;
  } catch {
    return undefined;
  }
}

export async function findRelevantMemories(query: string): Promise<Memory[]> {
  const queryEmbedding = await embed(query);
  return searchMemories(query, queryEmbedding, 6);
}

export async function remember(
  content: string,
  kind = "fact",
  importance = 3,
  confidence = 0.7,
) {
  const embedding = await embed(content);
  return saveMemory(kind, content, importance, confidence, embedding);
}

function parseMemoryCandidates(text: string): Array<{ kind: string; content: string; importance: number; confidence: number }> {
  const jsonBlock = text.match(/\[[\s\S]*\]/)?.[0];
  if (!jsonBlock) return [];
  try {
    const candidates = JSON.parse(jsonBlock) as unknown;
    if (!Array.isArray(candidates)) return [];
    return candidates.filter((candidate): candidate is { kind: string; content: string; importance: number; confidence: number } => {
      if (!candidate || typeof candidate !== "object") return false;
      const value = candidate as Record<string, unknown>;
      return typeof value.kind === "string" && typeof value.content === "string";
    }).slice(0, 3).map((candidate) => ({
      kind: candidate.kind || "fact",
      content: candidate.content.trim(),
      importance: Math.max(1, Math.min(5, Number(candidate.importance) || 3)),
      confidence: Math.max(0, Math.min(1, Number(candidate.confidence) || 0.7)),
    })).filter((candidate) => candidate.content.length > 3);
  } catch {
    return [];
  }
}

export async function extractMemories(userMessage: string, assistantMessage: string) {
  const response = await fetch("http://127.0.0.1:8080/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: [
        {
          role: "system",
          content: "Extract only durable personal facts, preferences, routines, goals, or commitments explicitly stated by the user. Return only a JSON array with objects containing kind, content, importance (1-5), and confidence (0-1). Return [] if nothing should be remembered. Never infer sensitive facts.",
        },
        { role: "user", content: `User: ${userMessage}\nAssistant: ${assistantMessage}` },
      ],
      temperature: 0,
      max_tokens: 300,
      stream: false,
    }),
  });
  if (!response.ok) return [];
  const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const candidates = parseMemoryCandidates(data.choices?.[0]?.message?.content ?? "");
  return Promise.all(candidates.map((candidate) => remember(candidate.content, candidate.kind, candidate.importance, candidate.confidence)));
}
