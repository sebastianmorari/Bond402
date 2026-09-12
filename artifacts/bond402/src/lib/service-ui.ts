export function shouldShowDomainVerification(
  domainRelationship: string | null | undefined,
) {
  return domainRelationship === "OWNED";
}

export function isDomainVerificationNotApplicableError(error: unknown) {
  if (!error || typeof error !== "object" || !("data" in error)) {
    return false;
  }

  const data = (error as { data?: unknown }).data;
  return (
    !!data &&
    typeof data === "object" &&
    "code" in data &&
    data.code === "DOMAIN_VERIFICATION_NOT_APPLICABLE"
  );
}