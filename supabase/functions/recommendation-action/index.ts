import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { requireAuthorizedUser } from "../_shared/auth.ts";
import { corsHeaders, handlePreflight } from "../_shared/cors.ts";

// Records every approve/dismiss/undo event against a risk_snapshots row.
// Can only ever append an event row referencing a snapshot that already
// exists -- it cannot read, modify, or fire any purchase/transfer/
// supplier action itself, matching "suggestion, never autonomous action"
// at the infrastructure level.
//
// SECURITY HARDENING (2026-09-22): now gated -- anyone could previously
// log approve/dismiss events against any snapshot id.

const ALLOWED_EVENT_TYPES = ["approved", "dismissed", "undone"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return handlePreflight(req);
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "POST only" }), { status: 405, headers: corsHeaders(req) });
  }

  const auth = await requireAuthorizedUser(req);
  if (!auth.ok) return auth.response;

  try {
    const body = await req.json();
    const { snapshotId, eventType, note } = body ?? {};
    if (!snapshotId || typeof snapshotId !== "string") {
      throw new Error("snapshotId is required");
    }
    if (!ALLOWED_EVENT_TYPES.includes(eventType)) {
      throw new Error(`eventType must be one of ${ALLOWED_EVENT_TYPES.join(", ")}`);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: snapshot, error: snapshotError } = await supabase
      .from("risk_snapshots").select("id").eq("id", snapshotId).maybeSingle();
    if (snapshotError) throw snapshotError;
    if (!snapshot) {
      return new Response(JSON.stringify({ ok: false, error: "snapshotId does not reference a real snapshot" }), {
        status: 400, headers: corsHeaders(req),
      });
    }

    const { data, error } = await supabase.from("recommendation_events").insert({
      snapshot_id: snapshotId,
      event_type: eventType,
      note: typeof note === "string" ? note.slice(0, 500) : null,
    }).select("id, created_at").single();
    if (error) throw error;

    return new Response(JSON.stringify({ ok: true, id: data.id, createdAt: data.created_at }), { headers: corsHeaders(req) });
  } catch (err) {
    return new Response(JSON.stringify({ ok: false, error: String(err) }), { status: 400, headers: corsHeaders(req) });
  }
});
