type TargetAuthType = "NONE" | "BEARER" | "API_KEY_HEADER";

type TargetAuthInput = {
  targetAuthType: TargetAuthType;
  targetAuthHeaderName?: string;
  targetAuthSecret?: string;
};

export function buildTargetAuthPayload({
  targetAuthType,
  targetAuthHeaderName,
  targetAuthSecret,
}: TargetAuthInput) {
  if (targetAuthType === "NONE") {
    return {};
  }

  const secret = targetAuthSecret?.trim();
  const headerName =
    targetAuthType === "API_KEY_HEADER" ? targetAuthHeaderName?.trim() : undefined;

  return {
    ...(headerName ? { targetAuthHeaderName: headerName } : {}),
    ...(secret ? { targetAuthSecret: secret } : {}),
  };
}