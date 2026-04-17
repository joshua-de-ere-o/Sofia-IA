import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js";

// ──────────────────────────────────────────────
// Helpers — replican patrón de enviar-recordatorios
// ──────────────────────────────────────────────

function isPlaceholder(val: string | undefined): boolean {
  return !val || val.startsWith("PLACEHOLDER");
}

async function sendWhatsApp(to: string, text: string): Promise<void> {
  const apiKey = Deno.env.get("YCLOUD_API_KEY");
  const from = Deno.env.get("YCLOUD_PHONE_NUMBER_ID");

  if (isPlaceholder(apiKey) || isPlaceholder(from)) {
    console.log("[resolver-handoffs] YCloud no configurado — mensaje al paciente omitido");
    return;
  }
  try {
    const res = await fetch("https://api.ycloud.com/v2/whatsapp/messages/send", {
      method: "POST",
      headers: {
        "X-API-Key": apiKey!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        type: "text",
        text: { body: text },
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      console.error(`[resolver-handoffs] YCloud error para ${to}:`, err);
    }
  } catch (err) {
    console.error(`[resolver-handoffs] Error de red enviando a ${to}:`, err);
  }
}

async function sendTelegram(text: string): Promise<void> {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID");

  if (isPlaceholder(token) || isPlaceholder(chatId)) {
    console.log("[resolver-handoffs] Telegram no configurado — notificación a Kelly omitida");
    return;
  }
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
  } catch (err) {
    console.error("[resolver-handoffs] Error enviando Telegram:", err);
  }
}

// ──────────────────────────────────────────────
// Lógica
// ──────────────────────────────────────────────

type SupabaseLike = ReturnType<typeof createClient>;

async function procesarTimeouts(supabase: SupabaseLike): Promise<void> {
  const limite = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  const { data: handoffs, error } = await supabase
    .from("handoffs")
    .select(`
      id, conversacion_id, created_at,
      pacientes!inner(nombre, telefono)
    `)
    .eq("estado", "activo")
    .lt("created_at", limite);

  if (error) {
    console.error("[ResolverHandoffs] Error consultando timeouts:", error);
    return;
  }
  if (!handoffs || handoffs.length === 0) {
    console.log("[ResolverHandoffs] Sin handoffs para auto-resolver.");
    return;
  }

  for (const h of handoffs as any[]) {
    const paciente = h.pacientes;
    console.log(`[resolver-handoffs] Auto-resolviendo handoff ${h.id}`);

    // BD update SIEMPRE se ejecuta, independientemente de mensajes
    await supabase
      .from("handoffs")
      .update({ estado: "timeout", resolved_at: new Date().toISOString() })
      .eq("id", h.id);

    if (h.conversacion_id) {
      await supabase
        .from("conversaciones")
        .update({ handoff_activo: false })
        .eq("id", h.conversacion_id);
    }

    // WhatsApp al paciente — try/catch individual
    try {
      if (paciente?.telefono) {
        await sendWhatsApp(
          paciente.telefono,
          "Hola, soy Sofía nuevamente 😊 ¿Hay algo más en lo que pueda ayudarte?"
        );
      }
    } catch (err) {
      console.error(`[resolver-handoffs] Error enviando WhatsApp para handoff ${h.id}:`, err);
    }

    // Telegram a Kelly — try/catch individual
    try {
      await sendTelegram(
        `⏱️ Handoff auto-resuelto por timeout — ${paciente?.nombre ?? "paciente"}`
      );
    } catch (err) {
      console.error(`[resolver-handoffs] Error enviando Telegram para handoff ${h.id}:`, err);
    }

    console.log(`[resolver-handoffs] Handoff ${h.id} resuelto por timeout`);
  }
}

async function procesarRecordatorios(supabase: SupabaseLike): Promise<void> {
  const ahora = Date.now();
  const hace10 = new Date(ahora - 10 * 60 * 1000).toISOString();
  const hace30 = new Date(ahora - 30 * 60 * 1000).toISOString();

  const { data: handoffs, error } = await supabase
    .from("handoffs")
    .select(`
      id, created_at,
      pacientes!inner(nombre)
    `)
    .eq("estado", "activo")
    .eq("recordatorio_enviado", false)
    .lt("created_at", hace10)
    .gte("created_at", hace30);

  if (error) {
    console.error("[ResolverHandoffs] Error consultando recordatorios:", error);
    return;
  }
  if (!handoffs || handoffs.length === 0) {
    console.log("[ResolverHandoffs] Sin recordatorios pendientes.");
    return;
  }

  for (const h of handoffs as any[]) {
    const paciente = h.pacientes;
    try {
      await sendTelegram(
        `⚠️ Llevas 10 min sin responder el handoff de ${paciente?.nombre ?? "paciente"}`
      );
    } catch (err) {
      console.error(`[resolver-handoffs] Error enviando recordatorio Telegram para handoff ${h.id}:`, err);
    }
    // Marcar recordatorio como enviado aunque Telegram falle
    await supabase
      .from("handoffs")
      .update({ recordatorio_enviado: true })
      .eq("id", h.id);
    console.log(`[resolver-handoffs] Recordatorio enviado para handoff ${h.id}`);
  }
}

// ──────────────────────────────────────────────
// Entry Point
// ──────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const cronSecret = req.headers.get("x-cron-secret") ?? "";
  const authHeader = req.headers.get("Authorization") ?? "";
  const expectedSecret = Deno.env.get("CRON_SECRET") ?? "kelly-cron-secret-2024";

  const isValidCron = cronSecret === expectedSecret;
  const isValidJwt = authHeader.startsWith("Bearer ");

  if (!isValidCron && !isValidJwt) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    console.log("[ResolverHandoffs] Iniciando ejecución...");

    // Primero los recordatorios (10–30 min) y luego los timeouts (>30 min)
    // El orden importa: si procesáramos timeouts primero, el handoff ya no
    // estaría "activo" cuando buscáramos recordatorios pendientes.
    await procesarRecordatorios(supabase);
    await procesarTimeouts(supabase);

    console.log("[ResolverHandoffs] Ejecución completada.");
    return new Response(
      JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }),
      { headers: { "Content-Type": "application/json" }, status: 200 }
    );
  } catch (err: any) {
    console.error("[ResolverHandoffs] Error crítico:", err);
    return new Response(JSON.stringify({ error: err.message }), { status: 500 });
  }
});
