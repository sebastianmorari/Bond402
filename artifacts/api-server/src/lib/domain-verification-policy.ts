import type { ApiServiceRow } from "@workspace/db";

export const DOMAIN_RELATIONSHIPS = ["OWNED", "THIRD_PARTY"] as const;
export type DomainRelationship = (typeof DOMAIN_RELATIONSHIPS)[number];

export type DomainVerificationStatus =
  | "VERIFIED"
  | "PENDING"
  | "NOT_STARTED"
  | "NOT_APPLICABLE"
  | "NOT_EVALUATED";

export function getDomainRelationship(service: Pick<ApiServiceRow, "domainRelationship">) {
  return service.domainRelationship === "OWNED" ? "OWNED" : "THIRD_PARTY";
}

export function getDomainVerificationStatus(
  service: Pick<
    ApiServiceRow,
    "domainRelationship" | "domainVerifiedAt" | "domainVerificationTokenHash"
  >,
): DomainVerificationStatus {
  if (getDomainRelationship(service) === "THIRD_PARTY") return "NOT_APPLICABLE";
  if (service.domainVerifiedAt) return "VERIFIED";
  if (service.domainVerificationTokenHash) return "PENDING";
  return "NOT_STARTED";
}

export function getDomainSignal(
  service: Pick<
    ApiServiceRow,
    "domainRelationship" | "domainVerifiedAt"
  >,
) {
  if (getDomainRelationship(service) === "THIRD_PARTY") return "NOT_APPLICABLE" as const;
  return service.domainVerifiedAt ? ("CHECKED" as const) : ("NOT_EVALUATED" as const);
}