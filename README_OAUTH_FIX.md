# Bestelltool V3.3 – OAuth-Fix

Diese Version ersetzt für die Google-Drive-Speicherung den Service Account durch OAuth des echten Google-Nutzers.

## Dateien
- API/drive.js
- API/google/connect.js
- API/google/callback.js

## Benötigte Vercel-Variablen
- GOOGLE_CLIENT_ID
- GOOGLE_CLIENT_SECRET
- GOOGLE_REFRESH_TOKEN
- optional GOOGLE_REDIRECT_URI=https://bestelltool-rouge.vercel.app/api/google/callback
- optional GOOGLE_DRIVE_ROOT_FOLDER_NAME=Forecast-App

GOOGLE_SERVICE_ACCOUNT_JSON kann nach erfolgreichem Test entfernt werden.

## Einrichtung
1. Dateien in GitHub hochladen/ersetzen.
2. Deploy abwarten.
3. Öffnen: https://bestelltool-rouge.vercel.app/api/google/connect
4. Google-Zugriff erlauben.
5. Callback zeigt GOOGLE_REFRESH_TOKEN.
6. In Vercel als Geheimnis speichern.
7. Neu deployen.
8. Drive prüfen und Lernbasis speichern.

## Deduplizierung
Markt + Abteilung + Jahr + KW bleibt der eindeutige Snapshot.
Ein erneuter Upload derselben Kombination ersetzt die vorhandenen facts_*.json und decisions_*.json.
