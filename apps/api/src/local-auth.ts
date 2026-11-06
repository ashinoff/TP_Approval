import type express from 'express';
import type pg from 'pg';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { HttpError, transaction, requireValue, type DB } from './db.js';
import { hashPassword, checkPassword, PASSWORD_MIN } from './passwords.js';
import { role } from './workflow.js';

export const loginSchema=z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9._-]{2,63}$/);
export const passwordSchema=z.string().min(PASSWORD_MIN).max(128);
export const emailSchema=z.string().trim().toLowerCase().max(254).email();
const credentialSchema=z.object({login:loginSchema,password:z.string().min(1).max(128)}).strict();
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const csrf=(token:string)=>hash('tp-approval-csrf:'+token);
type Session={userId:string;mustChangePassword:boolean};
type LocalConfig={production:boolean;appOrigin?:string};

export function localAuth(pool:pg.Pool,config:LocalConfig) {
  const cookieName=config.production?'__Host-tp_session':'tp_session';
  const cookieOptions={httpOnly:true,secure:config.production,sameSite:'strict' as const,path:'/'};
  const dummy=hashPassword(randomBytes(32).toString('hex'));
  const cookie=(req:express.Request)=>{
    const value=req.headers.cookie?.split(';').map(p=>p.trim()).find(p=>p.startsWith(cookieName+'='))?.slice(cookieName.length+1);
    return value&&/^[a-f0-9]{64}$/.test(value)?value:undefined;
  };
  const origin=(req:express.Request)=>{
    let parsed:URL;
    try{parsed=new URL(req.get('Origin')??'');}catch{throw new HttpError(403,'ORIGIN_REQUIRED','Не удалось подтвердить адрес приложения. Обновите страницу или сообщите администратору.');}
    const allowed=config.appOrigin?parsed.origin===config.appOrigin:parsed.host===req.get('Host');
    if(!allowed||parsed.protocol!==(config.production?'https:':'http:'))throw new HttpError(403,'ORIGIN_REJECTED','Адрес входа не совпадает с адресом приложения. Сообщите администратору.');
  };
  const checkCsrf=(req:express.Request)=>{
    origin(req);
    const token=cookie(req), supplied=req.get('X-CSRF-Token');
    if(!token||!supplied||!/^[a-f0-9]{64}$/.test(supplied)||!timingSafeEqual(Buffer.from(csrf(token)),Buffer.from(supplied)))throw new HttpError(403,'CSRF_REQUIRED');
  };
  const session=async(req:express.Request):Promise<Session|null>=>{
    const token=cookie(req);
    return token?(await pool.query('SELECT app.local_session($1) AS session',[hash(token)])).rows[0].session:null;
  };
  const writeSession=async(req:express.Request)=>{checkCsrf(req);return requireValue(await session(req),401,'SESSION_EXPIRED');};
  const send=(res:express.Response,token:string,mustChangePassword:boolean)=>{
    res.cookie(cookieName,token,{...cookieOptions,maxAge:8*60*60*1000});
    res.json({mode:'local',authenticated:true,csrfToken:csrf(token),mustChangePassword});
  };
  return {
    async authenticate(req:express.Request) {
      if(!['GET','HEAD','OPTIONS'].includes(req.method))checkCsrf(req);
      const found=requireValue(await session(req),401,'SESSION_EXPIRED');
      if(found.mustChangePassword)throw new HttpError(403,'PASSWORD_CHANGE_REQUIRED');
      return found.userId;
    },
    install(app:express.Express) {
      app.get('/auth/session',async(req,res)=>{
        const found=await session(req), token=cookie(req);
        res.json({mode:'local',authenticated:!!found,...(found&&token?{csrfToken:csrf(token),mustChangePassword:found.mustChangePassword}:{})});
      });
      const limiter=rateLimit({windowMs:15*60*1000,limit:20,skipSuccessfulRequests:true,standardHeaders:'draft-7',legacyHeaders:false,message:{error:{code:'LOGIN_RATE_LIMITED',message:'Слишком много попыток входа. Повторите через 15 минут.'}}});
      app.post('/auth/login',limiter,async(req,res)=>{
        origin(req);
        const body=credentialSchema.parse(req.body);
        const candidate=(await pool.query('SELECT app.local_login_candidate($1) AS hash',[body.login])).rows[0].hash as string|null;
        const valid=await checkPassword(body.password,candidate??await dummy);
        if(!candidate||!valid){
          await pool.query('SELECT app.local_login_failure($1)',[body.login]);
          throw new HttpError(401,'INVALID_CREDENTIALS','Неверный логин или пароль. После нескольких неудачных попыток повторите вход через 15 минут.');
        }
        const token=randomBytes(32).toString('hex');
        const opened=(await pool.query('SELECT app.local_open_session($1,$2,$3) AS ok',[body.login,candidate,hash(token)])).rows[0].ok;
        if(!opened)throw new HttpError(401,'INVALID_CREDENTIALS','Не удалось войти. Повторите попытку.');
        const old=cookie(req);if(old)await pool.query('SELECT app.local_close_session($1)',[hash(old)]);
        const found=(await pool.query('SELECT app.local_session($1) AS session',[hash(token)])).rows[0].session as Session|null;
        if(!found)throw new HttpError(401,'SESSION_EXPIRED');
        send(res,token,found.mustChangePassword);
      });
      app.post('/auth/logout',async(req,res)=>{
        checkCsrf(req);
        await pool.query('SELECT app.local_close_session($1)',[hash(cookie(req)!)]);
        res.clearCookie(cookieName,cookieOptions);res.json({authenticated:false});
      });
      app.post('/auth/password',limiter,async(req,res)=>{
        const found=await writeSession(req);
        const body=z.object({currentPassword:z.string().min(1).max(128),newPassword:passwordSchema}).strict().parse(req.body);
        if(body.currentPassword===body.newPassword)throw new HttpError(422,'PASSWORD_UNCHANGED','Новый пароль должен отличаться от текущего.');
        const token=randomBytes(32).toString('hex');
        await transaction(pool,found.userId,async db=>{
          const current=(await db.query('SELECT app.local_own_password() AS hash')).rows[0].hash;
          if(!current||!await checkPassword(body.currentPassword,current))throw new HttpError(401,'WRONG_PASSWORD','Текущий пароль неверен.');
          const updated=(await db.query('SELECT app.local_change_password($1,$2,$3) AS ok',[current,await hashPassword(body.newPassword),hash(token)])).rows[0].ok;
          if(!updated)throw new HttpError(409,'PASSWORD_CHANGED','Пароль уже изменён. Войдите повторно.');
        });
        send(res,token,false);
      });
    }
  };
}

export const assignmentSchema=z.object({
  role:z.enum(['RIRU_ENGINEER','RIRU_HEAD','RES_HEAD','SUE','STP','GI','SUE_ENGINEER','STP_ENGINEER','GI_ENGINEER','TECH_ADMIN','PROCESS_ADMIN']),
  resId:z.string().uuid().nullable()
}).strict().refine(b=>['RIRU_ENGINEER','RIRU_HEAD','RES_HEAD'].includes(b.role)?b.resId!==null:b.role==='PROCESS_ADMIN'||b.resId===null,'Укажите РЭС для районной роли');

export const localProfileSchema=z.object({
  login:loginSchema,name:z.string().trim().min(1).max(200),email:emailSchema,position:z.string().trim().max(200).optional(),
  expectedRevision:z.number().int().nonnegative(),
  assignments:z.array(assignmentSchema).max(32).refine(rows=>new Set(rows.map(r=>r.role+':'+(r.resId??''))).size===rows.length,'Роли не должны повторяться')
}).strict();

async function accountCommand<T>(db:DB,fn:()=>Promise<T>):Promise<T> {
  await role(db,'TECH_ADMIN');
  const ready=(await db.query("SELECT to_regprocedure('app.local_admin_profile(uuid,integer,text,text,text,jsonb)') IS NOT NULL AS ready")).rows[0].ready;
  if(!ready)throw new HttpError(503,'ACCOUNT_SCHEMA_REQUIRED','Для обновления учётных записей временно верните MIGRATION_DATABASE_URL в настройки Amvera и перезапустите контейнер.');
  try{return await fn();}catch(error){
    const e=error as {code?:string;constraint?:string;message?:string};
    if(e.code==='23505'&&e.constraint==='users_email_unique')throw new HttpError(409,'EMAIL_IN_USE','Этот email уже указан в другой учётной записи.');
    if(e.code==='23505'&&e.constraint==='local_credentials_login_key')throw new HttpError(409,'LOGIN_IN_USE','Этот логин уже используется другой учётной записью.');
    if(e.code==='23503')throw new HttpError(422,'UNKNOWN_RES','Указанный РЭС не найден.');
    if(e.code==='23514'&&e.constraint==='users_email_format')throw new HttpError(422,'INVALID_EMAIL','Укажите корректный email.');
    const messages:Record<string,string>={
      ACCOUNT_NOT_FOUND:'Учётная запись не найдена или уже удалена.',ACCOUNT_CHANGED:'Учётная запись уже изменена. Обновите список и повторите редактирование.',
      EMAIL_REQUIRED:'Укажите email сотрудника.',KEEP_ADMIN_ROLE:'Нельзя снять у себя роль технического администратора.',SELF_DELETE:'Нельзя удалить собственную учётную запись.',
      SELF_ACCESS_CHANGE:'Для смены своего пароля используйте кнопку «Пароль». Закрыть доступ себе нельзя.',
      ROLE_IN_USE:'Роль используется в незавершённых задачах или действующем/будущем замещении. Сначала завершите задачи и замещения.',
      ACCOUNT_IN_USE:'У сотрудника есть незавершённые задачи или замещения. Сначала завершите их.'
    };
    if(e.code==='22023'&&e.message&&messages[e.message])throw new HttpError(e.message==='ACCOUNT_NOT_FOUND'?404:409,e.message,messages[e.message]);
    throw error;
  }
}

export const listLocalUsers=(db:DB)=>accountCommand(db,async()=>(await db.query('SELECT app.local_admin_users() AS users')).rows[0].users);

export async function createLocalUser(db:DB,input:unknown) {
  return accountCommand(db,async()=>{
    const b=z.object({login:loginSchema,name:z.string().trim().min(1).max(200),email:emailSchema,position:z.string().trim().max(200).optional(),password:passwordSchema,assignment:assignmentSchema}).strict().parse(input);
    const created=(await db.query('SELECT app.local_admin_create($1,$2,$3,$4,$5,$6) AS id',[b.login,b.name,b.email,await hashPassword(b.password),b.assignment.role,b.assignment.resId])).rows[0];
    if(b.position)await db.query('SELECT app.local_admin_position($1,$2)',[created.id,b.position]);
    return created;
  });
}
export async function updateLocalAccess(db:DB,userId:string,input:unknown) {
  return accountCommand(db,async()=>{
    const b=z.object({active:z.boolean().optional(),password:passwordSchema.optional()}).strict().refine(b=>b.active!==undefined||b.password!==undefined).parse(input);
    await db.query('SELECT app.local_admin_access($1,$2,$3)',[userId,b.active??null,b.password?await hashPassword(b.password):null]);
    return {updated:true};
  });
}
export const addLocalRole=(db:DB,userId:string,input:unknown)=>accountCommand(db,async()=>{
  const b=assignmentSchema.parse(input);
  return (await db.query('SELECT app.local_admin_role($1,$2,$3) AS id',[userId,b.role,b.resId])).rows[0];
});
export const updateLocalProfile=(db:DB,userId:string,input:unknown)=>accountCommand(db,async()=>{
  const b=localProfileSchema.parse(input);
  await db.query('SELECT app.local_admin_profile($1,$2,$3,$4,$5,$6)',[userId,b.expectedRevision,b.login,b.name,b.email,JSON.stringify(b.assignments)]);
  if(b.position!==undefined)await db.query('SELECT app.local_admin_position($1,$2)',[userId,b.position]);
  return {updated:true};
});
export const deleteLocalUser=(db:DB,userId:string,input:unknown)=>accountCommand(db,async()=>{
  const b=z.object({expectedRevision:z.number().int().nonnegative()}).strict().parse(input);
  await db.query('SELECT app.local_admin_delete($1,$2)',[userId,b.expectedRevision]);
  return {deleted:true};
});
