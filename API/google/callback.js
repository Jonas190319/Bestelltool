const { google } = require("googleapis");

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

module.exports = async function handler(req, res) {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri =
      process.env.GOOGLE_REDIRECT_URI ||
      "https://bestelltool-rouge.vercel.app/api/google/callback";

    if (!clientId) throw new Error("GOOGLE_CLIENT_ID fehlt in Vercel.");
    if (!clientSecret) throw new Error("GOOGLE_CLIENT_SECRET fehlt in Vercel.");

    if (req.query && req.query.error) {
      throw new Error(`Google OAuth abgebrochen: ${req.query.error}`);
    }

    const code = req.query && req.query.code;
    if (!code) throw new Error("OAuth-Code fehlt.");

    const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    const { tokens } = await oauth2.getToken(code);

    if (!tokens.refresh_token) {
      throw new Error(
        "Google hat keinen Refresh-Token geliefert. Öffne /api/google/connect erneut und bestätige den Zugriff nochmals."
      );
    }

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(200).send(`<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<title>Bestelltool – Google Drive verbunden</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:760px;margin:60px auto;padding:0 20px;line-height:1.5}
code{display:block;padding:14px;background:#f5f5f5;border:1px solid #ddd;border-radius:8px;word-break:break-all}
.ok{color:#08783e;font-weight:700}
.warn{color:#9a4f00}
</style>
</head>
<body>
<h1>Google Drive verbunden</h1>
<p class="ok">OAuth-Autorisierung war erfolgreich.</p>
<p>Lege in Vercel jetzt eine neue geheime Umgebungsvariable an:</p>
<p><strong>Schlüssel:</strong> GOOGLE_REFRESH_TOKEN</p>
<p><strong>Wert:</strong></p>
<code>${esc(tokens.refresh_token)}</code>
<p class="warn">Diesen Token nicht im Chat posten und nicht in GitHub speichern.</p>
<p>Danach Vercel neu deployen. Anschließend nutzt API/drive.js dein Google-Konto statt des Service Accounts.</p>
</body>
</html>`);
  } catch (e) {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.status(500).send(`<h1>OAuth-Fehler</h1><pre>${esc(e.message || String(e))}</pre>`);
  }
};
