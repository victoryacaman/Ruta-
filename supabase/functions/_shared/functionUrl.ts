const FUNCTION_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

export function buildFunctionUrl(
  supabaseUrl: string | undefined,
  functionName: string,
): string {
  const baseUrl = supabaseUrl?.trim();
  if (!baseUrl) throw new Error("SUPABASE_URL is not configured");
  if (!FUNCTION_NAME_PATTERN.test(functionName)) {
    throw new Error("Invalid Edge Function name");
  }

  return new URL(`/functions/v1/${functionName}`, baseUrl).toString();
}

export function functionUrl(functionName: string): string {
  return buildFunctionUrl(Deno.env.get("SUPABASE_URL"), functionName);
}
