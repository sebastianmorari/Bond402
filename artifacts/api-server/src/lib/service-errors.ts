import { isUniqueViolation } from "./database-errors";

export function getServiceCreationErrorResponse(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "SERVICE_EXISTS"
  ) {
    return {
      status: 409 as const,
      body: {
        error: "Dieser Dienst ist bereits für Ihr Konto hinzugefügt.",
        code: "SERVICE_EXISTS",
      },
    };
  }
  if (!isUniqueViolation(error)) return null;
  return {
    status: 409 as const,
    body: {
      error: "Dieser Dienst ist bereits registriert.",
      code: "SERVICE_EXISTS",
    },
  };
}