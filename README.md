# Bestelltool V2 – Drive-Lernbasis

Diese Version erweitert die bestehende Browser-App um:

- Planungskontext: Markt, Abteilung (YBB/YBA), Planjahr und Ziel-KW
- getrennte Ansichten `Planung` und `Daten & Stammdaten`
- bestehender SAP-Import und Masterprodukt-Bereinigung bleiben erhalten
- Normalisierung der SAP-Tagesdaten für eine persistente Lernbasis
- serverseitige Google-Drive-Anbindung über `/api/drive`
- automatische Ordnerstruktur:
  `Forecast-App / MARKT / ABTEILUNG / SAP / JAHR / Plan_KWxx / lernbase.json`
- dieselbe Plan-KW wird beim erneuten Speichern aktualisiert statt als zweiter Forecast-Datensatz angelegt

## Vercel Environment Variable

Erforderlich:

`GOOGLE_SERVICE_ACCOUNT_JSON`

Optional, falls mehrere Ordner namens Forecast-App existieren:

`GOOGLE_DRIVE_ROOT_FOLDER_ID`

Optional für einen anderen Root-Namen:

`GOOGLE_DRIVE_ROOT_FOLDER_NAME`

## Noch nicht enthalten

Sortimentsauswahl, Forecast, Produktionsplan und Bestelllogik sind bewusst noch nicht implementiert.
Diese Funktionen werden in den nächsten Ausbaustufen auf der gespeicherten Datenbasis aufgebaut.
