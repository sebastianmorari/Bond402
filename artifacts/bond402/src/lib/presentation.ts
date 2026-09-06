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