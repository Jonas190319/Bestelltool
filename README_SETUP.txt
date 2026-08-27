BESTELLTOOL V3.4

Wichtig:
- Der Ordner heißt absichtlich api (klein).
- Bestehenden Repository-Inhalt durch den Inhalt DIESES Ordners ersetzen.
- Nicht den Oberordner Bestelltool_V3_4_Funktionierend zusätzlich hochladen.

Vercel Production Secrets:
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
GOOGLE_REFRESH_TOKEN

Optional:
GOOGLE_REDIRECT_URI=https://bestelltool-rouge.vercel.app/api/google/callback
GOOGLE_DRIVE_ROOT_FOLDER_NAME=Forecast-App
GOOGLE_DRIVE_ROOT_FOLDER_ID=<Ordner-ID>

Ersteinrichtung OAuth:
1. Deployen.
2. https://bestelltool-rouge.vercel.app/api/google/connect öffnen.
3. Google-Zugriff erlauben.
4. GOOGLE_REFRESH_TOKEN aus der Callback-Seite als Vercel Secret speichern.
5. Neu deployen.

Speicherung:
- Verkauf/Lernbasis: Markt + Abteilung + Jahr + KW; erneuter Upload ersetzt die Chunk-Dateien.
- Wareneingang-Backend: action=saveGoodsReceipt; erneuter Upload derselben Woche ersetzt goods_receipt.json.
- Stammdaten getrennt unter Forecast-App/Stammdaten.

Hinweis:
Die bestehende Oberfläche wurde übernommen. Der Backend-Endpunkt für Wareneingang ist enthalten;
die eigene Wareneingang-Uploadmaske muss im Frontend noch an das konkrete Excel-Layout angebunden werden.
