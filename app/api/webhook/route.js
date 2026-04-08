import { NextResponse } from "next/server";
import { processPaymentImage } from "../../../lib/payments";
import { runPreFilter } from "../../../lib/pre-filter";
import { sendWhatsAppMessage } from "../../../lib/ycloud";

export async function POST(req) {
  try {
    const signature = req.headers.get("ycloud-webhook-signature");
    // TODO: En Fase 2 avanzada, implementar la verificación de la firma de YCloud.
    
    const body = await req.json();
    
    // Asumimos formato estándar de meta/YCloud
    const message = body?.message; 
    // YCloud a veces envía { type: "message", message: { from: "...", type: "image", image: { url: "..." } } }
    
    if (!message) {
       return NextResponse.json({ received: true });
    }
    
    const senderNumber = message.from;
    const messageType = message.type;
    
    if (messageType === 'image') {
       // La URL temporal que envía YCloud para descargar la imagen
       const imageUrl = message.image?.url;
       
       if (imageUrl) {
         console.log(`Procesando comprobante de pago de: ${senderNumber}`);
         const result = await processPaymentImage(senderNumber, imageUrl);
         
         if (result.success) {
             console.log(`Pago procesado con éxito para la cita ${result.citaId}`);
         } else {
             console.error("Error en proceso de pago:", result.error);
         }
       }
    } else if (messageType === 'text') {
       const textBody = message.text?.body;
       console.log(`Mensaje de texto de ${senderNumber}: ${textBody}`);
       
       // 1. Ejecutar Filtro Pre-LLM
       const filterResult = await runPreFilter(senderNumber, textBody);
       
       if (!filterResult.shouldPass) {
         if (filterResult.quickReply) {
             console.log(`[Webhook] Filtro Bloqueo - Enviando quick reply a ${senderNumber}: ${filterResult.quickReply}`);
             // Envio asincrónico por YCloud para no demorar el response 200
             sendWhatsAppMessage(senderNumber, filterResult.quickReply).catch(err => console.error(err));
         }
         return NextResponse.json({ received: true, filtered: true, reason: filterResult.reason });
       }

       // 2. Si pasa el filtro, invocar a la Edge Function (Agent Runner) de forma asíncrona (Fire & Forget)
       // Esto soluciona los problemas de timeout de 10s en Vercel free tier
       const agentUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/agent-runner`;
       
       console.log(`[Webhook] Enviando contexto a la Edge Function agent-runner...`);
       fetch(agentUrl, {
         method: 'POST',
         headers: {
           'Content-Type': 'application/json',
           'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
         },
         body: JSON.stringify({ senderNumber, text: textBody })
       }).catch(err => console.error("Error invocando a agent-runner:", err));
       
    }

    // YCloud requiere respuesta rápida 200 OK para no reintentar
    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Error crítico en el webhook de YCloud:", error);
    // Devolvemos 200 aunque haya error interno para que YCloud no haga spam de retries, 
    // o 500 si deseamos que reintente. Normalmente 200 + logging interno.
    return NextResponse.json({ received: true, internal_error: error.message });
  }
}

export async function GET(req) {
  // Webhook verification fallback para configuraciones (ej. Meta setup request si aplica)
  return new NextResponse('Webhook YCloud OK', { status: 200 });
}
