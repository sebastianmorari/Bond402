# Passwort-Wiederherstellung und E-Mail-Verifizierung

## Status

Diese Funktionen sind im öffentlichen Bond402-MVP bewusst **nicht aktiviert**.
Registrierung, Anmeldung, Logout, Sessions und Passwortänderung funktionieren lokal
mit PostgreSQL und serverseitigen Sessions. Es werden keine scheinbaren
Bestätigungs-E-Mails und keine unsicheren Passwort-Reset-Links erzeugt.

## Provider-neutrale Grundlage

Eine spätere Aktivierung benötigt einen E-Mail-Anbieter mit:

- einem verwalteten Secret außerhalb des Quellcodes,
- zeitlich begrenzten, einmal verwendbaren Tokens,
- serverseitigem Hashing der Tokens,
- Rate-Limits für Anforderung und Einlösung,
- neutralen Antworten, damit keine Konten aufgelistet werden,
- auditierbarer Widerrufs- und Ablaufbehandlung.

Bis diese Voraussetzungen erfüllt sind, bleibt der Status bewusst offen. Ein
E-Mail-Anbieter, API-Key oder unsicherer Workaround wird nicht automatisch ergänzt.