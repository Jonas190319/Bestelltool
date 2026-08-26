# Bestelltool V3 – Stammdaten / Produktzuordnung

Neu in V3:

- eigener Reiter **Stammdaten**
- Suche und Filter nach OWG/WG, Produkt oder Artikelnummer
- Masterprodukt, Ziel-Oberwarengruppe und Ziel-Warengruppe direkt bearbeitbar
- dauerhafte Speicherung in Google Drive unter `Forecast-App/Stammdaten/MARKT/ABTEILUNG/masterdata.json`
- beim nächsten SAP-Upload werden bekannte Artikelnummern automatisch mit der gespeicherten fachlichen Zuordnung geladen
- SAP-Originalwerte bleiben erhalten; Lernbasis/Forecast verwenden die Master-Zuordnung
- automatische Abteilungstrennung: `BAKE OFF` / `TK-BAKE OFF` -> YBA, übrige Marktbäckerei -> YBB

Beispiel: Cappuccino Groß aus einer falschen TK-Kleingebäck-Gruppe nach `GASTRONOMIE MARKTKÜCHE / HEIßGETRÄNKE (MARKTKÜCHE)` verschieben und einmal speichern.

## Vercel

Die bestehende Environment Variable `GOOGLE_SERVICE_ACCOUNT_JSON` bleibt unverändert. Nach dem GitHub-Commit deployt Vercel automatisch.

## Nächste Phase

Sortimentsauswahl je Markt/Abteilung/KW, danach Forecast, Produktionsplan und Bestellung.


## V3.1 – Fix für HTTP 413

Große SAP-Importe werden beim Speichern nicht mehr als ein einzelner Request übertragen.
Die App teilt die normalisierten Tagesdaten automatisch in Blöcke zu 300 Datensätzen.

Drive-Struktur je Planwoche:

- `lernbase.json` – Manifest, Bericht und Masterentscheidungen
- `facts_0001.json`
- `facts_0002.json`
- usw.

Der Nutzer klickt weiterhin nur einmal auf **In Google Drive als Lernbasis speichern**.
Die Oberfläche zeigt dabei den Fortschritt `Speichere X von Y Datensätzen`.
Erst wenn alle Datenblöcke vorhanden sind, wird das Manifest auf `status: complete` gesetzt.
