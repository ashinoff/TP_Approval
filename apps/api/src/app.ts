import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import { z } from 'zod';
import pg from 'pg';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { verifier, type AuthConfig } from './auth.js';
import { transaction, HttpError, requireValue, type DB } from './db.js';
import { audit, command, lockAct, role, revision, submit, decide, closeCollection,notify } from './workflow.js';
import { validateDocx, antivirus } from './files.js';
import {approvalMatrix} from './matrix.js';
import {registry,registryAct,registryCounts} from './registry.js';
import {timeline} from './timeline.js';
import {preview,createRemark,compareVersions} from './documents.js';
import {documentKinds,documentFilename,contractDocuments,registerDocument,selectTechnicalConditions,tuPreview} from './contract-documents.js';
import {checkTechnicalConditions,confirmTuFinding,enforceTechnicalConditions} from './tu-validation.js';
import {RULES_VERSION} from './tu-rules.js';
import {extractTuMetadata} from './tu-import.js';
import {requireContractNumber} from './contract-number.js';
import {cardFields,cardValues,saveCard,cardFromTu,createCardField,updateCardField} from './card.js';
import {documentModel} from './documents.js';
import {prepareTu} from './prepare-tu.js';
import {localAuth,listLocalUsers,createLocalUser,updateLocalAccess,addLocalRole,updateLocalProfile,deleteLocalUser} from './local-auth.js';

export type AppConfig = {storagePath:string;maxFileBytes:number;production:boolean;clamavHost?:string;clamavPort?:number;webPath?:string;trustProxyHops?:number} &
  ((AuthConfig & {authMode?:'keycloak';platformOrigin:string}) | {authMode:'local';appOrigin?:string});
const id=z.string().uuid();
const text=z.string().trim().min(1).max(2000);
const expected=z.number().int().nonnegative();
const createAct=z.object({resId:id,contractNumber:text,contractDate:z.iso.date().nullable(),actNumber:text,applicant:z.string().trim().max(2000),address:z.string().trim().max(2000),actType:z.enum(['ACT_TP','AVTU']).default('ACT_TP')}).strict();
const myTasks=async(db:DB)=>(await db.query("SELECT t.*,app.task_role(t.role,t.cycle_id) AS role,a.act_number,a.contract_number,a.applicant,a.res_id,a.state AS act_state,(t.due_at<now()) AS overdue FROM app.tasks t JOIN app.acts a ON a.id=t.act_id WHERE app.task_user(t.assignment_id,t.assignee_id)=app.uid() AND t.status='OPEN' AND app.has_role(app.task_role(t.role,t.cycle_id),a.res_id) ORDER BY t.due_at")).rows;
const myBadge=async(db:DB)=>({count:Number((await db.query("SELECT count(DISTINCT t.act_id) FROM app.tasks t JOIN app.acts a ON a.id=t.act_id WHERE app.task_user(t.assignment_id,t.assignee_id)=app.uid() AND t.status='OPEN' AND app.has_role(app.task_role(t.role,t.cycle_id),a.res_id)")).rows[0].count)});
const myNotifications=async(db:DB)=>(await db.query("SELECT n.*,a.act_number,a.contract_number,CASE WHEN n.type='RETURNED' THEN (SELECT c.id FROM app.comments c WHERE c.act_id=n.act_id AND c.created_at<=n.created_at ORDER BY c.created_at DESC,c.id LIMIT 1) END AS comment_id FROM app.notifications n JOIN app.acts a ON a.id=n.act_id ORDER BY n.created_at DESC LIMIT 100")).rows;
export function createApp(pool:pg.Pool, config:AppConfig, verify?:ReturnType<typeof verifier>) {
  const standalone=config.authMode==='local'?localAuth(pool,config):undefined;
  const verifyToken=config.authMode==='local'?undefined:verify??verifier(config);
  const scan=async(buffer:Buffer)=>{
    if(config.production&&!config.clamavHost)throw new HttpError(503,'SCANNER_NOT_CONFIGURED','Загрузка документов недоступна: администратору нужно подключить антивирус.');
    await antivirus(buffer,config.clamavHost,config.clamavPort);
  };
  const app=express(); app.disable('x-powered-by');
  if(config.trustProxyHops)app.set('trust proxy',config.trustProxyHops);
  app.use(helmet({contentSecurityPolicy:{directives:{frameAncestors:[config.authMode==='local'?"'self'":config.platformOrigin]}},frameguard:false}));
  app.use(cors({origin:config.authMode==='local'?false:config.platformOrigin,allowedHeaders:['Authorization','Content-Type','Idempotency-Key'],methods:['GET','POST','OPTIONS']}));
  const rateMessage={error:{code:'RATE_LIMITED',message:'Слишком много запросов. Подождите минуту и обновите данные.'}};
  app.use(rateLimit({windowMs:60000,limit:600,standardHeaders:'draft-7',legacyHeaders:false,message:rateMessage}));
  app.use(express.json({limit:'256kb'}));
  app.use((req,res,next)=>{res.locals.requestId=randomUUID();res.setHeader('X-Request-Id',res.locals.requestId);res.setHeader('Cache-Control','no-store');next();});
  app.get('/health',(_req,res)=>res.json({status:'ok'}));
  app.get('/ready',async(_req,res)=>{try{await pool.query('SELECT id FROM app.res_units LIMIT 1');res.json({status:'ready',uploadsConfigured:!config.production||!!config.clamavHost});}catch{res.status(503).json({status:'unavailable'});}});
  if(standalone)standalone.install(app);
  else app.get('/auth/session',(_req,res)=>res.json({mode:'keycloak',authenticated:false}));
  app.use('/api',async(req,res,next)=>{
    try {
      if(standalone)res.locals.userId=await standalone.authenticate(req);
      else {
        const identity=await verifyToken!(req.headers.authorization);
        const found=await pool.query('SELECT app.resolve_identity($1,$2) AS id',[identity.issuer,identity.subject]);
        res.locals.userId=requireValue(found.rows[0].id,403,'USER_NOT_PROVISIONED');
      }
      next();
    }catch(e){next(e);}
  });
  app.use('/api',rateLimit({windowMs:60000,limit:180,keyGenerator:(_req,res)=>String(res.locals.userId),standardHeaders:'draft-7',legacyHeaders:false,message:rateMessage}));
  const get=(path:string,fn:(db:DB,req:express.Request)=>Promise<unknown>,readSnapshot=false)=>app.get(path,async(req,res)=>res.json(await transaction(pool,res.locals.userId,db=>fn(db,req),readSnapshot)));
  const post=(path:string,fn:(db:DB,req:express.Request)=>Promise<unknown>)=>app.post(path,async(req,res)=>{
    const result=await transaction(pool,res.locals.userId,db=>command(db,req.path,req.header('Idempotency-Key'),req.body,()=>fn(db,req)));res.json(result);
  });
  get('/api/v1/me',async db=>(await db.query('SELECT app.my_profile() AS profile')).rows[0].profile);
  get('/api/v1/res',async db=>(await db.query('SELECT * FROM app.res_units ORDER BY code')).rows);
  if(standalone){
    get('/api/v1/admin/local-users',listLocalUsers);
    // Password-bearing requests must not enter command(): its fast request digest
    // would provide a second, weaker offline password-verification target.
    app.post('/api/v1/admin/local-users',async(req,res)=>res.json(await transaction(pool,res.locals.userId,db=>createLocalUser(db,req.body))));
    app.post('/api/v1/admin/local-users/:id/access',async(req,res)=>res.json(await transaction(pool,res.locals.userId,db=>updateLocalAccess(db,id.parse(req.params.id),req.body))));
    post('/api/v1/admin/local-users/:id/roles',(db,req)=>addLocalRole(db,id.parse(req.params.id),req.body));
    post('/api/v1/admin/local-users/:id/profile',(db,req)=>updateLocalProfile(db,id.parse(req.params.id),req.body));
    post('/api/v1/admin/local-users/:id/delete',(db,req)=>deleteLocalUser(db,id.parse(req.params.id),req.body));
  }
  get('/api/v1/registry',async(db,req)=>registry(db,req.query));
  get('/api/v1/registry-counts',async db=>registryCounts(db));
  get('/api/v1/workspace-state',async db=>({tasks:await myTasks(db),notifications:await myNotifications(db),badge:await myBadge(db),counts:await registryCounts(db)}),true);
  get('/api/v1/error-categories',async db=>(await db.query('SELECT * FROM app.error_categories ORDER BY name')).rows);
  post('/api/v1/admin/error-categories',async(db,req)=>{
    await role(db,'TECH_ADMIN');const b=z.object({id:id.optional(),name:z.string().trim().min(1).max(200),active:z.boolean()}).strict().parse(req.body);
    return (await db.query('SELECT app.admin_error_category($1,$2,$3) AS category',[b.id??null,b.name,b.active])).rows[0].category;
  });
  get('/api/v1/acts/:id/versions/:versionId/preview',async(db,req)=>preview(db,config.storagePath,id.parse(req.params.id),id.parse(req.params.versionId)));
  post('/api/v1/acts/:id/comments',async(db,req)=>createRemark(db,config.storagePath,id.parse(req.params.id),req.body));
  get('/api/v1/acts/:id/compare',async(db,req)=>compareVersions(db,config.storagePath,id.parse(req.params.id),id.parse(req.query.from),id.parse(req.query.to)));
  get('/api/v1/acts/:id/technical-conditions/:tuId/preview',async(db,req)=>tuPreview(db,config.storagePath,id.parse(req.params.id),id.parse(req.params.tuId)));
  post('/api/v1/acts/:id/technical-conditions/select',async(db,req)=>{const b=z.object({technicalConditionsId:id,expectedRevision:expected}).strict().parse(req.body);return selectTechnicalConditions(db,id.parse(req.params.id),b.technicalConditionsId,b.expectedRevision);});
  get('/api/v1/acts/:id/presentation',async(db,req)=>registryAct(db,id.parse(req.params.id)));
  get('/api/v1/acts/:id/timeline',async(db,req)=>timeline(db,id.parse(req.params.id)));
  get('/api/v1/admin/directory',async db=>(await db.query('SELECT app.admin_directory() AS data')).rows[0].data);
  post('/api/v1/admin/users',async(db,req)=>{
    const b=z.object({issuer:z.url(),subject:text,name:text,role:z.enum(['RIRU_ENGINEER','RIRU_HEAD','RES_HEAD','SUE','STP','GI','TECH_ADMIN','PROCESS_ADMIN']),resId:id.nullable()}).strict().parse(req.body);
    await role(db,'TECH_ADMIN');return (await db.query('SELECT app.admin_user($1,$2,$3,$4,$5) AS id',[b.issuer,b.subject,b.name,b.role,b.resId])).rows[0];
  });
  post('/api/v1/admin/substitutions',async(db,req)=>{
    const b=z.object({roleId:id,substituteId:id,startsAt:z.iso.datetime(),endsAt:z.iso.datetime()}).strict().parse(req.body);
    return (await db.query('SELECT app.admin_substitute($1,$2,$3,$4) AS id',[b.roleId,b.substituteId,b.startsAt,b.endsAt])).rows[0];
  });
  const calendarAdmin=async(db:DB)=>{if(!(await db.query("SELECT app.has_role('PROCESS_ADMIN') OR app.has_role('TECH_ADMIN') AS yes")).rows[0].yes)throw new HttpError(403,'ROLE_REQUIRED');};
  get('/api/v1/card-fields',async(db,req)=>{const all=req.query.all==='1';if(all)await calendarAdmin(db);return cardFields(db,all);});
  post('/api/v1/admin/card-fields',async(db,req)=>{await calendarAdmin(db);return createCardField(db,req.body);});
  post('/api/v1/admin/card-fields/:code',async(db,req)=>{await calendarAdmin(db);return updateCardField(db,z.string().max(41).parse(req.params.code),req.body);});
  post('/api/v1/acts/:id/card',async(db,req)=>saveCard(db,id.parse(req.params.id),req.body));
  post('/api/v1/acts/:id/card/from-tu',async(db,req)=>cardFromTu(db,config.storagePath,id.parse(req.params.id)));
  get('/api/v1/admin/calendar',async(db,req)=>{
    await calendarAdmin(db);const year=z.coerce.number().int().min(2000).max(2100).parse(req.query.year);
    return (await db.query("SELECT day::text,working,source,revision FROM app.calendar_days WHERE day>=make_date($1,1,1) AND day<make_date($1+1,1,1) ORDER BY day",[year])).rows;
  });
  post('/api/v1/admin/calendar',async(db,req)=>{
    const b=z.object({days:z.array(z.object({day:z.iso.date(),working:z.boolean(),source:text}).strict()).min(1).max(800)}).strict().parse(req.body);
    await calendarAdmin(db);await db.query('SELECT app.admin_calendar($1)',[JSON.stringify(b.days)]);return {updated:b.days.length};
  });
  post('/api/v1/admin/deadline-policies',async(db,req)=>{
    const b=z.object({role:z.enum(['RIRU_HEAD','RES_HEAD','SUE','STP','GI','RIRU_ENGINEER']),workingDays:z.number().int().min(1).max(90)}).strict().parse(req.body);
    await role(db,'PROCESS_ADMIN');return (await db.query('SELECT app.admin_policy($1,$2) AS id',[b.role,b.workingDays])).rows[0];
  });
  post('/api/v1/admin/run-deadlines',async(db)=>{
    const rows=await db.query("SELECT t.*,a.res_id,p.warning_hours FROM app.tasks t JOIN app.acts a ON a.id=t.act_id JOIN app.deadline_policies p ON p.id=t.policy_id WHERE t.status='OPEN' AND t.due_at<=now()+make_interval(hours=>p.warning_hours) ORDER BY t.act_id,t.id");
    let emitted=0;
    for(const t of rows.rows){
      await role(db,'PROCESS_ADMIN',t.res_id);
      const overdue=new Date(t.due_at)<new Date();
      const assignee=(await db.query('SELECT app.task_user($1,$2) AS id',[t.assignment_id,t.assignee_id])).rows[0].id;
      const recipients=[{id:assignee,type:overdue?'OVERDUE':'WARNING'}];
      if(overdue){const admins=await db.query("SELECT id FROM app.candidates('PROCESS_ADMIN',$1)",[t.res_id]);for(const a of admins.rows)recipients.push({id:a.id,type:'ESCALATION'});}
      for(const recipient of recipients){
        const event=await db.query('INSERT INTO app.deadline_events(task_id,act_id,recipient_id,type,due_at) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id',[t.id,t.act_id,recipient.id,recipient.type,t.due_at]);
        if(event.rowCount){await notify(db,t.act_id,recipient.id,recipient.type);emitted++;}
      }
    }
    return {emitted};
  });
  get('/api/v1/acts/:id/deadline-events',async(db,req)=>{
    const a=requireValue((await db.query('SELECT * FROM app.acts WHERE id=$1',[id.parse(req.params.id)])).rows[0]);await role(db,'PROCESS_ADMIN',a.res_id);
    return (await db.query('SELECT * FROM app.deadline_events WHERE act_id=$1 ORDER BY created_at',[a.id])).rows;
  });
  get('/api/v1/acts',async(db,req)=>{
    const limit=z.coerce.number().int().min(1).max(100).default(50).parse(req.query.limit);
    return (await db.query("SELECT a.*,(SELECT min(t.due_at) FROM app.tasks t WHERE t.act_id=a.id AND t.status='OPEN') AS due_at,EXISTS(SELECT 1 FROM app.tasks t WHERE t.act_id=a.id AND t.status='OPEN' AND t.due_at<now()) AS overdue FROM app.acts a WHERE ($1::uuid IS NULL OR a.res_id=$1) ORDER BY a.created_at DESC,a.id LIMIT $2",[req.query.resId?id.parse(req.query.resId):null,limit])).rows;
  });
  post('/api/v1/acts',async(db,req)=>{
    const b=createAct.parse(req.body);await role(db,'RIRU_ENGINEER',b.resId);
    const contractNumber=requireContractNumber(b.contractNumber),actNumber=b.actNumber===b.contractNumber?contractNumber:b.actNumber;
    const act=(await db.query('INSERT INTO app.acts(res_id,author_id,contract_number,contract_date,act_number,applicant,address,act_type) VALUES($1,app.uid(),$2,$3,$4,$5,$6,$7) RETURNING *',[b.resId,contractNumber,b.contractDate,actNumber,b.applicant,b.address,b.actType])).rows[0];
    await audit(db,act.id,'CREATED');return act;
  });
  // Участники документа (автор, исполнители задач, согласовавшие, авторы замечаний): ФИО и должность для листа согласования.
  get('/api/v1/acts/:id/people',async(db,req)=>{
    const act=requireValue((await db.query('SELECT id,author_id FROM app.acts WHERE id=$1',[id.parse(req.params.id)])).rows[0]);
    return (await db.query(`SELECT DISTINCT ON (u) u AS id,app.act_user_label($1,u) AS label FROM (SELECT $2::uuid AS u UNION SELECT assignee_id FROM app.tasks WHERE act_id=$1
      UNION SELECT d.actor_id FROM app.decisions d JOIN app.tasks t ON t.id=d.task_id WHERE t.act_id=$1 UNION SELECT author_id FROM app.comments WHERE act_id=$1
      UNION SELECT created_by FROM app.versions WHERE act_id=$1) people WHERE u IS NOT NULL`,[act.id,act.author_id])).rows.map(r=>({id:r.id,name:r.label?.name??null,position:r.label?.position??null}));
  },true);
  get('/api/v1/acts/:id/approval-matrix',async(db,req)=>approvalMatrix(db,id.parse(req.params.id),req.query.cycleId===undefined?undefined:id.parse(req.query.cycleId)));
  get('/api/v1/acts/:id',async(db,req)=>{
    const act=requireValue((await db.query('SELECT * FROM app.acts WHERE id=$1',[id.parse(req.params.id)])).rows[0]);
    const versions=(await db.query('SELECT * FROM app.versions WHERE act_id=$1 ORDER BY number',[act.id])).rows;
    const cycles=(await db.query('SELECT * FROM app.cycles WHERE act_id=$1 ORDER BY number',[act.id])).rows;
    const tasks=(await db.query('SELECT t.*,app.task_role(t.role,t.cycle_id) AS role,d.decision,d.reason,d.actor_name FROM app.tasks t LEFT JOIN app.decisions d ON d.task_id=t.id WHERE t.act_id=$1 ORDER BY t.received_at',[act.id])).rows;
    const comments=(await db.query('SELECT c.*,coalesce(c.author_snapshot->>\'name\',(SELECT actor_name FROM app.decisions WHERE task_id=c.task_id)) AS author_name,(SELECT role FROM app.tasks WHERE id=c.task_id) AS author_role,coalesce((SELECT jsonb_agg(e ORDER BY e.created_at,e.id) FROM app.comment_events e WHERE e.comment_id=c.id),\'[]\'::jsonb) AS events FROM app.comments c WHERE c.act_id=$1 ORDER BY c.created_at,c.id',[act.id])).rows;
    const releases=(await db.query('SELECT * FROM app.releases WHERE act_id=$1 ORDER BY published_at',[act.id])).rows;
    const checks=(await db.query("SELECT c.*,coalesce((SELECT jsonb_agg(jsonb_build_object('id',x.id,'field',x.field,'comment',x.comment,'actorId',x.actor_id,'actorName',x.actor_name,'createdAt',x.created_at) ORDER BY x.created_at) FROM app.tu_check_confirmations x WHERE x.check_id=c.id),'[]'::jsonb) AS confirmations FROM app.tu_checks c WHERE c.act_id=$1 ORDER BY c.created_at DESC,c.id DESC LIMIT 100",[act.id])).rows;
    return {...act,checks,checkRulesVersion:RULES_VERSION,card:await cardValues(db,act.id),contractDocuments:await contractDocuments(db,act),versions,cycles,tasks,comments,releases,presentation:await registryAct(db,act.id),timeline:await timeline(db,act.id)};
  },true);
  const upload=multer({storage:multer.memoryStorage(),limits:{fileSize:config.maxFileBytes,files:1,fields:4}});
  app.post('/api/v1/documents/extract-tu',upload.single('file'),async(req,res)=>{
    const area=id.parse(req.body.resId);
    await transaction(pool,res.locals.userId,db=>role(db,'RIRU_ENGINEER',area));
    const file=requireValue(req.file,422,'FILE_REQUIRED');
    await scan(file.buffer);
    const prepared=await prepareTu(file.buffer);
    const model=await documentModel(prepared.bytes);
    if(model.blocks.reduce((n,b)=>n+b.text.length,0)>200000)throw new HttpError(422,'DOCUMENT_TOO_LARGE');
    res.json({...extractTuMetadata(model.blocks),sha256:model.sha256,...(prepared.removedTemplateLinks?{preparedFile:{base64:prepared.bytes.toString('base64'),originalSha256:prepared.originalSha256,removedTemplateLinks:prepared.removedTemplateLinks},notice:'Удалена ссылка на локальный шаблон Word. Будет загружена безопасная копия ТУ; исходный файл на компьютере не изменён. Текст, таблицы, изображения и колонтитулы сохранены.'}:{})});
  });
  app.post('/api/v1/acts/:id/files',upload.single('file'),async(req,res)=>{
    const actId=id.parse(req.params.id);const file=requireValue(req.file,422,'FILE_REQUIRED');
    const meta=z.object({documentType:z.enum(['ACT_TP','AVTU','TU']).default('ACT_TP'),documentNumber:z.string().trim().max(200).optional(),documentDate:z.iso.date().optional()}).strict().parse(req.body);
    await transaction(pool,res.locals.userId,async db=>{const a=await lockAct(db,actId);await role(db,'RIRU_ENGINEER',a.res_id);if(!['DRAFT','RETURNED','REVISING'].includes(a.state))throw new HttpError(409,'INVALID_STATE');});
    // TU PDF support is deferred: reject explicitly rather than pretend it was checked.
    try{await validateDocx(file.buffer);}catch(e){if(e instanceof HttpError)throw e;throw new HttpError(415,'INVALID_DOCX');}
    await scan(file.buffer);
    const fileId=randomUUID();const dir=resolve(config.storagePath);await mkdir(dir,{recursive:true});
    await writeFile(resolve(dir,fileId),file.buffer,{flag:'wx',mode:0o600});
    const result=await transaction(pool,res.locals.userId,async db=>{
      const a=await lockAct(db,actId);await role(db,'RIRU_ENGINEER',a.res_id);if(!['DRAFT','RETURNED','REVISING'].includes(a.state)) throw new HttpError(409,'INVALID_STATE');
      const result=(await db.query("INSERT INTO app.files(id,act_id,sha256,size,kind,scan_status,created_by) VALUES($1,$2,$3,$4,$5,'READY',app.uid()) RETURNING *",[fileId,actId,createHash('sha256').update(file.buffer).digest('hex'),file.size,documentKinds[meta.documentType]])).rows[0];
      const technicalConditions=await registerDocument(db,a,fileId,meta.documentType,meta.documentNumber,meta.documentDate);
      await audit(db,actId,'FILE_UPLOADED',{fileId,validation:config.clamavHost?'STRUCTURE_AND_CLAMAV':'DEVELOPMENT_STRUCTURE_ONLY',documentType:meta.documentType});return {...result,documentType:meta.documentType,technicalConditions};
    });res.status(201).json(result);
  });
  app.get('/api/v1/files/:id/download',async(req,res)=>{
    const file=await transaction(pool,res.locals.userId,async db=>{const f=requireValue((await db.query("SELECT f.*,a.contract_number,(SELECT number FROM app.technical_conditions WHERE file_id=f.id) AS tu_number,(SELECT number FROM app.versions WHERE file_id=f.id ORDER BY number DESC LIMIT 1) AS version_number FROM app.files f JOIN app.acts a ON a.id=f.act_id WHERE f.id=$1 AND f.scan_status='READY'",[id.parse(req.params.id)])).rows[0]);await audit(db,f.act_id,'DOCUMENT_DOWNLOADED',{fileId:f.id});return f;});
    const bytes=await readFile(resolve(config.storagePath,file.id));
    if(createHash('sha256').update(bytes).digest('hex')!==file.sha256) throw new HttpError(500,'FILE_INTEGRITY_FAILURE');
    res.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document').attachment(documentFilename(file.kind,file.contract_number,file.tu_number??file.version_number)).send(bytes);
  });
  post('/api/v1/acts/:id/versions',async(db,req)=>{
    const b=z.object({fileId:id,expectedRevision:expected,technicalData:z.record(z.string(),z.unknown()).default({})}).strict().parse(req.body);
    const a=await lockAct(db,id.parse(req.params.id));revision(a,b.expectedRevision);await role(db,'RIRU_ENGINEER',a.res_id);
    if(!['DRAFT','RETURNED','REVISING'].includes(a.state)) throw new HttpError(409,'INVALID_STATE');
    const source=requireValue((await db.query("SELECT * FROM app.files WHERE id=$1 AND act_id=$2 AND scan_status='READY'",[b.fileId,a.id])).rows[0]);
    if(source.kind!==documentKinds[a.act_type as 'ACT_TP'|'AVTU'])throw new HttpError(422,'WRONG_DOCUMENT_TYPE','Для версии акта требуется файл выбранного вида: акт ТП или АВТУ, не ТУ.');
    const v=(await db.query('INSERT INTO app.versions(act_id,number,file_id,snapshot,created_by) SELECT $1,coalesce(max(number),0)+1,$2,$3,app.uid() FROM app.versions WHERE act_id=$1 RETURNING *',[a.id,b.fileId,JSON.stringify({actType:a.act_type,contractNumber:a.contract_number,contractDate:a.contract_date,actNumber:a.act_number,applicant:a.applicant,address:a.address,resId:a.res_id,technicalData:b.technicalData})])).rows[0];
    await db.query('UPDATE app.acts SET revision=revision+1 WHERE id=$1',[a.id]);await audit(db,a.id,'VERSION_CREATED',{versionId:v.id});return v;
  });
  post('/api/v1/acts/:id/check-tu',async(db,req)=>{const b=z.object({versionId:id,expectedRevision:expected}).strict().parse(req.body);return checkTechnicalConditions(db,config.storagePath,id.parse(req.params.id),b.versionId,b.expectedRevision);});
  post('/api/v1/acts/:id/check-tu/:checkId/confirm',async(db,req)=>{
    const b=z.object({field:z.string().trim().min(1).max(50),comment:z.string().trim().min(10).max(2000),expectedRevision:expected}).strict().parse(req.body);
    return confirmTuFinding(db,config.storagePath,id.parse(req.params.id),id.parse(req.params.checkId),b.field,b.comment,b.expectedRevision);
  });
  post('/api/v1/acts/:id/submit',async(db,req)=>{const b=z.object({versionId:id,expectedRevision:expected}).strict().parse(req.body);const actId=id.parse(req.params.id);const checkId=await enforceTechnicalConditions(db,config.storagePath,actId,b.versionId,b.expectedRevision);return submit(db,actId,b.versionId,b.expectedRevision,checkId);});
  post('/api/v1/tasks/:id/decision',async(db,req)=>{const b=z.object({decision:z.enum(['APPROVE','RETURN']),reason:z.string().trim().max(10000).default(''),versionId:id.optional()}).strict().parse(req.body);return decide(db,id.parse(req.params.id),b.decision,b.reason,b.versionId);});
  post('/api/v1/acts/:id/close-collection',async(db,req)=>{const b=z.object({reason:text}).strict().parse(req.body);return closeCollection(db,id.parse(req.params.id),b.reason);});
  post('/api/v1/acts/:id/revise',async(db,req)=>{
    const b=z.object({reason:text,expectedRevision:expected}).strict().parse(req.body);const a=await lockAct(db,id.parse(req.params.id));revision(a,b.expectedRevision);await role(db,'RIRU_ENGINEER',a.res_id);
    if(a.state!=='APPROVED')throw new HttpError(409,'INVALID_STATE');
    await db.query("UPDATE app.releases SET status='UNDER_REVISION' WHERE act_id=$1 AND status='CURRENT'",[a.id]);
    await db.query("UPDATE app.acts SET state='REVISING',revision=revision+1 WHERE id=$1",[a.id]);await audit(db,a.id,'REVISION_STARTED',{reason:b.reason});return {state:'REVISING'};
  });
  post('/api/v1/releases/:id/revoke',async(db,req)=>{
    const b=z.object({reason:text}).strict().parse(req.body);const r=requireValue((await db.query('SELECT * FROM app.releases WHERE id=$1',[id.parse(req.params.id)])).rows[0]);
    const a=await lockAct(db,r.act_id);await role(db,'PROCESS_ADMIN',a.res_id);
    await db.query("UPDATE app.releases SET status='REVOKED' WHERE id=$1",[r.id]);await audit(db,a.id,'RELEASE_REVOKED',{releaseId:r.id,reason:b.reason});return {status:'REVOKED'};
  });
  post('/api/v1/comments/:id/events',async(db,req)=>{
    const b=z.object({versionId:id,type:z.enum(['REPORTED_FIXED','VERIFIED','REOPENED']),explanation:text}).strict().parse(req.body);
    const c=requireValue((await db.query('SELECT * FROM app.comments WHERE id=$1',[id.parse(req.params.id)])).rows[0]);const a=await lockAct(db,c.act_id);
    const v=requireValue((await db.query('SELECT * FROM app.versions WHERE id=$1 AND act_id=$2',[b.versionId,a.id])).rows[0]);
    const original=(await db.query('SELECT number FROM app.versions WHERE id=$1',[c.version_id])).rows[0];if(v.number<=original.number)throw new HttpError(409,'NEW_VERSION_REQUIRED');
    if(b.type==='REPORTED_FIXED'){await role(db,'RIRU_ENGINEER',a.res_id);if(!['RETURNED','REVISING'].includes(a.state))throw new HttpError(409,'INVALID_STATE');}
    else {
      if(c.author_id!==(await db.query('SELECT app.uid() AS id')).rows[0].id)throw new HttpError(403,'COMMENT_AUTHOR_REQUIRED');
      const active=await db.query("SELECT t.role FROM app.tasks t JOIN app.cycles cy ON cy.id=t.cycle_id WHERE t.act_id=$1 AND cy.version_id=$2 AND app.task_user(t.assignment_id,t.assignee_id)=app.uid() AND t.status='OPEN'",[a.id,v.id]);
      if(!active.rowCount)throw new HttpError(409,'ACTIVE_REVIEW_REQUIRED');await role(db,active.rows[0].role,a.res_id);
      const reported=await db.query("SELECT 1 FROM app.comment_events WHERE comment_id=$1 AND version_id=$2 AND type='REPORTED_FIXED'",[c.id,v.id]);if(!reported.rowCount)throw new HttpError(409,'FIX_NOT_REPORTED');
    }
    const e=(await db.query('INSERT INTO app.comment_events(comment_id,act_id,actor_id,version_id,type,explanation) VALUES($1,$2,app.uid(),$3,$4,$5) RETURNING *',[c.id,a.id,v.id,b.type,b.explanation])).rows[0];await audit(db,a.id,'COMMENT_EVENT',{commentId:c.id,type:b.type});return e;
  });
  get('/api/v1/tasks/mine',myTasks);
  get('/api/platform/badge',myBadge);
  get('/api/v1/notifications',myNotifications);
  post('/api/v1/notifications/:id/read',async(db,req)=>requireValue((await db.query('UPDATE app.notifications SET read_at=coalesce(read_at,now()) WHERE id=$1 RETURNING *',[id.parse(req.params.id)])).rows[0]));
  if(config.webPath)app.use(express.static(resolve(config.webPath),{index:'index.html'}));
  app.use((_req,_res,next)=>next(new HttpError(404,'NOT_FOUND')));
  app.use((error:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{
    const sqlCode=(error as {code?:string})?.code;const inputStatus=(error as {status?:number})?.status;
    const status=error instanceof HttpError?error.status:error instanceof z.ZodError?422:error instanceof multer.MulterError?413:sqlCode==='42501'?403:sqlCode==='22023'||sqlCode==='23505'||sqlCode==='23514'?409:inputStatus===400?400:500;
    const code=error instanceof HttpError?error.code:error instanceof z.ZodError?'VALIDATION_ERROR':error instanceof multer.MulterError?'UPLOAD_LIMIT':status===403?'FORBIDDEN':status===409?'CONFLICT':status===400?'INVALID_JSON':'INTERNAL_ERROR';
    if(status===500)console.error({requestId:res.locals.requestId,code:(error as {code?:string}).code??'UNEXPECTED'});
    res.status(status).json({error:{code,message:error instanceof HttpError?error.message:error instanceof z.ZodError?'Некорректные данные запроса':code,requestId:res.locals.requestId}});
  });return app;
}
