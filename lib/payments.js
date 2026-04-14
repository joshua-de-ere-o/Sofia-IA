import { createClient } from "@supabase/supabase-js";
import { notifyPaymentToKelly } from "./telegram";

export async function processPaymentImage(senderNumber, imageUrl) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY // Requerido para saltar RLS y subir archivos
  );

  try {
    // 1. Descargar la imagen de YCloud (URL Temporal)
    // Nota: En un caso real, YCloud requiere autenticación para descargar la imagen si no es la URL de CDN directa.
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    const arrayBuffer = await blob.arrayBuffer();

    // 2. Definir nombre de archivo único
    const fileName = `pago_${senderNumber}_${Date.now()}.jpg`;
    const filePath = `${fileName}`;

    // 3. Subir a Supabase Storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("comprobantes")
      .upload(filePath, arrayBuffer, {
        contentType: "image/jpeg",
        upsert: true,
      });

    if (uploadError) throw uploadError;

    // 4. Obtener URL pública
    const { data: { publicUrl } } = supabase.storage
      .from("comprobantes")
      .getPublicUrl(filePath);

    // 5. Vincular a la cita pendiente más reciente de este paciente
    // Primero buscar el paciente por número
    const { data: paciente, error: pError } = await supabase
      .from("pacientes")
      .select("id, zona")
      .eq("telefono", senderNumber)
      .single();

    if (pError || !paciente) throw new Error("Paciente no encontrado");

    // Buscar cita pendiente_pago
    const { data: cita, error: cError } = await supabase
      .from("citas")
      .select("id, servicio")
      .eq("paciente_id", paciente.id)
      .eq("estado", "pendiente_pago")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (cError || !cita) throw new Error("Cita pendiente no encontrada");

    // 6. Calcular monto real según lógica de precios
    const CATALOG = {
      inbody: 20,
      virtual: 20,
      quincenal: 25,
      esencial: 35,
      premium: 70,
      trimestral: 90
    };
    const precio_base = CATALOG[cita.servicio] || CATALOG["esencial"];
    let monto_calculado = 0;
    
    if (paciente.zona === 'sur') {
      monto_calculado = 0;
    } else if (paciente.zona === 'domicilio') {
      monto_calculado = 20;
    } else if (paciente.zona === 'valle') {
      monto_calculado = (precio_base + 5) * 0.5;
    } else {
      monto_calculado = precio_base * 0.5;
    }

    // 7. Registrar en la tabla `pagos`
    const { error: paymentError } = await supabase
      .from("pagos")
      .insert({
        cita_id: cita.id,
        monto: monto_calculado,
        metodo: "transfer",
        referencia: filePath,
        comprobante_url: publicUrl,
        verificado: false
      });

    if (paymentError) throw paymentError;

    // 8. Notificar a Kelly por Telegram
    // Buscamos el nombre del paciente para la notificación
    const { data: pData } = await supabase
      .from("pacientes")
      .select("nombre")
      .eq("id", paciente.id)
      .single();

    await notifyPaymentToKelly(
      pData?.nombre || senderNumber,
      cita.servicio,
      monto_calculado,
      publicUrl
    );

    // 7. Actualizar estado de la cita a 'confirmada'
    const { error: updateError } = await supabase
      .from("citas")
      .update({ 
        estado: "confirmada",
        payment_reference: filePath 
      })
      .eq("id", cita.id);

    if (updateError) throw updateError;

    return { 
      success: true, 
      publicUrl, 
      citaId: cita.id,
      servicio: cita.servicio
    };

  } catch (error) {
    console.error("Error procesando imagen de pago:", error);
    return { success: false, error: error.message };
  }
}
