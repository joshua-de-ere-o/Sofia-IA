import { sendTelegramMessage } from "./telegram";

export async function sendWhatsAppMessage(to, text) {
  const apiKey = process.env.YCLOUD_API_KEY;
  const from = process.env.YCLOUD_PHONE_NUMBER_ID;

  if (!apiKey || !from) {
    console.error("Faltan credenciales de YCloud");
    return { success: false, error: "Credenciales faltantes" };
  }

  try {
    const res = await fetch("https://api.ycloud.com/v2/whatsapp/messages/send", {
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

    if (!res.ok) {
        const errorData = await res.json();
        throw new Error(`YCloud API Error: ${JSON.stringify(errorData)}`);
    }

    const data = await res.json();
    return { success: true, data };
  } catch (err) {
    console.error("Error enviando mensaje por YCloud:", err);
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

    const res = await fetch("https://api.ycloud.com/v2/whatsapp/messages/send", {
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
