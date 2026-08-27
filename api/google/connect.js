const { google } = require("googleapis");

module.exports = async function handler(req, res) {
  try {
    const id = process.env.GOOGLE_CLIENT_ID;
    const secret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI ||
      "https://bestelltool-rouge.vercel.app/api/google/callback";
    if (!id || !secret) throw new Error("GOOGLE_CLIENT_ID oder GOOGLE_CLIENT_SECRET fehlt.");
    const oauth = new google.auth.OAuth2(id, secret, redirectUri);
    const url = oauth.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: ["https://www.googleapis.com/auth/drive"]
    });
    res.redirect(302, url);
  } catch (e) {
    res.status(500).send(e.message || String(e));
  }
};
