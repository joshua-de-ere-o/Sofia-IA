import { sanitizeSchemaForGemini } from "./gemini-schema.ts";

export function toolsToOpenAI(tools: any[]) {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}

export function toolsToGemini(tools: any[]) {
  return [{
    functionDeclarations: tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: sanitizeSchemaForGemini(t.input_schema),
    })),
  }];
}

export function buildProviderToolPayload(provider: string, tools: any[]) {
  if (provider === "openai") return toolsToOpenAI(tools);
  if (provider === "gemini") return toolsToGemini(tools);
  return tools;
}

function messagesToGemini(messages: any[]) {
  const out: any[] = [];
  for (const msg of messages) {
    if (msg.role === "user") {
      out.push({ role: "user", parts: [{ text: msg.content }] });
    } else if (msg.role === "assistant") {
      const parts: any[] = [];
      if (msg.content) parts.push({ text: msg.content });
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          const part: any = { functionCall: { name: tc.name, args: tc.input || tc.arguments || {} } };
          if (tc.thoughtSignature) part.thoughtSignature = tc.thoughtSignature;
          parts.push(part);
        }
      }
      out.push({ role: "model", parts });
    } else if (msg.role === "tool_result" || msg.role === "tool") {
      out.push({ role: "user", parts: [{ functionResponse: { name: msg.name || msg.tool_name || "unknown", response: { result: msg.content } } }] });
    }
  }
  return out;
}

export function buildGeminiRequestBody({ systemPrompt, messages, tools = [], maxTokens }: { systemPrompt: string; messages: any[]; tools?: any[]; maxTokens: number }) {
  const body: any = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: messagesToGemini(messages),
    generationConfig: {
      maxOutputTokens: maxTokens,
      thinkingConfig: { thinkingBudget: 0 },
    },
  };
  if (tools.length > 0) body.tools = toolsToGemini(tools);
  return body;
}
