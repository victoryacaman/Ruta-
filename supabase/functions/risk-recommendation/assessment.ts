import type { RecommendationAggregate } from "./scoring.ts";

export type AssessmentStatus = "complete" | "partial" | "unavailable";

export function assessmentRecommendation(
  scoring: RecommendationAggregate,
  status: AssessmentStatus,
  transferCostPerUnitLps: number,
  financialsAvailable = true,
) {
  if (!scoring.applicable || status === "unavailable") {
    return { applicable: false as const, atRiskSkus: [], avgCoveragePct: status === "complete" ? scoring.avgCoveragePct : null };
  }
  return {
    applicable: true as const,
    atRiskSkus: scoring.atRiskSkus.map((s) => ({ ...s, transferCostLps: financialsAvailable ? s.transferCostLps : null })),
    totalExposureLps: scoring.totalExposureLps,
    exposureIncomplete: scoring.exposureIncomplete,
    totalTransferCostLps: financialsAvailable ? scoring.totalTransferCostLps : null,
    totalTransferUnits: scoring.totalTransferUnits,
    totalVerifiedTransferUnits: scoring.totalVerifiedTransferUnits,
    anyUnverifiedTransfers: scoring.anyUnverifiedTransfers,
    roiMultiple: status === "complete" ? scoring.roiMultiple : null,
    roiUnavailableReason: status === "complete" ? scoring.roiUnavailableReason : "The overall assessment is incomplete; a total ROI multiple cannot be confirmed.",
    avgCoveragePct: status === "complete" ? scoring.avgCoveragePct : null,
    topWarehouse: scoring.topWarehouse,
    transferCostAssumptionLpsPerUnit: financialsAvailable ? transferCostPerUnitLps : null,
  };
}

// Feed success and inventory assessability are independent of whether a
// recommendation was found. An empty risk list alone never proves safety.
export function assessRiskInputs(input: {
  severity: string;
  weatherFailed: boolean;
  stormsFailed: boolean;
  erpAvailable: boolean;
  locationConfigAvailable: boolean;
  rejectedSkuCount: number;
  scoring: RecommendationAggregate;
  contextReasons?: string[];
}) {
  const { scoring } = input;
  const reasons: string[] = [...(input.contextReasons ?? [])];
  if (!input.locationConfigAvailable) reasons.push("location_config_unavailable");
  if (input.weatherFailed) reasons.push("weather_unavailable");
  if (input.stormsFailed) reasons.push("storms_unavailable");
  if (!input.erpAvailable) reasons.push("inventory_unavailable");
  else if (!scoring.totalSkuCount) reasons.push("inventory_empty");
  if (scoring.unassessedSkus.length) reasons.push("inventory_fields_missing");
  if (input.rejectedSkuCount > 0) reasons.push("inventory_rows_rejected");
  if (scoring.exposureIncomplete) reasons.push("prices_missing");

  const unavailable = !input.locationConfigAvailable || input.severity === "unknown" ||
    !input.erpAvailable || scoring.assessedSkuCount === 0;
  const status: AssessmentStatus = unavailable ? "unavailable" : reasons.length ? "partial" : "complete";
  return {
    status,
    reasons,
    totalSkuCount: scoring.totalSkuCount,
    assessedSkuCount: scoring.assessedSkuCount,
    unassessedSkuCount: scoring.unassessedSkus.length,
    rejectedSkuCount: input.rejectedSkuCount,
    unassessedSkus: scoring.unassessedSkus,
  };
}
