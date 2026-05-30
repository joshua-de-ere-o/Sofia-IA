import { assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";

type FetchCall = {
  url: string;
  init?: RequestInit;
};

Deno.test("text flow emits stage timings and hotspot logs", async () => {
  Deno.env.set("AGENT_RUNNER_DISABLE_AUTO_SERVE", "1");
  Deno.env.set("SUPABASE_URL", "https://supabase.test");
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
  Deno.env.set("AI_PROVIDER", "openai");
  Deno.env.set("OPENAI_API_KEY", "openai-test-key");
  Deno.env.set("YCLOUD_API_KEY", "ycloud-test-key");
  Deno.env.set("YCLOUD_PHONE_NUMBER_ID", "123456");

  const consoleLogs: string[] = [];
  const fetchCalls: FetchCall[] = [];
  const originalFetch = globalThis.fetch;
  const originalLog = console.log;

  console.log = (...args: unknown[]) => {
    consoleLogs.push(String(args[0] ?? ""));
  };

  globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    fetchCalls.push({ url, init });

    if (url.includes("/rest/v1/conversaciones") && init?.method !== "PATCH") {
      return Promise.resolve(new Response(JSON.stringify({
        id: "conv-1",
        estado: "activa",
        telefono_contacto: "+593999000111",
        mensajes_raw: [],
        historial_resumido: null,
        handoff_activo: false,
        paciente_id: null,
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }

    if (url.includes("/rest/v1/pacientes")) {
      return Promise.resolve(new Response("null", { status: 200, headers: { "Content-Type": "application/json" } }));
    }

    if (url.includes("/rest/v1/configuracion") && url.includes("select=datos_bancarios")) {
      return Promise.resolve(new Response(JSON.stringify({ datos_bancarios: null }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }

    if (url.includes("/rest/v1/configuracion") && url.includes("select=ai_provider%2Cai_api_key")) {
      return Promise.resolve(new Response(JSON.stringify({ ai_provider: null, ai_api_key: null }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }

    if (url.includes("/rest/v1/conversaciones") && init?.method === "PATCH") {
      return Promise.resolve(new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }));
    }

    if (url.includes("api.openai.com")) {
      return Promise.resolve(new Response(JSON.stringify({
        choices: [{ message: { content: "Hola, soy Sofía" } }],
        usage: { prompt_tokens: 11, completion_tokens: 7 },
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }

    if (url.includes("api.ycloud.com")) {
      return Promise.resolve(new Response(JSON.stringify({ success: true }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }

    return Promise.reject(new Error(`Unexpected fetch ${url}`));
  };

  try {
    const { handleRequest } = await import("../index.ts");

    const response = await handleRequest(new Request("https://agent-runner.test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        senderNumber: "+593999000111",
        text: "Necesito turno",
        correlationId: "txt_runtime_case",
      }),
    }));

    assertEquals(response.status, 200);

    const body = await response.json();
    assertEquals(body.status, "success");

    const stageLogs = consoleLogs
      .filter((entry) => entry.includes("text_path_stage"))
      .map((entry) => JSON.parse(entry));

    assertEquals(stageLogs.length >= 6, true);
    assertEquals(stageLogs.some((entry) => entry.stage === "preflight_conversation"), true);
    assertEquals(stageLogs.some((entry) => entry.stage === "preflight_patient"), true);
    assertEquals(stageLogs.some((entry) => entry.stage === "preflight_bank_config"), true);
    assertEquals(stageLogs.some((entry) => entry.stage === "model_adapter"), true);
    assertEquals(stageLogs.some((entry) => entry.stage === "llm_iteration_1"), true);
    assertEquals(stageLogs.some((entry) => entry.stage === "whatsapp_send"), true);
    assertEquals(stageLogs.some((entry) => entry.stage === "conversation_persist"), true);
    assertEquals(stageLogs.every((entry) => entry.phone === "+5939***0111"), true);
    assertEquals(stageLogs.every((entry) => !JSON.stringify(entry).includes("Necesito turno")), true);

    const hotspotLogs = consoleLogs
      .filter((entry) => entry.includes("text_path_hotspot"))
      .map((entry) => JSON.parse(entry));

    assertEquals(hotspotLogs.length, 1);
    assertEquals(hotspotLogs[0].outcome, "success");
    assertEquals(hotspotLogs[0].stage_count, stageLogs.length);
    assertMatch(hotspotLogs[0].slowest_stage, /preflight_|llm_iteration_1|whatsapp_send|conversation_persist|model_adapter/);

    const ycloudCall = fetchCalls.find((call) => call.url.includes("api.ycloud.com"));
    assertEquals(Boolean(ycloudCall), true);
    const ycloudBody = JSON.parse(String(ycloudCall?.init?.body ?? "{}"));
    assertEquals(ycloudBody.text.body, "Hola, soy Sofía");
  } finally {
    globalThis.fetch = originalFetch;
    console.log = originalLog;
    Deno.env.delete("AGENT_RUNNER_DISABLE_AUTO_SERVE");
  }
});
