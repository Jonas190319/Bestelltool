const { google } = require("googleapis");

const FOLDER_MIME = "application/vnd.google-apps.folder";
const ROOT_NAME = process.env.GOOGLE_DRIVE_ROOT_FOLDER_NAME || "Forecast-App";

function oauthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI ||
    "https://bestelltool-rouge.vercel.app/api/google/callback";

  if (!clientId) throw new Error("GOOGLE_CLIENT_ID fehlt in Vercel.");
  if (!clientSecret) throw new Error("GOOGLE_CLIENT_SECRET fehlt in Vercel.");
  if (!refreshToken) throw new Error(
    "GOOGLE_REFRESH_TOKEN fehlt. Öffne /api/google/connect und verbinde dein Google-Konto einmalig."
  );

  const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  auth.setCredentials({ refresh_token: refreshToken });
  return auth;
}

function driveClient() {
  return google.drive({ version: "v3", auth: oauthClient() });
}

function escQ(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}
function cleanSegment(v, fallback) {
  const s = String(v == null ? "" : v).trim().toUpperCase();
  return (s || fallback).replace(/[\/\\:*?"<>|]/g, "-").slice(0, 80);
}

async function findRoot(drive) {
  const configured = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;
  if (configured) {
    const r = await drive.files.get({
      fileId: configured,
      fields: "id,name,mimeType,trashed"
    });
    if (r.data.trashed || r.data.mimeType !== FOLDER_MIME)
      throw new Error("GOOGLE_DRIVE_ROOT_FOLDER_ID ist kein gültiger Ordner.");
    return r.data;
  }

  const q = `name='${escQ(ROOT_NAME)}' and mimeType='${FOLDER_MIME}' and trashed=false`;
  const r = await drive.files.list({
    q, fields: "files(id,name)", spaces: "drive", pageSize: 20
  });
  const files = r.data.files || [];
  if (files.length === 1) return files[0];
  if (files.length > 1)
    throw new Error(`Mehrere Ordner '${ROOT_NAME}' gefunden. GOOGLE_DRIVE_ROOT_FOLDER_ID setzen.`);

  const created = await drive.files.create({
    requestBody: { name: ROOT_NAME, mimeType: FOLDER_MIME },
    fields: "id,name"
  });
  return created.data;
}

async function findFolder(drive, parentId, name) {
  const q = `name='${escQ(name)}' and '${escQ(parentId)}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`;
  const r = await drive.files.list({ q, fields: "files(id,name)", pageSize: 10 });
  return (r.data.files || [])[0] || null;
}
async function ensureFolder(drive, parentId, name) {
  const f = await findFolder(drive, parentId, name);
  if (f) return f;
  const r = await drive.files.create({
    requestBody: { name, mimeType: FOLDER_MIME, parents: [parentId] },
    fields: "id,name"
  });
  return r.data;
}
async function findFile(drive, parentId, name) {
  const q = `name='${escQ(name)}' and '${escQ(parentId)}' in parents and trashed=false`;
  const r = await drive.files.list({ q, fields: "files(id,name)", pageSize: 10 });
  return (r.data.files || [])[0] || null;
}
async function readJson(drive, fileId) {
  const r = await drive.files.get({ fileId, alt: "media" });
  return typeof r.data === "object" ? r.data : JSON.parse(String(r.data || "{}"));
}
async function upsertJson(drive, parentId, name, data) {
  const old = await findFile(drive, parentId, name);
  const media = { mimeType: "application/json", body: JSON.stringify(data, null, 2) };
  if (old) {
    await drive.files.update({ fileId: old.id, media });
    return "updated";
  }
  await drive.files.create({
    requestBody: { name, parents: [parentId], mimeType: "application/json" },
    media
  });
  return "created";
}
async function listFiles(drive, parentId) {
  const q = `'${escQ(parentId)}' in parents and trashed=false`;
  const r = await drive.files.list({ q, fields: "files(id,name)", pageSize: 1000 });
  return r.data.files || [];
}
async function deleteMatching(drive, parentId, re) {
  for (const f of (await listFiles(drive, parentId)).filter(x => re.test(x.name)))
    await drive.files.delete({ fileId: f.id });
}
async function weekFolder(drive, root, market, department, year, week) {
  const y = String(Number(year) || new Date().getFullYear());
  const w = String(Number(week) || 0).padStart(2, "0");
  const m = await ensureFolder(drive, root.id, market);
  const d = await ensureFolder(drive, m.id, department);
  const sap = await ensureFolder(drive, d.id, "SAP");
  const yf = await ensureFolder(drive, sap.id, y);
  const wf = await ensureFolder(drive, yf.id, `Plan_KW${w}`);
  return { y, w, wf, path: `${root.name}/${market}/${department}/SAP/${y}/Plan_KW${w}` };
}
async function masterFolder(drive, root, market, department) {
  const s = await ensureFolder(drive, root.id, "Stammdaten");
  const m = await ensureFolder(drive, s.id, market);
  return ensureFolder(drive, m.id, department);
}

module.exports = async function handler(req, res) {
  try {
    const drive = driveClient();
    const root = await findRoot(drive);

    if (req.method === "GET") {
      const action = req.query?.action || "status";
      if (action === "status")
        return res.status(200).json({ ok: true, rootFolderName: root.name, authMode: "oauth-user" });

      if (action === "masterdata") {
        const market = cleanSegment(req.query.market, "UNBEKANNT");
        const department = cleanSegment(req.query.department, "UNBEKANNT");
        const f = await masterFolder(drive, root, market, department);
        const file = await findFile(drive, f.id, "masterdata.json");
        if (!file) return res.status(200).json({ ok: true, records: [] });
        const data = await readJson(drive, file.id);
        return res.status(200).json({ ok: true, records: data.records || [], savedAt: data.savedAt || null });
      }
      return res.status(400).json({ error: "Unbekannte GET-Aktion." });
    }

    if (req.method !== "POST")
      return res.status(405).json({ error: "Nur GET und POST erlaubt." });

    const b = req.body || {};
    const action = b.action;
    const market = cleanSegment(b.market, "UNBEKANNT");
    const department = cleanSegment(b.department, "UNBEKANNT");

    if (action === "saveMasterData") {
      const f = await masterFolder(drive, root, market, department);
      const records = Array.isArray(b.records) ? b.records : [];
      await upsertJson(drive, f.id, "masterdata.json", {
        schemaVersion: 3.4, market, department,
        savedAt: b.savedAt || new Date().toISOString(), records
      });
      return res.status(200).json({ ok: true, records: records.length });
    }

    if (action === "saveMasterDataInit") {
      const f = await masterFolder(drive, root, market, department);
      await deleteMatching(drive, f.id, /^master_part_\d+\.json$/i);
      await upsertJson(drive, f.id, "master_upload.json", {
        schemaVersion: 3.4, uploadId: b.uploadId || null,
        totalChunks: Number(b.totalChunks) || 0,
        savedAt: b.savedAt || new Date().toISOString()
      });
      return res.status(200).json({ ok: true });
    }

    if (action === "saveMasterDataChunk") {
      const f = await masterFolder(drive, root, market, department);
      const idx = Number(b.chunkIndex) || 0;
      if (idx < 1) return res.status(400).json({ error: "Ungültiger Stammdaten-Block." });
      await upsertJson(drive, f.id, `master_part_${String(idx).padStart(4,"0")}.json`, {
        uploadId: b.uploadId || null, chunkIndex: idx,
        records: Array.isArray(b.records) ? b.records : []
      });
      return res.status(200).json({ ok: true, chunkIndex: idx });
    }

    if (action === "saveMasterDataFinalize") {
      const f = await masterFolder(drive, root, market, department);
      const manifestFile = await findFile(drive, f.id, "master_upload.json");
      if (!manifestFile) return res.status(400).json({ error: "Stammdaten-Upload nicht initialisiert." });
      const manifest = await readJson(drive, manifestFile.id);
      const parts = (await listFiles(drive, f.id))
        .filter(x => /^master_part_\d+\.json$/i.test(x.name))
        .sort((a,b)=>a.name.localeCompare(b.name));
      if (parts.length !== Number(manifest.totalChunks || 0))
        return res.status(409).json({ error: `Stammdaten unvollständig: ${parts.length}/${manifest.totalChunks}` });
      const records = [];
      for (const p of parts) {
        const d = await readJson(drive, p.id);
        records.push(...(Array.isArray(d.records) ? d.records : []));
      }
      await upsertJson(drive, f.id, "masterdata.json", {
        schemaVersion: 3.4, market, department,
        savedAt: manifest.savedAt || new Date().toISOString(), records
      });
      await deleteMatching(drive, f.id, /^(master_part_\d+|master_upload)\.json$/i);
      return res.status(200).json({ ok: true, records: records.length });
    }

    if (action === "saveSapSnapshotInit") {
      const s = await weekFolder(drive, root, market, department, b.targetYear, b.targetWeek);
      const old = await findFile(drive, s.wf.id, "lernbase.json");
      let previous = null;
      if (old) try { previous = await readJson(drive, old.id); } catch {}
      await deleteMatching(drive, s.wf.id, /^(facts_\d+|decisions_\d+)\.json$/i);

      const manifest = {
        schemaVersion: 3.4,
        status: "uploading",
        duplicatePolicy: "replace_same_market_department_year_week",
        snapshotKey: `${market}|${department}|${s.y}|KW${s.w}`,
        revision: previous?.revision ? Number(previous.revision)+1 : 1,
        market, department, targetYear: Number(s.y), targetWeek: Number(s.w),
        sourceFileName: b.sourceFileName || null,
        uploadedAt: b.uploadedAt || new Date().toISOString(),
        totalRows: Number(b.totalRows) || 0,
        totalFactChunks: Number(b.totalFactChunks) || 0,
        totalDecisionChunks: Number(b.totalDecisionChunks) || 0,
        report: b.report || {}, dedupe: b.dedupe || {}
      };
      await upsertJson(drive, s.wf.id, "lernbase.json", manifest);
      return res.status(200).json({ ok: true, path: `${s.path}/lernbase.json`, revision: manifest.revision });
    }

    if (action === "saveSapSnapshotChunk" || action === "saveSapDecisionChunk") {
      const s = await weekFolder(drive, root, market, department, b.targetYear, b.targetWeek);
      const idx = Number(b.chunkIndex) || 0;
      if (idx < 1) return res.status(400).json({ error: "Ungültiger Block." });
      const isDecision = action === "saveSapDecisionChunk";
      const name = `${isDecision ? "decisions" : "facts"}_${String(idx).padStart(4,"0")}.json`;
      const payload = isDecision
        ? { chunkIndex: idx, decisions: Array.isArray(b.decisions) ? b.decisions : [] }
        : { chunkIndex: idx, rows: Array.isArray(b.rows) ? b.rows : [] };
      await upsertJson(drive, s.wf.id, name, payload);
      return res.status(200).json({ ok: true, chunkIndex: idx, path: `${s.path}/${name}` });
    }

    if (action === "saveSapSnapshotFinalize") {
      const s = await weekFolder(drive, root, market, department, b.targetYear, b.targetWeek);
      const mf = await findFile(drive, s.wf.id, "lernbase.json");
      if (!mf) return res.status(400).json({ error: "Lernbasis-Manifest fehlt." });
      const manifest = await readJson(drive, mf.id);
      const files = await listFiles(drive, s.wf.id);
      const facts = files.filter(x => /^facts_\d+\.json$/i.test(x.name)).length;
      const decisions = files.filter(x => /^decisions_\d+\.json$/i.test(x.name)).length;
      if (facts !== Number(manifest.totalFactChunks || 0))
        return res.status(409).json({ error: `Datenblöcke unvollständig: ${facts}/${manifest.totalFactChunks}` });
      if (decisions !== Number(manifest.totalDecisionChunks || 0))
        return res.status(409).json({ error: `Entscheidungsblöcke unvollständig: ${decisions}/${manifest.totalDecisionChunks}` });
      manifest.status = "complete";
      manifest.completedAt = new Date().toISOString();
      manifest.forecastWeight = 1;
      await upsertJson(drive, s.wf.id, "lernbase.json", manifest);
      return res.status(200).json({ ok: true, path: `${s.path}/lernbase.json`, revision: manifest.revision });
    }

    // Zusätzlicher Datentyp: Wareneingang. Derselbe Markt/Abteilung/Jahr/KW-Upload ersetzt den alten.
    if (action === "saveGoodsReceipt") {
      const s = await weekFolder(drive, root, market, department, b.targetYear, b.targetWeek);
      const rows = Array.isArray(b.rows) ? b.rows : [];
      await upsertJson(drive, s.wf.id, "goods_receipt.json", {
        schemaVersion: 3.4,
        dataType: "goods_receipt",
        duplicatePolicy: "replace_same_market_department_year_week",
        market, department, targetYear: Number(s.y), targetWeek: Number(s.w),
        sourceFileName: b.sourceFileName || null,
        uploadedAt: b.uploadedAt || new Date().toISOString(),
        rows
      });
      return res.status(200).json({ ok: true, rows: rows.length, path: `${s.path}/goods_receipt.json` });
    }

    return res.status(400).json({ error: "Unbekannte Aktion." });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || String(e) });
  }
};
