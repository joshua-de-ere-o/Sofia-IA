/**
 * Port Node de supabase/functions/agent-runner/model-adapter.ts.
 *
 * El adapter original es Deno-only y la spec prohíbe tocar agent-runner/, así que
 * este archivo replica la misma lógica de selección de proveedor para consumo
 * desde rutas Next.js (App Router). Sólo expone text-in/text-out — no tools —
 * porque el único consumidor actual es el parseo de tareas en /api/telegram.
 *
 * Fuente de verdad del provider: tabla `configuracion` (ai_provider, ai_api_key),
 * con fallback a variables de entorno AI_PROVIDER / *_API_KEY / *_MODEL.
 */

import { createClient } from '@supabase/supabase-js';

const PROVIDERS = {
  anthropic: {
    defaultModel: 'claude-haiku-4-5-20251001',
    endpoint: 'https://api.anthropic.com/v1/messages',
  },
  openai: {
    defaultModel: 'gpt-4o-mini',
    endpoint: 'https://api.openai.com/v1/chat/completions',
  },
  gemini: {
    defaultModel: 'gemini-2.0-flash',
    endpoint: 'https://generativelanguage.googleapis.com/v1beta',
  },
};

async function callAnthropic(apiKey, model, systemPrompt, userText, maxTokens) {
  const res = await fetch(PROVIDERS.anthropic.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userText }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content?.filter((c) => c.type === 'text').map((c) => c.text).join('') || '';
}

async function callOpenAI(apiKey, model, systemPrompt, userText, maxTokens) {
  const res = await fetch(PROVIDERS.openai.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userText },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function callGemini(apiKey, model, systemPrompt, userText, maxTokens) {
  const endpoint = `${PROVIDERS.gemini.endpoint}/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      generationConfig: { maxOutputTokens: maxTokens },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const parts = data.candidates?.[0]?.content?.parts || [];
  return parts.filter((p) => p.text).map((p) => p.text).join('') || '';
}

const CALL_FN = { anthropic: callAnthropic, openai: callOpenAI, gemini: callGemini };

export async function getModelAdapter() {
  let cfgProvider;
  let cfgKey;

  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    if (url && key) {
      const supabase = createClient(url, key);
      const { data } = await supabase
        .from('configuracion')
        .select('ai_provider, ai_api_key')
        .limit(1)
        .single();
      cfgProvider = data?.ai_provider || undefined;
      cfgKey = data?.ai_api_key || undefined;
    }
  } catch (err) {
    console.warn('[model-adapter] No se pudo leer configuracion, usando env vars:', err?.message || err);
  }

  const provider = cfgProvider || process.env.AI_PROVIDER || 'anthropic';
  if (!PROVIDERS[provider]) throw new Error(`Proveedor no soportado: ${provider}`);

  const envKey = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    openai: process.env.OPENAI_API_KEY,
    gemini: process.env.GEMINI_API_KEY,
  }[provider];
  const envModel = {
    anthropic: process.env.ANTHROPIC_MODEL,
    openai: process.env.OPENAI_MODEL,
    gemini: process.env.GEMINI_MODEL,
  }[provider];

  const apiKey = cfgKey || envKey;
  if (!apiKey) throw new Error(`API key no configurada para proveedor: ${provider}`);

  const model = envModel || PROVIDERS[provider].defaultModel;

  return {
    provider,
    model,
    async chat({ systemPrompt, userText, maxTokens = 300 }) {
      return CALL_FN[provider](apiKey, model, systemPrompt, userText, maxTokens);
    },
  };
}
