import { sendTelegramMessage } from "./telegram";

function maskPhone(phone) {
  if (!phone || phone.length <= 9) return phone;
  return `${phone.slice(0, 5)}***${phone.slice(-4)}`;
}

export async function sendWhatsAppMessage(to, text, meta = {}) {
  const apiKey = process.env.YCLOUD_API_KEY;
  const from = process.env.YCLOUD_PHONE_NUMBER_ID;

  if (!apiKey || !from) {
    console.error("Faltan credenciales de YCloud");
    return { success: false, error: "Credenciales faltantes" };
  }

  try {
    const startedAt = Date.now();
    const res = await fetch("https://api.ycloud.com/v2/whatsapp/messages", {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: from,
        to: to,
        type: "text",
        text: { body: text }
      })
    });
    console.log(JSON.stringify({
      level: "info",
      scope: "[YCloud]",
      event: meta.stage ?? "whatsapp_send",
      correlation_id: meta.correlationId ?? null,
      phone: maskPhone(to),
      status: res.status,
      duration_ms: Date.now() - startedAt,
    }));

    if (!res.ok) {
        const errorData = await res.json();
        throw new Error(`YCloud API Error: ${JSON.stringify(errorData)}`);
    }

    const data = await res.json();
    return { success: true, data };
  } catch (err) {
    console.error(JSON.stringify({
      level: "error",
      scope: "[YCloud]",
      event: meta.stage ?? "whatsapp_send",
      correlation_id: meta.correlationId ?? null,
      phone: maskPhone(to),
      error: err.message,
    }));
    return { success: false, error: err.message };
  }
}

export async function sendWhatsAppImage(to, imageUrl, caption = "") {
  const apiKey = process.env.YCLOUD_API_KEY;
  const from = process.env.YCLOUD_PHONE_NUMBER_ID;

  if (!apiKey || !from) {
    console.error("Faltan credenciales de YCloud");
    return { success: false, error: "Credenciales faltantes" };
  }

  try {
    const payload = {
        from: from,
        to: to,
        type: "image",
        image: { link: imageUrl }
    };
    if (caption) {
        payload.image.caption = caption;
    }

    const res = await fetch("https://api.ycloud.com/v2/whatsapp/messages", {
      method: "POST",
      headers: {
        "X-API-Key": apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
        const errorData = await res.json();
        throw new Error(`YCloud API Error: ${JSON.stringify(errorData)}`);
    }

    const data = await res.json();
    return { success: true, data };
  } catch (err) {
    console.error("Error enviando imagen por YCloud:", err);
    return { success: false, error: err.message };
  }
}
