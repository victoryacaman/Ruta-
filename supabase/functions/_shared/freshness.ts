// How stale is the data behind a recommendation? Only ever answers this
// from a REAL timestamp a connected source actually reports (currently:
// a OneDrive workbook's own Graph `lastModifiedDateTime`) -- when that
// isn't available, freshness is reported as unknown, never guessed as
// stale or fresh. Matches this project's standing "say so, don't guess"
// discipline (see erp-inventory/validation.ts's null-vs-zero rule).

export interface FreshnessResult {
  lastModifiedAtIso: string | null;
  staleDays: number | null;
  isStale: boolean;
  staleAfterDays: number;
}

export function computeFreshness(
  lastModifiedAtIso: string | null,
  staleAfterDays: number,
  now: Date = new Date(),
): FreshnessResult {
  const lastModifiedMs = lastModifiedAtIso ? Date.parse(lastModifiedAtIso) : NaN;
  if (!lastModifiedAtIso || !Number.isFinite(lastModifiedMs)) {
    return { lastModifiedAtIso: null, staleDays: null, isStale: false, staleAfterDays };
  }
  const rawStaleDays = Math.max(0, (now.getTime() - lastModifiedMs) / 86_400_000);
  const staleDays = Math.round(rawStaleDays * 10) / 10;
  return { lastModifiedAtIso, staleDays, isStale: rawStaleDays > staleAfterDays, staleAfterDays };
}
