export function checkStatusLabel(status: string) {
  switch (status) {
    case "PASS":
      return "Bestanden";
    case "FAIL":
      return "Fehlgeschlagen";
    case "REVIEW":
      return "Prüfung nötig";
    default:
      return status;
  }
}

export function checkTypeLabel(type: string) {
  return type === "LIVE" ? "Live-Prüfung" : type === "MANUAL" ? "Manuelle Prüfung" : type;
}

export function checkClassificationLabel(classification: string) {
  switch (classification) {
    case "SUCCESS":
      return "Erfolgreiche Operation";
    case "AUTH_REQUIRED":
      return "Authentifizierung erforderlich";
    case "RATE_LIMITED":
      return "Rate-Limit";
    case "CHECK_NOT_APPLICABLE":
      return "Endpoint nicht geeignet";
    case "RESPONSE_SCHEMA_MISMATCH":
      return "Antwortschema abweichend";
    case "PROVIDER_ERROR":
      return "Provider-Ausfall";
    case "NETWORK_UNAVAILABLE":
      return "Host/Netzwerk nicht erreichbar";
    default:
      return classification;
  }
}

export function availabilityImpactLabel(impact: string) {
  switch (impact) {
    case "AVAILABLE":
      return "Verfügbarkeit: verfügbar";
    case "UNAVAILABLE":
      return "Verfügbarkeit: nicht verfügbar";
    case "NOT_EVALUATED":
      return "Verfügbarkeit: nicht bewertet";
    default:
      return impact;
  }
}