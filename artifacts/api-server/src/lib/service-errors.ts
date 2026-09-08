import { isUniqueViolation } from "./database-errors";

export function getServiceCreationErrorResponse(error: unknown) {
  if (!isUniqueViolation(error)) return null;
  return {
    status: 409 as const,
    body: {
      error: "Dieser Dienst ist bereits registriert.",
      code: "SERVICE_EXISTS",
    },
  };
}