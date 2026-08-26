const { google } = require("googleapis");

const FOLDER_MIME = "application/vnd.google-apps.folder";
const ROOT_NAME = process.env.GOOGLE_DRIVE_ROOT_FOLDER_NAME || "Forecast-App";

function serviceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON fehlt in Vercel.");
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) { throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON ist kein gültiges JSON."); }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error("Service-Account JSON ist unvollständig.");
  }
  return parsed;
}

function driveClient() {
  const sa = serviceAccount();
  const auth = new google.auth.GoogleAuth({
    credentials: sa,
    scopes: ["https://www.googleapis.com/auth/drive"]
  });
  return google.drive({ version: "v3", auth });
}

function escQ(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function findRoot(drive) {
  if (process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID) {
    const id = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
    const r = await drive.files.get({ fileId: id, fields: "id,name,mimeType,trashed" });
    if (r.data.trashed || r.data.mimeType !== FOLDER_MIME) throw new Error("GOOGLE_DRIVE_ROOT_FOLDER_ID ist kein gültiger Ordner.");
    return r.data;
  }
  const q = `name='${escQ(ROOT_NAME)}' and mimeType='${FOLDER_MIME}' and trashed=false`;
  const r = await drive.files.list({
    q,
    fields: "files(id,name,parents)",
    spaces: "drive",
    pageSize: 20
  });
  const files = r.data.files || [];
  if (files.length === 0) throw new Error(`Freigegebener Google-Drive-Ordner '${ROOT_NAME}' wurde nicht gefunden.`);
  if (files.length > 1) throw new Error(`Mehrere Ordner namens '${ROOT_NAME}' gefunden. Bitte GOOGLE_DRIVE_ROOT_FOLDER_ID in Vercel hinterlegen.`);
  return files[0];
}

async function ensureFolder(drive, parentId, name) {
  const q = `name='${escQ(name)}' and '${escQ(parentId)}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`;
  const r = await drive.files.list({ q, fields: "files(id,name)", pageSize: 10 });
  if ((r.data.files || []).length) return r.data.files[0];
  const created = await drive.files.create({
    requestBody: { name, mimeType: FOLDER_MIME, parents: [parentId] },
    fields: "id,name"
  });
  return created.data;
}

async function upsertJson(drive, parentId, fileName, data) {
  const q = `name='${escQ(fileName)}' and '${escQ(parentId)}' in parents and trashed=false`;
  const r = await drive.files.list({ q, fields: "files(id,name)", pageSize: 10 });
  const media = { mimeType: "application/json", body: JSON.stringify(data, null, 2) };
  if ((r.data.files || []).length) {
    const id = r.data.files[0].id;
    const updated = await drive.files.update({ fileId: id, media, fields: "id,name,modifiedTime" });
    return { mode: "updated", file: updated.data };
  }
  const created = await drive.files.create({
    requestBody: { name: fileName, parents: [parentId], mimeType: "application/json" },
    media,
    fields: "id,name,createdTime"
  });
  return { mode: "created", file: created.data };
}

function cleanSegment(v, fallback) {
  const s = String(v == null ? "" : v).trim().toUpperCase();
  return (s || fallback).replace(/[\/\\:*?"<>|]/g, "-").slice(0, 80);
}

module.exports = async function handler(req, res) {
  try {
    const drive = driveClient();
    const root = await findRoot(drive);

    if (req.method === "GET") {
      const sa = serviceAccount();
      return res.status(200).json({
        ok: true,
        rootFolderName: root.name,
        serviceAccount: sa.client_email
      });
    }

    if (req.method !== "POST") return res.status(405).json({ error: "Nur GET und POST erlaubt." });

    const body = req.body || {};
    if (body.action !== "saveSapSnapshot") return res.status(400).json({ error: "Unbekannte Aktion." });

    const market = cleanSegment(body.market, "UNBEKANNT");
    const department = cleanSegment(body.department, "UNBEKANNT");
    const year = String(Number(body.targetYear) || new Date().getFullYear());
    const week = String(Number(body.targetWeek) || 0).padStart(2, "0");

    const marketFolder = await ensureFolder(drive, root.id, market);
    const depFolder = await ensureFolder(drive, marketFolder.id, department);
    const sapFolder = await ensureFolder(drive, depFolder.id, "SAP");
    const yearFolder = await ensureFolder(drive, sapFolder.id, year);
    const weekFolder = await ensureFolder(drive, yearFolder.id, `Plan_KW${week}`);

    const snapshotName = "lernbase.json";
    const payload = {
      schemaVersion: 2,
      market,
      department,
      targetYear: Number(year),
      targetWeek: Number(week),
      sourceFileName: body.sourceFileName || null,
      uploadedAt: body.uploadedAt || new Date().toISOString(),
      report: body.report || {},
      masterDecisions: Array.isArray(body.masterDecisions) ? body.masterDecisions : [],
      dailyFacts: Array.isArray(body.dailyFacts) ? body.dailyFacts : []
    };

    const saved = await upsertJson(drive, weekFolder.id, snapshotName, payload);

    return res.status(200).json({
      ok: true,
      mode: saved.mode,
      path: `${root.name}/${market}/${department}/SAP/${year}/Plan_KW${week}/${snapshotName}`,
      rows: payload.dailyFacts.length
    });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || String(e) });
  }
};
