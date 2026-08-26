const { google } = require("googleapis");

const FOLDER_MIME = "application/vnd.google-apps.folder";
const ROOT_NAME = process.env.GOOGLE_DRIVE_ROOT_FOLDER_NAME || "Forecast-App";
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

function oauthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ||
    "https://bestelltool-rouge.vercel.app/api/google/callback";

  if (!clientId) throw new Error("GOOGLE_CLIENT_ID fehlt in Vercel.");
  if (!clientSecret) throw new Error("GOOGLE_CLIENT_SECRET fehlt in Vercel.");
  if (!refreshToken) {
    throw new Error(
      "GOOGLE_REFRESH_TOKEN fehlt. Öffne /api/google/connect und verbinde dein Google-Konto einmalig."
    );
  }

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
  if (process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID) {
    try {
      const r = await drive.files.get({
        fileId: process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID,
        fields: "id,name,mimeType,trashed",
      });
      if (r.data.trashed || r.data.mimeType !== FOLDER_MIME) {
        throw new Error("GOOGLE_DRIVE_ROOT_FOLDER_ID ist kein gültiger Ordner.");
      }
      return r.data;
    } catch (e) {
      throw new Error(
        "GOOGLE_DRIVE_ROOT_FOLDER_ID ist mit dem verbundenen Google-Konto nicht erreichbar. Entferne die Variable oder verwende einen Ordner, den dieses Konto besitzt."
      );
    }
  }

  const q = `name='${escQ(ROOT_NAME)}' and mimeType='${FOLDER_MIME}' and trashed=false`;
  const r = await drive.files.list({
    q,
    fields: "files(id,name,parents)",
    spaces: "drive",
    pageSize: 20,
  });
  const files = r.data.files || [];

  if (files.length > 1) {
    throw new Error(
      `Mehrere App-Ordner namens '${ROOT_NAME}' gefunden. Bitte GOOGLE_DRIVE_ROOT_FOLDER_ID in Vercel hinterlegen.`
    );
  }
  if (files.length === 1) return files[0];

  const created = await drive.files.create({
    requestBody: { name: ROOT_NAME, mimeType: FOLDER_MIME },
    fields: "id,name",
  });
  return created.data;
}

async function findFolder(drive, parentId, name) {
  const q = `name='${escQ(name)}' and '${escQ(parentId)}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`;
  const r = await drive.files.list({ q, fields: "files(id,name)", pageSize: 10 });
  return (r.data.files || [])[0] || null;
}

async function ensureFolder(drive, parentId, name) {
  const found = await findFolder(drive, parentId, name);
  if (found) return found;
  const r = await drive.files.create({
    requestBody: { name, mimeType: FOLDER_MIME, parents: [parentId] },
    fields: "id,name",
  });
  return r.data;
}

async function findJsonFile(drive, parentId, name) {
  const q = `name='${escQ(name)}' and '${escQ(parentId)}' in parents and trashed=false`;
  const r = await drive.files.list({ q, fields: "files(id,name)", pageSize: 10 });
  return (r.data.files || [])[0] || null;
}

async function readJson(drive, fileId) {
  const r = await drive.files.get({ fileId, alt: "media" });
  if (typeof r.data === "object") return r.data;
  return JSON.parse(String(r.data || "{}"));
}

async function upsertJson(drive, parentId, fileName, data) {
  const found = await findJsonFile(drive, parentId, fileName);
  const media = { mimeType: "application/json", body: JSON.stringify(data, null, 2) };

  if (found) {
    const r = await drive.files.update({
      fileId: found.id,
      media,
      fields: "id,name,modifiedTime",
    });
    return { mode: "updated", file: r.data };
  }

  const r = await drive.files.create({
    requestBody: { name: fileName, parents: [parentId], mimeType: "application/json" },
    media,
    fields: "id,name,createdTime",
  });
  return { mode: "created", file: r.data };
}

async function masterFolder(drive, root, market, department, create) {
  let f = create ? await ensureFolder(drive, root.id, "Stammdaten") : await findFolder(drive, root.id, "Stammdaten");
  if (!f) return null;
  f = create ? await ensureFolder(drive, f.id, market) : await findFolder(drive, f.id, market);
  if (!f) return null;
  f = create ? await ensureFolder(drive, f.id, department) : await findFolder(drive, f.id, department);
  return f || null;
}

async function snapshotWeekFolder(drive, root, market, department, targetYear, targetWeek) {
  const year = String(Number(targetYear) || new Date().getFullYear());
  const week = String(Number(targetWeek) || 0).padStart(2, "0");
  const marketFolder = await ensureFolder(drive, root.id, market);
  const depFolder = await ensureFolder(drive, marketFolder.id, department);
  const sapFolder = await ensureFolder(drive, depFolder.id, "SAP");
  const yearFolder = await ensureFolder(drive, sapFolder.id, year);
  const weekFolder = await ensureFolder(drive, yearFolder.id, `Plan_KW${week}`);
  return { year, week, weekFolder, path: `${root.name}/${market}/${department}/SAP/${year}/Plan_KW${week}` };
}

async function listFiles(drive, parentId) {
  const q = `'${escQ(parentId)}' in parents and trashed=false`;
  const r = await drive.files.list({ q, fields: "files(id,name,modifiedTime)", pageSize: 1000 });
  return r.data.files || [];
}

async function deleteMatchingFiles(drive, parentId, re) {
  const files = await listFiles(drive, parentId);
  for (const f of files.filter((x) => re.test(x.name))) {
    await drive.files.delete({ fileId: f.id });
  }
}

async function readChunkRecords(drive, parentId, re, fieldName) {
  const files = (await listFiles(drive, parentId))
    .filter((f) => re.test(f.name))
    .sort((a, b) => a.name.localeCompare(b.name));

  const out = [];
  for (const f of files) {
    const data = await readJson(drive, f.id);
    const rows = Array.isArray(data[fieldName]) ? data[fieldName] : [];
    out.push(...rows);
  }
  return { files, records: out };
}

module.exports = async function handler(req, res) {
  try {
    const drive = driveClient();
    const root = await findRoot(drive);

    if (req.method === "GET") {
      const action = (req.query && req.query.action) || "status";

      if (action === "status") {
        return res.status(200).json({
          ok: true,
          rootFolderName: root.name,
          authMode: "oauth-user",
          scope: DRIVE_SCOPE,
        });
      }

      if (action === "masterdata") {
        const market = cleanSegment(req.query.market, "UNBEKANNT");
        const department = cleanSegment(req.query.department, "UNBEKANNT");
        const folder = await masterFolder(drive, root, market, department, false);

        if (!folder) {
          return res.status(200).json({
            ok: true,
            records: [],
            path: `${root.name}/Stammdaten/${market}/${department}/masterdata.json`,
          });
        }

        const file = await findJsonFile(drive, folder.id, "masterdata.json");
        if (!file) {
          return res.status(200).json({
            ok: true,
            records: [],
            path: `${root.name}/Stammdaten/${market}/${department}/masterdata.json`,
          });
        }

        const data = await readJson(drive, file.id);
        return res.status(200).json({
          ok: true,
          records: Array.isArray(data.records) ? data.records : [],
          savedAt: data.savedAt || null,
          path: `${root.name}/Stammdaten/${market}/${department}/masterdata.json`,
        });
      }

      return res.status(400).json({ error: "Unbekannte GET-Aktion." });
    }

    if (req.method !== "POST") {
      return res.status(405).json({ error: "Nur GET und POST erlaubt." });
    }

    const body = req.body || {};
    const action = body.action;
    const market = cleanSegment(body.market, "UNBEKANNT");
    const department = cleanSegment(body.department, "UNBEKANNT");

    if (action === "saveMasterDataInit") {
      const folder = await masterFolder(drive, root, market, department, true);
      await deleteMatchingFiles(drive, folder.id, /^master_part_\d+\.json$/i);
      const manifest = {
        schemaVersion: 3.3,
        status: "uploading",
        uploadId: body.uploadId || null,
        market,
        department,
        savedAt: body.savedAt || new Date().toISOString(),
        totalRecords: Number(body.totalRecords) || 0,
        totalChunks: Number(body.totalChunks) || 0,
      };
      await upsertJson(drive, folder.id, "master_upload.json", manifest);
      return res.status(200).json({ ok: true, totalChunks: manifest.totalChunks });
    }

    if (action === "saveMasterDataChunk") {
      const folder = await masterFolder(drive, root, market, department, true);
      const idx = Number(body.chunkIndex) || 0;
      if (idx < 1) return res.status(400).json({ error: "Ungültiger Stammdaten-Block." });

      const records = (Array.isArray(body.records) ? body.records : []).map((r) => ({ ...r, department }));
      await upsertJson(drive, folder.id, `master_part_${String(idx).padStart(4, "0")}.json`, {
        schemaVersion: 3.3,
        uploadId: body.uploadId || null,
        chunkIndex: idx,
        records,
      });
      return res.status(200).json({ ok: true, chunkIndex: idx, records: records.length });
    }

    if (action === "saveMasterDataFinalize") {
      const folder = await masterFolder(drive, root, market, department, true);
      const manifestFile = await findJsonFile(drive, folder.id, "master_upload.json");
      if (!manifestFile) return res.status(400).json({ error: "Stammdaten-Upload wurde nicht initialisiert." });

      const manifest = await readJson(drive, manifestFile.id);
      const parts = await readChunkRecords(drive, folder.id, /^master_part_\d+\.json$/i, "records");

      if (parts.files.length !== Number(manifest.totalChunks || 0)) {
        return res.status(409).json({
          error: `Stammdaten unvollständig: ${parts.files.length} von ${manifest.totalChunks} Blöcken vorhanden.`,
        });
      }

      const payload = {
        schemaVersion: 3.3,
        market,
        department,
        savedAt: manifest.savedAt || new Date().toISOString(),
        records: parts.records,
      };
      await upsertJson(drive, folder.id, "masterdata.json", payload);
      await deleteMatchingFiles(drive, folder.id, /^(master_part_\d+|master_upload)\.json$/i);

      return res.status(200).json({
        ok: true,
        records: parts.records.length,
        path: `${root.name}/Stammdaten/${market}/${department}/masterdata.json`,
      });
    }

    if (action === "saveMasterData") {
      const folder = await masterFolder(drive, root, market, department, true);
      const records = (Array.isArray(body.records) ? body.records : []).map((r) => ({ ...r, department }));
      const payload = {
        schemaVersion: 3.3,
        market,
        department,
        savedAt: body.savedAt || new Date().toISOString(),
        records,
      };
      await upsertJson(drive, folder.id, "masterdata.json", payload);

      return res.status(200).json({
        ok: true,
        records: records.length,
        path: `${root.name}/Stammdaten/${market}/${department}/masterdata.json`,
      });
    }

    if (action === "saveSapSnapshotInit") {
      const s = await snapshotWeekFolder(drive, root, market, department, body.targetYear, body.targetWeek);

      const oldManifestFile = await findJsonFile(drive, s.weekFolder.id, "lernbase.json");
      let previous = null;
      if (oldManifestFile) {
        try { previous = await readJson(drive, oldManifestFile.id); } catch (_e) {}
      }

      await deleteMatchingFiles(drive, s.weekFolder.id, /^(facts_\d+|decisions_\d+)\.json$/i);

      const snapshotKey = body.snapshotKey || `${market}|${department}|${s.year}|KW${s.week}`;
      const revision = previous && Number(previous.revision) ? Number(previous.revision) + 1 : 1;

      const manifest = {
        schemaVersion: 3.3,
        storageMode: "chunked",
        duplicatePolicy: "replace_same_market_department_year_week",
        snapshotKey,
        revision,
        status: "uploading",
        uploadId: body.uploadId || null,
        market,
        department,
        targetYear: Number(s.year),
        targetWeek: Number(s.week),
        sourceFileName: body.sourceFileName || null,
        uploadedAt: body.uploadedAt || new Date().toISOString(),
        replacedPreviousSnapshot: Boolean(previous && previous.status === "complete"),
        previousCompletedAt: previous && previous.completedAt ? previous.completedAt : null,
        report: body.report || {},
        dedupe: body.dedupe || {},
        masterDataVersion: body.masterDataVersion || 3,
        totalRows: Number(body.totalRows) || 0,
        totalFactChunks: Number(body.totalFactChunks) || 0,
        totalDecisionChunks: Number(body.totalDecisionChunks) || 0,
        completedFactChunks: 0,
        completedDecisionChunks: 0,
      };

      await upsertJson(drive, s.weekFolder.id, "lernbase.json", manifest);

      return res.status(200).json({
        ok: true,
        path: `${s.path}/lernbase.json`,
        snapshotKey,
        revision,
        replacedPreviousSnapshot: manifest.replacedPreviousSnapshot,
      });
    }

    if (action === "saveSapDecisionChunk") {
      const s = await snapshotWeekFolder(drive, root, market, department, body.targetYear, body.targetWeek);
      const idx = Number(body.chunkIndex) || 0;
      if (idx < 1) return res.status(400).json({ error: "Ungültiger Entscheidungs-Block." });

      const decisions = Array.isArray(body.decisions) ? body.decisions : [];
      const fileName = `decisions_${String(idx).padStart(4, "0")}.json`;

      await upsertJson(drive, s.weekFolder.id, fileName, {
        schemaVersion: 3.3,
        uploadId: body.uploadId || null,
        chunkIndex: idx,
        decisions,
      });

      return res.status(200).json({
        ok: true,
        chunkIndex: idx,
        decisions: decisions.length,
        path: `${s.path}/${fileName}`,
      });
    }

    if (action === "saveSapSnapshotChunk") {
      const s = await snapshotWeekFolder(drive, root, market, department, body.targetYear, body.targetWeek);
      const idx = Number(body.chunkIndex) || 0;
      if (idx < 1) return res.status(400).json({ error: "Ungültiger Chunk-Index." });

      const rows = Array.isArray(body.rows) ? body.rows : [];
      const fileName = `facts_${String(idx).padStart(4, "0")}.json`;

      await upsertJson(drive, s.weekFolder.id, fileName, {
        schemaVersion: 3.3,
        uploadId: body.uploadId || null,
        chunkIndex: idx,
        rows,
      });

      return res.status(200).json({
        ok: true,
        chunkIndex: idx,
        rows: rows.length,
        path: `${s.path}/${fileName}`,
      });
    }

    if (action === "saveSapSnapshotFinalize") {
      const s = await snapshotWeekFolder(drive, root, market, department, body.targetYear, body.targetWeek);
      const manifestFile = await findJsonFile(drive, s.weekFolder.id, "lernbase.json");

      if (!manifestFile) {
        return res.status(400).json({
          error: "Lernbasis-Manifest fehlt. Speicherung bitte erneut starten.",
        });
      }

      const manifest = await readJson(drive, manifestFile.id);
      const files = await listFiles(drive, s.weekFolder.id);
      const factFiles = files.filter((f) => /^facts_\d+\.json$/i.test(f.name));
      const decisionFiles = files.filter((f) => /^decisions_\d+\.json$/i.test(f.name));
      const expectedFacts = Number(manifest.totalFactChunks) || 0;
      const expectedDecisions = Number(manifest.totalDecisionChunks) || 0;

      if (factFiles.length !== expectedFacts) {
        return res.status(409).json({
          error: `Speicherung unvollständig: ${factFiles.length} von ${expectedFacts} Datenblöcken vorhanden.`,
        });
      }

      if (decisionFiles.length !== expectedDecisions) {
        return res.status(409).json({
          error: `Produktentscheidungen unvollständig: ${decisionFiles.length} von ${expectedDecisions} Blöcken vorhanden.`,
        });
      }

      manifest.status = "complete";
      manifest.completedAt = new Date().toISOString();
      manifest.completedFactChunks = factFiles.length;
      manifest.completedDecisionChunks = decisionFiles.length;
      manifest.forecastWeight = 1;
      manifest.note = "Dieser Markt/Abteilung/Jahr/KW-Snapshot zählt unabhängig von der Upload-Anzahl genau einmal.";

      await upsertJson(drive, s.weekFolder.id, "lernbase.json", manifest);

      return res.status(200).json({
        ok: true,
        path: `${s.path}/lernbase.json`,
        snapshotKey: manifest.snapshotKey,
        revision: manifest.revision,
        replacedPreviousSnapshot: Boolean(manifest.replacedPreviousSnapshot),
        rows: Number(manifest.totalRows) || 0,
        chunks: factFiles.length,
      });
    }

    if (action === "saveSapSnapshot") {
      const s = await snapshotWeekFolder(drive, root, market, department, body.targetYear, body.targetWeek);
      const payload = {
        schemaVersion: 3.3,
        market,
        department,
        targetYear: Number(s.year),
        targetWeek: Number(s.week),
        sourceFileName: body.sourceFileName || null,
        uploadedAt: body.uploadedAt || new Date().toISOString(),
        report: body.report || {},
        masterDecisions: Array.isArray(body.masterDecisions) ? body.masterDecisions : [],
        dailyFacts: Array.isArray(body.dailyFacts) ? body.dailyFacts : [],
        masterDataVersion: body.masterDataVersion || 3,
      };

      await upsertJson(drive, s.weekFolder.id, "lernbase.json", payload);

      return res.status(200).json({
        ok: true,
        path: `${s.path}/lernbase.json`,
        rows: payload.dailyFacts.length,
      });
    }

    return res.status(400).json({ error: "Unbekannte Aktion." });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || String(e) });
  }
};
