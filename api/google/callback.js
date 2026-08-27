const { google } = require("googleapis");
function esc(s){return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
module.exports = async function handler(req,res){
  try{
    const id=process.env.GOOGLE_CLIENT_ID;
    const secret=process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri=process.env.GOOGLE_REDIRECT_URI ||
      "https://bestelltool-rouge.vercel.app/api/google/callback";
    const oauth=new google.auth.OAuth2(id,secret,redirectUri);
    const code=req.query?.code;
    if(!code) throw new Error("OAuth-Code fehlt.");
    const {tokens}=await oauth.getToken(code);
    if(!tokens.refresh_token) throw new Error("Kein Refresh-Token erhalten. /api/google/connect erneut öffnen.");
    res.setHeader("Content-Type","text/html; charset=utf-8");
    res.status(200).send(`<!doctype html><meta charset="utf-8"><title>Google Drive verbunden</title>
    <body style="font-family:system-ui;max-width:760px;margin:60px auto;padding:20px">
    <h1>Google Drive verbunden</h1><p>Lege in Vercel eine geheime Variable an:</p>
    <p><b>Schlüssel:</b> GOOGLE_REFRESH_TOKEN</p><p><b>Wert:</b></p>
    <pre style="white-space:pre-wrap;word-break:break-all;padding:12px;background:#eee">${esc(tokens.refresh_token)}</pre>
    <p>Diesen Wert nicht in GitHub oder im Chat veröffentlichen. Danach neu deployen.</p></body>`);
  }catch(e){
    res.status(500).send(`<pre>${esc(e.message||String(e))}</pre>`);
  }
};
