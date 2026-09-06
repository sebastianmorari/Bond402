# Bond402 Auth-Mail-Konfiguration

Bond402 versendet ausschließlich serverseitig über die Resend-API:

| Variable | Typ | Zweck | Pflicht |
| --- | --- | --- | --- |
| `RESEND_API_KEY` | Secret | Serverseitiger Resend-Bearer-Key | Ja |
| `PUBLIC_BASE_URL` | normale Variable | Öffentliche HTTPS-Basis für Verify-/Reset-Links, z. B. `https://bond402.example` | Ja |
| `RESEND_FROM_EMAIL` | normale Variable | Absenderadresse oder Resend-kompatibler Sender, z. B. `onboarding@resend.dev` bis zur Domain-Verifizierung | Nein, Standard: `onboarding@resend.dev` |

`RESEND_API_KEY` wird niemals an das Frontend übertragen, in URLs geschrieben oder geloggt.

## Resend-Absender

Bis eine eigene Domain bei Resend verifiziert ist, muss der kompatible Resend-Testabsender
`onboarding@resend.dev` verwendet werden. Danach kann `RESEND_FROM_EMAIL` auf einen
verifizierten Sender wie `Bond402 <auth@example.com>` gesetzt werden.

## Token-Sicherheit

- Verifizierungslinks sind 24 Stunden gültig.
- Passwort-Reset-Links sind 30 Minuten gültig.
- Tokens werden mit kryptografisch sicherem Zufall erzeugt.
- In PostgreSQL wird ausschließlich der SHA-256-Hash gespeichert.
- Jeder Token wird atomar verbraucht und kann nur einmal verwendet werden.
- Neue Konten werden erst nach E-Mail-Bestätigung zur Anmeldung zugelassen.
- Bestehende Konten bleiben durch `email_verification_required = false` kompatibel.

## Testbetrieb

Die automatisierten API-Tests verwenden nur einen lokalen Resend-Mock und versenden keine
echten Nachrichten. Eine abweichende `RESEND_API_URL` darf ausschließlich in isolierten
Tests verwendet werden und gehört nicht in die Produktionskonfiguration.