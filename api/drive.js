const { google } = require("googleapis");

const FOLDER_MIME = "application/vnd.google-apps.folder";
const ROOT_NAME = process.env.GOOGLE_DRIVE_ROOT_FOLDER_NAME || "Forecast-App";

function serviceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON fehlt in Vercel.");
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (e) { throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON ist kein gültiges JSON."); }
  if (!parsed.client_email || !parsed.private_key) throw new Error("Service-Account JSON ist unvollständig.");
  return parsed;
}

function driveClient() {
  const auth = new google.auth.GoogleAuth({credentials: serviceAccount(), scopes:["https://www.googleapis.com/auth/drive"]});
  return google.drive({version:"v3", auth});
}

function escQ(s){return String(s).replace(/\\/g,"\\\\").replace(/'/g,"\\'");}
function cleanSegment(v,fallback){const s=String(v==null?"":v).trim().toUpperCase();return (s||fallback).replace(/[\/\\:*?"<>|]/g,"-").slice(0,80);}

async function findRoot(drive){
  if(process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID){
    const r=await drive.files.get({fileId:process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID,fields:"id,name,mimeType,trashed"});
    if(r.data.trashed||r.data.mimeType!==FOLDER_MIME) throw new Error("GOOGLE_DRIVE_ROOT_FOLDER_ID ist kein gültiger Ordner.");
    return r.data;
  }
  const q=`name='${escQ(ROOT_NAME)}' and mimeType='${FOLDER_MIME}' and trashed=false`;
  const r=await drive.files.list({q,fields:"files(id,name,parents)",spaces:"drive",pageSize:20});
  const files=r.data.files||[];
  if(!files.length) throw new Error(`Freigegebener Google-Drive-Ordner '${ROOT_NAME}' wurde nicht gefunden.`);
  if(files.length>1) throw new Error(`Mehrere Ordner namens '${ROOT_NAME}' gefunden. Bitte GOOGLE_DRIVE_ROOT_FOLDER_ID in Vercel hinterlegen.`);
  return files[0];
}

async function findFolder(drive,parentId,name){
  const q=`name='${escQ(name)}' and '${escQ(parentId)}' in parents and mimeType='${FOLDER_MIME}' and trashed=false`;
  const r=await drive.files.list({q,fields:"files(id,name)",pageSize:10});
  return (r.data.files||[])[0]||null;
}
async function ensureFolder(drive,parentId,name){
  const found=await findFolder(drive,parentId,name); if(found)return found;
  const r=await drive.files.create({requestBody:{name,mimeType:FOLDER_MIME,parents:[parentId]},fields:"id,name"}); return r.data;
}
async function findJsonFile(drive,parentId,name){
  const q=`name='${escQ(name)}' and '${escQ(parentId)}' in parents and trashed=false`;
  const r=await drive.files.list({q,fields:"files(id,name)",pageSize:10}); return (r.data.files||[])[0]||null;
}
async function readJson(drive,fileId){
  const r=await drive.files.get({fileId,alt:"media"});
  if(typeof r.data==="object") return r.data;
  return JSON.parse(String(r.data||"{}"));
}
async function upsertJson(drive,parentId,fileName,data){
  const found=await findJsonFile(drive,parentId,fileName);
  const media={mimeType:"application/json",body:JSON.stringify(data,null,2)};
  if(found){const r=await drive.files.update({fileId:found.id,media,fields:"id,name,modifiedTime"});return{mode:"updated",file:r.data};}
  const r=await drive.files.create({requestBody:{name:fileName,parents:[parentId],mimeType:"application/json"},media,fields:"id,name,createdTime"});return{mode:"created",file:r.data};
}

async function masterFolder(drive,root,market,department,create){
  let f=create?await ensureFolder(drive,root.id,"Stammdaten"):await findFolder(drive,root.id,"Stammdaten"); if(!f)return null;
  f=create?await ensureFolder(drive,f.id,market):await findFolder(drive,f.id,market); if(!f)return null;
  f=create?await ensureFolder(drive,f.id,department):await findFolder(drive,f.id,department); return f||null;
}


async function snapshotWeekFolder(drive,root,market,department,targetYear,targetWeek){
  const year=String(Number(targetYear)||new Date().getFullYear());
  const week=String(Number(targetWeek)||0).padStart(2,"0");
  const marketFolder=await ensureFolder(drive,root.id,market);
  const depFolder=await ensureFolder(drive,marketFolder.id,department);
  const sapFolder=await ensureFolder(drive,depFolder.id,"SAP");
  const yearFolder=await ensureFolder(drive,sapFolder.id,year);
  const weekFolder=await ensureFolder(drive,yearFolder.id,`Plan_KW${week}`);
  return {year,week,weekFolder,path:`${root.name}/${market}/${department}/SAP/${year}/Plan_KW${week}`};
}

async function deleteOldChunkFiles(drive,parentId){
  const q=`'${escQ(parentId)}' in parents and trashed=false`;
  const r=await drive.files.list({q,fields:"files(id,name)",pageSize:1000});
  const files=(r.data.files||[]).filter(f=>/^facts_\d+\.json$/i.test(f.name));
  for(const f of files){
    await drive.files.delete({fileId:f.id});
  }
}

module.exports=async function handler(req,res){
  try{
    const drive=driveClient(); const root=await findRoot(drive);
    if(req.method==="GET"){
      const action=(req.query&&req.query.action)||"status";
      if(action==="status") return res.status(200).json({ok:true,rootFolderName:root.name,serviceAccount:serviceAccount().client_email});
      if(action==="masterdata"){
        const market=cleanSegment(req.query.market,"UNBEKANNT"), department=cleanSegment(req.query.department,"UNBEKANNT");
        const folder=await masterFolder(drive,root,market,department,false);
        if(!folder) return res.status(200).json({ok:true,records:[],path:`${root.name}/Stammdaten/${market}/${department}/masterdata.json`});
        const file=await findJsonFile(drive,folder.id,"masterdata.json");
        if(!file) return res.status(200).json({ok:true,records:[],path:`${root.name}/Stammdaten/${market}/${department}/masterdata.json`});
        const data=await readJson(drive,file.id);
        return res.status(200).json({ok:true,records:Array.isArray(data.records)?data.records:[],savedAt:data.savedAt||null,path:`${root.name}/Stammdaten/${market}/${department}/masterdata.json`});
      }
      return res.status(400).json({error:"Unbekannte GET-Aktion."});
    }
    if(req.method!=="POST") return res.status(405).json({error:"Nur GET und POST erlaubt."});
    const body=req.body||{}, action=body.action;
    const market=cleanSegment(body.market,"UNBEKANNT"), department=cleanSegment(body.department,"UNBEKANNT");

    if(action==="saveMasterData"){
      const folder=await masterFolder(drive,root,market,department,true);
      const records=(Array.isArray(body.records)?body.records:[]).map(r=>({...r,department}));
      const payload={schemaVersion:3,market,department,savedAt:body.savedAt||new Date().toISOString(),records};
      await upsertJson(drive,folder.id,"masterdata.json",payload);
      return res.status(200).json({ok:true,records:records.length,path:`${root.name}/Stammdaten/${market}/${department}/masterdata.json`});
    }

    if(action==="saveSapSnapshotInit"){
      const s=await snapshotWeekFolder(drive,root,market,department,body.targetYear,body.targetWeek);
      await deleteOldChunkFiles(drive,s.weekFolder.id);
      const manifest={
        schemaVersion:3.1,
        storageMode:"chunked",
        status:"uploading",
        uploadId:body.uploadId||null,
        market,
        department,
        targetYear:Number(s.year),
        targetWeek:Number(s.week),
        sourceFileName:body.sourceFileName||null,
        uploadedAt:body.uploadedAt||new Date().toISOString(),
        report:body.report||{},
        masterDecisions:Array.isArray(body.masterDecisions)?body.masterDecisions:[],
        masterDataVersion:body.masterDataVersion||3,
        totalRows:Number(body.totalRows)||0,
        totalChunks:Number(body.totalChunks)||0,
        completedChunks:0
      };
      await upsertJson(drive,s.weekFolder.id,"lernbase.json",manifest);
      return res.status(200).json({ok:true,path:`${s.path}/lernbase.json`,totalChunks:manifest.totalChunks});
    }

    if(action==="saveSapSnapshotChunk"){
      const s=await snapshotWeekFolder(drive,root,market,department,body.targetYear,body.targetWeek);
      const idx=Number(body.chunkIndex)||0;
      if(idx<1) return res.status(400).json({error:"Ungültiger Chunk-Index."});
      const rows=Array.isArray(body.rows)?body.rows:[];
      const fileName=`facts_${String(idx).padStart(4,"0")}.json`;
      await upsertJson(drive,s.weekFolder.id,fileName,{
        schemaVersion:3.1,
        uploadId:body.uploadId||null,
        chunkIndex:idx,
        rows
      });
      return res.status(200).json({ok:true,chunkIndex:idx,rows:rows.length,path:`${s.path}/${fileName}`});
    }

    if(action==="saveSapSnapshotFinalize"){
      const s=await snapshotWeekFolder(drive,root,market,department,body.targetYear,body.targetWeek);
      const manifestFile=await findJsonFile(drive,s.weekFolder.id,"lernbase.json");
      if(!manifestFile) return res.status(400).json({error:"Lernbasis-Manifest fehlt. Speicherung bitte erneut starten."});
      const manifest=await readJson(drive,manifestFile.id);

      const q=`'${escQ(s.weekFolder.id)}' in parents and trashed=false`;
      const listed=await drive.files.list({q,fields:"files(id,name)",pageSize:1000});
      const chunkFiles=(listed.data.files||[]).filter(f=>/^facts_\d+\.json$/i.test(f.name));
      const expected=Number(manifest.totalChunks)||0;
      if(chunkFiles.length!==expected){
        return res.status(409).json({error:`Speicherung unvollständig: ${chunkFiles.length} von ${expected} Datenblöcken vorhanden.`});
      }

      manifest.status="complete";
      manifest.completedAt=new Date().toISOString();
      manifest.completedChunks=chunkFiles.length;
      await upsertJson(drive,s.weekFolder.id,"lernbase.json",manifest);
      return res.status(200).json({
        ok:true,
        path:`${s.path}/lernbase.json`,
        rows:Number(manifest.totalRows)||0,
        chunks:chunkFiles.length
      });
    }

    // Rückwärtskompatibilität für kleine Datensätze/ältere Clients
    if(action==="saveSapSnapshot"){
      const s=await snapshotWeekFolder(drive,root,market,department,body.targetYear,body.targetWeek);
      const payload={schemaVersion:3,market,department,targetYear:Number(s.year),targetWeek:Number(s.week),sourceFileName:body.sourceFileName||null,uploadedAt:body.uploadedAt||new Date().toISOString(),report:body.report||{},masterDecisions:Array.isArray(body.masterDecisions)?body.masterDecisions:[],dailyFacts:Array.isArray(body.dailyFacts)?body.dailyFacts:[],masterDataVersion:body.masterDataVersion||3};
      await upsertJson(drive,s.weekFolder.id,"lernbase.json",payload);
      return res.status(200).json({ok:true,path:`${s.path}/lernbase.json`,rows:payload.dailyFacts.length});
    }
    return res.status(400).json({error:"Unbekannte Aktion."});
  }catch(e){console.error(e);return res.status(500).json({error:e.message||String(e)});}
};
