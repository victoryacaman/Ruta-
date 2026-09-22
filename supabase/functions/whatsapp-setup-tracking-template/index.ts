import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireAuthorizedUser } from "../_shared/auth.ts";
import { corsHeaders, handlePreflight } from "../_shared/cors.ts";

// One-time (re-runnable) setup call: submits (POST) or checks the status
// of (GET) the tracking_request custom message template via the WhatsApp
// Business Management API, using the access token already on file. Never
// returns the token — only Meta's own template-status response, which
// contains no secrets.
//
// Body text ends in fixed text after {{2}}, not the variable itself —
// Meta rejects a template whose body starts or ends with a variable
// (confirmed empirically: first attempt without trailing text after {{2}}
// was rejected with error_subcode 2388299).
//
// SECURITY HARDENING (2026-09-23): this is an administrative action --
// it submits/changes a message template on the business's real WhatsApp
// account -- so it now requires an authorized Utopia session, same as
// every other config-changing endpoint in this project.

async function loadConfig() {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data: config, error } = await supabase
    .from("whatsapp_config")
    .select("whatsapp_business_account_id, access_token")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!config) throw new Error("No whatsapp_config row found");
  return config;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handlePreflight(req);

  const auth = await requireAuthorizedUser(req);
  if (!auth.ok) return auth.response;

  try {
    const config = await loadConfig();

    if (req.method === "GET") {
      const waRes = await fetch(
        `https://graph.facebook.com/v25.0/${config.whatsapp_business_account_id}/message_templates?name=tracking_request`,
        { headers: { "Authorization": `Bearer ${config.access_token}` } },
      );
      const waJson = await waRes.json();
      return new Response(JSON.stringify({ ok: waRes.ok, status: waRes.status, response: waJson }), {
        status: waRes.ok ? 200 : 502, headers: corsHeaders(req),
      });
    }

    const templatePayload = {
      name: "tracking_request",
      language: "es",
      category: "UTILITY",
      components: [
        {
          type: "BODY",
          text: "Hola {{1}}, ¿podrías compartir tu número de rastreo o la hora estimada de entrega para: {{2}}? Gracias por tu ayuda.",
          example: { body_text: [["Carlos", "PO #4021 — 200 unidades a San Pedro Sula"]] },
        },
      ],
    };

    const waRes = await fetch(
      `https://graph.facebook.com/v25.0/${config.whatsapp_business_account_id}/message_templates`,
      {
        method: "POST",
        headers: { "Authorization": `Bearer ${config.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify(templatePayload),
      },
    );
    const waJson = await waRes.json();

    return new Response(
      JSON.stringify({ ok: waRes.ok, status: waRes.status, response: waJson }),
      { status: waRes.ok ? 200 : 502, headers: corsHeaders(req) },
    );
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 502, headers: corsHeaders(req) });
  }
});
