// Shared cooldown / rate-limit helpers backed by whatsapp_send_log.
// Used by request-tracking-update (per-shipment resend cooldown) and
// send-whatsapp-alert (generic per-user rate limit).
import { createClient } from "jsr:@supabase/supabase-js@2";

type SupabaseAdmin = ReturnType<typeof createClient>;

// True if a send for this shipment already happened within the window --
// i.e. a new send should be BLOCKED unless the caller explicitly confirms
// a resend. Does not write a log row itself.
export async function isShipmentInCooldown(
  admin: SupabaseAdmin,
  functionName: string,
  shipmentId: string,
  windowMinutes: number,
): Promise<boolean> {
  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const { count, error } = await admin
    .from("whatsapp_send_log")
    .select("id", { count: "exact", head: true })
    .eq("function_name", functionName)
    .eq("shipment_id", shipmentId)
    .gte("sent_at", since);
  if (error) throw error;
  return (count ?? 0) > 0;
}

// Count of sends by this user for this function within the window --
// used for a generic per-user rate limit (not tied to one shipment).
export async function countRecentSendsByUser(
  admin: SupabaseAdmin,
  functionName: string,
  userId: string,
  windowMinutes: number,
): Promise<number> {
  const since = new Date(Date.now() - windowMinutes * 60_000).toISOString();
  const { count, error } = await admin
    .from("whatsapp_send_log")
    .select("id", { count: "exact", head: true })
    .eq("function_name", functionName)
    .eq("sent_by", userId)
    .gte("sent_at", since);
  if (error) throw error;
  return count ?? 0;
}

export async function logSend(
  admin: SupabaseAdmin,
  functionName: string,
  shipmentId: string | null,
  sentBy: string | null,
): Promise<void> {
  const { error } = await admin
    .from("whatsapp_send_log")
    .insert({ function_name: functionName, shipment_id: shipmentId, sent_by: sentBy });
  if (error) throw error;
}

// Pure logic, extracted so it's unit-testable without a database: given a
// list of past send timestamps (ISO strings) and a window, would a send
// right now be blocked?
export function isWithinCooldownPure(sentAtIso: string[], windowMinutes: number, nowMs: number = Date.now()): boolean {
  const cutoff = nowMs - windowMinutes * 60_000;
  return sentAtIso.some((iso) => new Date(iso).getTime() >= cutoff);
}
