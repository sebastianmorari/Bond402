# Passwort-Wiederherstellung und E-Mail-Verifizierung

## Status

E-Mail-Verifizierung und Passwort-Wiederherstellung sind für den öffentlichen
Beta-Launch implementiert. Eine tatsächliche Aktivierung in Produktion ist aus
diesem Repository nicht verifiziert. Neue Konten bestätigen ihre E-Mail-Adresse über einen
24 Stunden gültigen Einmal-Link. Passwort-Reset-Links sind 30 Minuten gültig.

Die Auth-Mail-Implementierung verwendet Resend ausschließlich serverseitig.
Tokens werden kryptografisch sicher erzeugt und in PostgreSQL nur als Hash
gespeichert. Ein Token wird bei der ersten erfolgreichen Nutzung atomar
verbraucht. Verifizierungs- und Reset-Anfragen verwenden neutrale Antworten
und Rate-Limits, damit weder Konten aufgelistet noch Mailboxen missbraucht
werden können.

Die benötigte Konfiguration ist in `docs/auth-mail.md` dokumentiert:

- `RESEND_API_KEY` als Server-Secret,
- `PUBLIC_BASE_URL` als öffentliche HTTPS-Basis,
- optional `RESEND_FROM_EMAIL`, bis zur Domain-Verifizierung standardmäßig
  `onboarding@resend.dev`.