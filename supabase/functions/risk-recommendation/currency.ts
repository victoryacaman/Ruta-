import { UNKNOWN_CONTEXT, type InventoryContext } from "../_shared/inventoryContext.ts";
import type { RecommendationAggregate } from "./scoring.ts";

// The existing transfer-cost assumption is denominated in HNL (_lps).
// Until another cost currency/FX policy is verified, USD inventories stay
// readable but financial recommendations are withheld, never converted.
export function riskInventoryContext(value: any): InventoryContext {
  if (!value || !["demo", "pilot", "unknown"].includes(value.environment) ||
      !["HNL", "USD", null].includes(value.currencyCode) || typeof value.unitsConfirmed !== "boolean") {
    return { ...UNKNOWN_CONTEXT };
  }
  return { environment: value.environment, currencyCode: value.currencyCode, unitsConfirmed: value.unitsConfirmed };
}
export function currencyAssessment(context: InventoryContext) {
  const reasons = [];
  if (!context.unitsConfirmed) reasons.push("inventory_units_unconfirmed");
  if (context.currencyCode === null) reasons.push("inventory_currency_unconfirmed");
  else if (context.currencyCode !== "HNL") reasons.push("transfer_currency_mismatch");
  return {
    currencyCode: context.currencyCode,
    currencySymbol: context.currencyCode === "HNL" ? "L" : context.currencyCode === "USD" ? "$" : null,
    transferCurrencyCode: "HNL" as const,
    financialsAvailable: reasons.length === 0,
    reasons,
  };
}
export function withholdFinancials(scoring: RecommendationAggregate, available: boolean): RecommendationAggregate {
  if (available) return scoring;
  const reason = "Currency or quantity units are not confirmed compatible; monetary estimates and ROI are withheld. No currency conversion was performed.";
  return {
    ...scoring,
    atRiskSkus: scoring.atRiskSkus.map((s) => ({ ...s, salesExposureLps: null,
      transferCostLps: 0, exposureUnavailableReason: reason, dataGaps: [...s.dataGaps, reason] })),
    totalExposureLps: null, totalTransferCostLps: 0, exposureIncomplete: true,
    roiMultiple: null, roiUnavailableReason: reason,
  };
}
