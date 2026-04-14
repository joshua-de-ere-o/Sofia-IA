/**
 * model-adapter.ts — Capa de abstracción LLM para Deno Edge Functions.
 * Soporta Claude, OpenAI y Gemini con interfaz unificada.
 */

import { createClient } from "jsr:@supabase/supabase-js";

const PROVIDERS: Record<string, { defaultModel: string; endpoint: string }> = {
  anthropic: {
    defaultModel: "claude-haiku-4-5-20251001",
    endpoint: "https://api.anthropic.com/v1/messages",
  },
  openai: {
    defaultModel: "gpt-4o-mini",
    endpoint: "https://api.openai.com/v1/chat/completions",
  },
  gemini: {
    defaultModel: "gemini-2.0-flash",
    endpoint: "https://generativelanguage.googleapis.com/v1beta",
  },
};

// ─── Conversiones de herramientas ─────────────────────────────────────────────

function toolsToOpenAI(tools: any[]) {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.input_schema },
  }));
}

function toolsToGemini(tools: any[]) {
  return [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: t.input_schema })) }];
}

// ─── Conversiones de mensajes ─────────────────────────────────────────────────

function messagesToAnthropic(messages: any[]) {
  return messages.map((msg) => {
    if (msg.role === "tool_result" || msg.role === "tool") {
      return {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: msg.tool_use_id || msg.tool_call_id, content: msg.content }],
      };
    }
    if (msg.role === "assistant" && msg.tool_calls) {
      return {
        role: "assistant",
        content: [
          ...(msg.content ? [{ type: "text", text: msg.content }] : []),
          ...msg.tool_calls.map((tc: any) => ({ type: "tool_use", id: tc.id, name: tc.name, input: tc.input || tc.arguments || {} })),
        ],
      };
    }
    return { role: msg.role, content: msg.content };
  });
}

function messagesToOpenAI(systemPrompt: string, messages: any[]) {
  const out: any[] = [{ role: "system", content: systemPrompt }];
  for (const msg of messages) {
    if (msg.role === "tool_result" || msg.role === "tool") {
      out.push({ role: "tool", tool_call_id: msg.tool_use_id || msg.tool_call_id, content: typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content) });
    } else if (msg.role === "assistant" && msg.tool_calls) {
      out.push({
        role: "assistant", content: msg.content || null,
        tool_calls: msg.tool_calls.map((tc: any) => ({
          id: tc.id, type: "function",
          function: { name: tc.name, arguments: typeof tc.input === "string" ? tc.input : JSON.stringify(tc.input || tc.arguments || {}) },
        })),
      });
    } else {
      out.push({ role: msg.role, content: msg.content });
    }
  }
  return out;
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
          parts.push({ functionCall: { name: tc.name, args: tc.input || tc.arguments || {} } });
        }
      }
      out.push({ role: "model", parts });
    } else if (msg.role === "tool_result" || msg.role === "tool") {
      out.push({ role: "function", parts: [{ functionResponse: { name: msg.name || msg.tool_name || "unknown", response: { result: msg.content } } }] });
    }
  }
  return out;
}

// ─── Normalización de respuestas ──────────────────────────────────────────────

function normalizeAnthropic(data: any) {
  const text = data.content?.filter((c: any) => c.type === "text").map((c: any) => c.text).join("") || null;
  const toolCalls = data.content?.filter((c: any) => c.type === "tool_use").map((c: any) => ({ id: c.id, name: c.name, input: c.input, arguments: c.input })) || [];
  return { text, toolCalls, usage: { input: data.usage?.input_tokens || 0, output: data.usage?.output_tokens || 0 } };
}

function normalizeOpenAI(data: any) {
  const msg = data.choices?.[0]?.message;
  const toolCalls = (msg?.tool_calls || []).map((tc: any) => ({
    id: tc.id, name: tc.function.name, input: JSON.parse(tc.function.arguments || "{}"), arguments: JSON.parse(tc.function.arguments || "{}"),
  }));
  return { text: msg?.content || null, toolCalls, usage: { input: data.usage?.prompt_tokens || 0, output: data.usage?.completion_tokens || 0 } };
}

function normalizeGemini(data: any) {
  const parts = data.candidates?.[0]?.content?.parts || [];
  const text = parts.filter((p: any) => p.text).map((p: any) => p.text).join("") || null;
  const toolCalls = parts.filter((p: any) => p.functionCall).map((p: any, i: number) => ({
    id: `gemini_${Date.now()}_${i}`, name: p.functionCall.name, input: p.functionCall.args || {}, arguments: p.functionCall.args || {},
  }));
  return { text, toolCalls, usage: { input: data.usageMetadata?.promptTokenCount || 0, output: data.usageMetadata?.candidatesTokenCount || 0 } };
}

// ─── Llamadas API ─────────────────────────────────────────────────────────────

async function callAnthropic(apiKey: string, model: string, systemPrompt: string, messages: any[], tools: any[], maxTokens: number) {
  const body: any = {
    model, max_tokens: maxTokens,
    system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
    messages: messagesToAnthropic(messages),
  };
  if (tools.length > 0) body.tools = tools;

  const res = await fetch(PROVIDERS.anthropic.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01", "anthropic-beta": "prompt-caching-2024-07-31" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  return normalizeAnthropic(await res.json());
}

async function callOpenAI(apiKey: string, model: string, systemPrompt: string, messages: any[], tools: any[], maxTokens: number) {
  const body: any = { model, max_tokens: maxTokens, messages: messagesToOpenAI(systemPrompt, messages) };
  if (tools.length > 0) body.tools = toolsToOpenAI(tools);

  const res = await fetch(PROVIDERS.openai.endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  return normalizeOpenAI(await res.json());
}

async function callGemini(apiKey: string, model: string, systemPrompt: string, messages: any[], tools: any[], maxTokens: number) {
  const endpoint = `${PROVIDERS.gemini.endpoint}/models/${model}:generateContent?key=${apiKey}`;
  const body: any = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: messagesToGemini(messages),
    generationConfig: { maxOutputTokens: maxTokens },
  };
  if (tools.length > 0) body.tools = toolsToGemini(tools);

  const res = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  return normalizeGemini(await res.json());
}

// ─── Factory ──────────────────────────────────────────────────────────────────

type ChatParams = { systemPrompt: string; messages: any[]; tools?: any[]; maxTokens?: number };

export function createModelAdapter(provider: string, apiKey: string, model?: string) {
  const config = PROVIDERS[provider];
  if (!config) throw new Error(`Proveedor no soportado: ${provider}`);
  const selectedModel = model || config.defaultModel;

  const callFn: Record<string, typeof callAnthropic> = { anthropic: callAnthropic, openai: callOpenAI, gemini: callGemini };

  return {
    provider,
    model: selectedModel,
    async chat({ systemPrompt, messages, tools = [], maxTokens = 300 }: ChatParams) {
      return callFn[provider](apiKey, selectedModel, systemPrompt, messages, tools, maxTokens);
    },
  };
}

/**
 * Lee AI_PROVIDER y API keys primero desde la tabla `configuracion`, con fallback
 * a variables de entorno. Retorna un adaptador listo.
 */
export async function getModelAdapter() {
  let cfgProvider: string | undefined;
  let cfgKey: string | undefined;

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey =
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    if (supabaseUrl && supabaseKey) {
      const supabase = createClient(supabaseUrl, supabaseKey);
      const { data } = await supabase
        .from("configuracion")
        .select("ai_provider, ai_api_key")
        .limit(1)
        .single();
      cfgProvider = data?.ai_provider ?? undefined;
      cfgKey = data?.ai_api_key ?? undefined;
    }
  } catch (err) {
    console.warn("[model-adapter] No se pudo leer configuracion, usando env vars:", err);
  }

  const provider = cfgProvider || Deno.env.get("AI_PROVIDER") || "anthropic";
  const envKeyMap: Record<string, string | undefined> = {
    anthropic: Deno.env.get("ANTHROPIC_API_KEY"),
    openai: Deno.env.get("OPENAI_API_KEY"),
    gemini: Deno.env.get("GEMINI_API_KEY"),
  };
  const modelMap: Record<string, string | undefined> = {
    anthropic: Deno.env.get("ANTHROPIC_MODEL"),
    openai: Deno.env.get("OPENAI_MODEL"),
    gemini: Deno.env.get("GEMINI_MODEL"),
  };
  const apiKey = cfgKey || envKeyMap[provider];
  if (!apiKey) throw new Error(`API key no configurada para proveedor: ${provider}`);
  return createModelAdapter(provider, apiKey, modelMap[provider]);
}
