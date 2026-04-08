import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { sendTelegramMessage } from '../../../../lib/telegram';
import { sendWhatsAppMessage } from '../../../../lib/ycloud';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(req) {
    // Autenticación: acepta x-cron-secret (para pg_cron) o Bearer JWT válido
    const cronSecret = req.headers.get("x-cron-secret") ?? "";
    const authHeader = req.headers.get("Authorization") ?? "";
    const expectedSecret = process.env.CRON_SECRET ?? "kelly-cron-secret-2026";

    const isValidCron = cronSecret === expectedSecret;
    const isValidJwt = authHeader === `Bearer ${process.env.CRON_SECRET}`;

    if (!isValidCron && !isValidJwt) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const now = new Date();
        const thirtyMinsAgo = new Date(now.getTime() - 30 * 60 * 1000).toISOString();

        // Buscar handoffs activos que lleven más de 30 mins
        const { data: timeouts } = await supabase
            .from('handoffs')
            .select(`
                id, 
                conversacion_id, 
                paciente_id, 
                conversaciones ( id, pacientes (telefono) )
            `)
            .eq('estado', 'activo')
            .lte('created_at', thirtyMinsAgo);
            
        if (timeouts && timeouts.length > 0) {
            for (let t of timeouts) {
                // 1. Quitar Handoff
                await supabase
                    .from('conversaciones')
                    .update({ handoff_activo: false })
                    .eq('id', t.conversacion_id);

                // 2. Marcar resolver
                await supabase
                    .from('handoffs')
                    .update({ estado: 'timeout', resolved_at: now.toISOString() })
                    .eq('id', t.id);
                    
                // 3. Informar al paciente por YCloud
                const tel = t.conversaciones?.pacientes?.telefono;
                if (tel) {
                    await sendWhatsAppMessage(tel, "La Dra. Kely revisará tu caso pronto. ¿Hay algo más en lo que pueda ayudarte mientras tanto?");
                }
                
                // 4. Informar a Kelly por Telegram
                await sendTelegramMessage(`⚠️ <b>Handoff Timeout Automático</b>\nEl paciente ${tel || t.paciente_id} llevaba más de 30 minutos en espera. El bot ha retomado la conversación.`);
            }
        }
        
        return NextResponse.json({ ok: true, resolvedCount: timeouts?.length || 0 });
    } catch(err) {
        console.error("Cron Handoff Error", err);
        return NextResponse.json({ ok: false, error: err.message });
    }
}
