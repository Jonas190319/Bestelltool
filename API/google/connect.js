const { google } = require("googleapis");

const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

module.exports = async function handler(req, res) {
  try {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri =
      process.env.GOOGLE_REDIRECT_URI ||
      "https://bestelltool-rouge.vercel.app/api/google/callback";

    if (!clientId) throw new Error("GOOGLE_CLIENT_ID fehlt in Vercel.");
    if (!clientSecret) throw new Error("GOOGLE_CLIENT_SECRET fehlt in Vercel.");

    const oauth2 = new google.auth.OAuth2(clientId, clientSecret, redirectUri);

    const url = oauth2.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: [DRIVE_SCOPE],
      include_granted_scopes: true,
    });

    res.redirect(302, url);
  } catch (e) {
    res.status(500).send(String(e.message || e));
  }
};
