export async function sendTelegramMessage(text, options = {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.error("TELEGRAM_BOT_TOKEN o TELEGRAM_CHAT_ID no configurados");
    return { success: false, error: "Configuración faltante" };
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  try {
    const body = {
      chat_id: chatId,
      text: text,
      parse_mode: "HTML",
      ...options,
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    return { success: data.ok, data };
  } catch (error) {
    console.error("Error enviando mensaje a Telegram:", error);
    return { success: false, error: error.message };
  }
}

/**
 * Notifica a Kelly sobre un nuevo pago recibido con un comprobante.
 */
export async function notifyPaymentToKelly(patientName, planName, amount, receiptUrl) {
  const message = `
💰 <b>¡Nuevo Pago Recibido!</b>

<b>Paciente:</b> ${patientName}
<b>Plan/Servicio:</b> ${planName}
<b>Adelanto:</b> $${amount}

Un comprobante ha sido subido y la cita ha sido <b>confirmada automáticamente</b>.
  `;

  const options = {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "📄 Ver Comprobante", url: receiptUrl },
          { text: "🗓️ Ver Agenda", url: `${process.env.NEXT_PUBLIC_APP_URL}/dashboard/citas` }
        ]
      ]
    }
  };

  return await sendTelegramMessage(message, options);
}
