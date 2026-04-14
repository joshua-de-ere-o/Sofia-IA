import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const CATALOG = {
  inbody: 20,
  virtual: 20,
  quincenal: 25,
  esencial: 35,
  premium: 70,
  trimestral: 90
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type" } });
  }

  try {
    const { servicio_id, zona } = await req.json();

    if (!servicio_id || !zona) {
      return new Response(
        JSON.stringify({ error: "Missing servicio_id or zona" }), 
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    let precio_base = CATALOG[servicio_id as keyof typeof CATALOG] || CATALOG["esencial"]; // Default to esencial if not found

    let ajuste_zona = 0;
    let precio_total = precio_base;
    let requiere_adelanto = true;
    let monto_adelanto = 0;

    if (zona === 'domicilio') {
      // Tarifa flat de $40 total para domicilio — precio_base se iguala al total para consistencia
      precio_base = 40;
      precio_total = 40;
      ajuste_zona = 0;
    } else {
      if (zona === 'valle') {
        ajuste_zona = 5;
        precio_total += ajuste_zona;
      }
    }

    if (zona === 'sur') {
      requiere_adelanto = false;
      monto_adelanto = 0;
    } else if (zona === 'domicilio') {
      monto_adelanto = 20; // 50% de 40 es 20
    } else {
      monto_adelanto = precio_total * 0.5;
    }

    const result = {
      precio_base,
      ajuste_zona,
      precio_total,
      requiere_adelanto,
      monto_adelanto
    };

    return new Response(JSON.stringify(result), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }), 
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
