import { createClient } from "@supabase/supabase-js";

/**
 * uploadComprobante — PR 2 simplified version.
 *
 * Responsibilities:
 *   1. Download the image from YCloud's temporary URL.
 *   2. Upload to Supabase Storage (bucket: comprobantes) using a deterministic
 *      filename based on `wamid` so that idempotent re-uploads are safe.
 *   3. Look up the patient and their most recent `pendiente_pago` cita.
 *   4. Return { success, publicUrl, image_path, citaId, pacienteId }.
 *
 * REMOVED (auto-confirm bug, PR 2):
 *   - pagos INSERT  → moves to agent-runner after OCR (PR 3)
 *   - citas UPDATE  → moves to agent-runner after OCR confirms amount (PR 3)
 *   - notifyPaymentToKelly → moves to agent-runner (PR 3)
 *
 * @param {string} senderNumber  - WhatsApp sender in E.164 format
 * @param {string} wamid         - YCloud message ID (used for deterministic filename)
 * @param {string} imageUrl      - Temporary YCloud image URL to download
 * @returns {Promise<{success: true, publicUrl: string, image_path: string, citaId: string, pacienteId: string}
 *                  |{success: false, error: string}>}
 */
export async function uploadComprobante(senderNumber, wamid, imageUrl) {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  try {
    // 1. Download the image from YCloud
    const response = await fetch(imageUrl);
    const blob = await response.blob();
    const arrayBuffer = await blob.arrayBuffer();

    // 2. Deterministic filename based on wamid (not Date.now) — enables idempotent upsert
    //    and deduplication by referencia in the webhook before dispatching to agent-runner.
    const image_path = `pago_${wamid}.jpg`;

    // 3. Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from("comprobantes")
      .upload(image_path, arrayBuffer, {
        contentType: "image/jpeg",
        upsert: true,
      });

    if (uploadError) throw uploadError;

    // 4. Get public URL
    const { data: { publicUrl } } = supabase.storage
      .from("comprobantes")
      .getPublicUrl(image_path);

    // 5. Look up the patient by phone number
    const { data: paciente, error: pError } = await supabase
      .from("pacientes")
      .select("id")
      .eq("telefono", senderNumber)
      .single();

    if (pError || !paciente) throw new Error("Paciente no encontrado");

    // 6. Look up the most recent pendiente_pago cita for this patient
    const { data: cita, error: cError } = await supabase
      .from("citas")
      .select("id, servicio, monto_adelanto")
      .eq("paciente_id", paciente.id)
      .eq("estado", "pendiente_pago")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (cError || !cita) throw new Error("Cita pendiente_pago no encontrada");

    return {
      success: true,
      publicUrl,
      image_path,
      citaId: cita.id,
      pacienteId: paciente.id,
    };
  } catch (error) {
    console.error("[Payments] Error en uploadComprobante:", error.message);
    return { success: false, error: error.message };
  }
}
