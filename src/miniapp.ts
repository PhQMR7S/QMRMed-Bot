import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { config } from './config.js';
import { db, upsertTelegramUser } from './db.js';

type TelegramUser = { id: number; first_name?: string; last_name?: string; username?: string };
const MINI_APP_PORT = Number(process.env.MINI_APP_PORT || 3000);
const MINI_APP_HOST = process.env.MINI_APP_HOST || '127.0.0.1';
const STATIC_ROOT = resolve(process.cwd(), 'miniapp');
const ARCHIVE_ROOT = resolve(process.cwd(), '.qmrmed', 'file-ai');
const MAX_INIT_AGE_SECONDS = 24 * 60 * 60;
const operationLabels: Record<string, string> = { explain:'شرح المحاضرة',summary:'تلخيص دقيق',qa:'أسئلة قصيرة',mcq:'MCQ',true_false:'صح / خطأ',fill_blank:'أكمل الفراغ',matching:'مطابقة',cases:'حالات سريرية',viva:'Viva / شفوي',mind_map:'خريطة ذهنية',flowchart:'مخطط انسيابي',comparison:'جدول مقارنة',timeline:'خط زمني',diagnostic:'خوارزمية تشخيصية',exam:'اختبار تجريبي' };

function json(res: ServerResponse, status: number, data: unknown) { const body=JSON.stringify(data); res.writeHead(status, {'content-type':'application/json; charset=utf-8','cache-control':'no-store'}); res.end(body); }
function header(req: IncomingMessage, name: string) { const value=req.headers[name.toLowerCase()]; return Array.isArray(value)?value[0]:value || ''; }
function validateInitData(initData: string): TelegramUser {
  if (!initData || !config.BOT_TOKEN) throw new Error('Telegram session missing');
  const params=new URLSearchParams(initData); const received=params.get('hash'); if(!received) throw new Error('Invalid Telegram session');
  params.delete('hash'); const dataCheck=Array.from(params.entries()).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');
  const secret=createHmac('sha256','WebAppData').update(config.BOT_TOKEN).digest();
  const expected=createHmac('sha256',secret).update(dataCheck).digest('hex');
  const a=Buffer.from(received,'hex'), b=Buffer.from(expected,'hex'); if(a.length!==b.length || !timingSafeEqual(a,b)) throw new Error('Invalid Telegram signature');
  const authDate=Number(params.get('auth_date')||0); if(!authDate || Math.floor(Date.now()/1000)-authDate>MAX_INIT_AGE_SECONDS) throw new Error('Telegram session expired');
  const raw=params.get('user'); if(!raw) throw new Error('Telegram user missing');
  return JSON.parse(raw) as TelegramUser;
}
async function auth(req: IncomingMessage) { const user=validateInitData(header(req,'x-telegram-init-data')); const dbUser=await upsertTelegramUser(user); return dbUser; }
function safeUserDir(userId: string) { return resolve(ARCHIVE_ROOT,userId.replace(/[^a-zA-Z0-9_-]/g,'_')); }
async function archiveFor(userId: string) { const dir=safeUserDir(userId); await mkdir(dir,{recursive:true}); const names=(await readdir(dir)).filter(n=>n.endsWith('.json')).sort().reverse().slice(0,50); const items:any[]=[]; for(const name of names){try{const item=JSON.parse(await readFile(join(dir,name),'utf8')); items.push({id:item.id,sourceName:item.sourceName,operation:item.operation,operationLabel:operationLabels[item.operation]||item.operation,createdAt:item.createdAt?new Date(item.createdAt).toLocaleString('ar-IQ'): '-',hasResult:Boolean(item.result)});}catch{}} return items; }
async function archiveDetail(userId:string,id:string){if(!/^[a-zA-Z0-9_-]+$/.test(id)) return null; const file=resolve(safeUserDir(userId),`${id}.json`); if(!file.startsWith(safeUserDir(userId)+`/`)) return null; try{return JSON.parse(await readFile(file,'utf8'));}catch{return null;}}
async function handle(req:IncomingMessage,res:ServerResponse){
  try{
    const url=new URL(req.url||'/',`http://${header(req,'host')||'localhost'}`);
    if(req.method==='GET' && (url.pathname==='/' || url.pathname==='/miniapp')) return serveStatic('index.html',res);
    if(req.method==='GET' && url.pathname.startsWith('/miniapp/')) return serveStatic(url.pathname.slice('/miniapp/'.length),res);
    if(req.method!=='GET') return json(res,405,{error:'Method not allowed'});
    const user=await auth(req);
    if(url.pathname==='/api/me'){
      const [completed,attempts,correct,archive]=await Promise.all([db.progress.count({where:{userId:user.id,completed:true}}),db.attempt.count({where:{userId:user.id}}),db.attempt.count({where:{userId:user.id,correct:true}}),archiveFor(String(user.telegramId))]);
      const active=user.subscriptions?.find(s=>s.active && s.endsAt>new Date());
      return json(res,200,{id:user.id,telegramId:user.telegramId,username:user.username,firstName:user.firstName,lastName:user.lastName,department:user.department,stage:user.stage,plan:user.plan,trialUsed:user.trialUsed,trialEndsAt:user.trialEndsAt,subscriptionEndsAt:active?.endsAt?.toLocaleDateString('ar-IQ')||null,archiveCount:archive.length,progress:{completed,attempts,correct,accuracy:attempts?Math.round(correct/attempts*100):0}});
    }
    if(url.pathname==='/api/plans'){
      return json(res,200,[
        {code:'FREE',name:'Free',icon:'🎁',subtitle:'البداية الأساسية مع تجربة QMRMed.',current:user.plan==='FREE',features:['تجربة المنصة التعليمية','الوصول إلى المحتوى المجاني','تجربة الذكاء الاصطناعي حسب سياسة المنصة','الحساب والأرشيف الشخصي']},
        {code:'PLUS',name:'PLUS',icon:'💙',subtitle:'Everything in Free, plus:',current:user.plan==='PLUS',features:[`PLUS — ${config.PLUS_MONTH_STARS}⭐ / شهر`,`PLUS — ${config.PLUS_5MONTH_STARS}⭐ / 5 أشهر`,`PLUS — ${config.PLUS_YEAR_STARS}⭐ / سنة`,'حدود AI أعلى','ميزات تعليمية موسعة','أرشيف موسع']},
        {code:'PRO',name:'PRO',icon:'💜',subtitle:'Everything in PLUS, plus:',current:user.plan==='PRO',features:[`PRO — ${config.PRO_MONTH_STARS}⭐ / شهر`,`PRO — ${config.PRO_5MONTH_STARS}⭐ / 5 أشهر`,`PRO — ${config.PRO_YEAR_STARS}⭐ / سنة`,'أولوية أعلى للذكاء الاصطناعي','ميزات متقدمة','أعلى حدود للاستخدام والأرشيف']}
      ]);
    }
    if(url.pathname==='/api/archive') return json(res,200,await archiveFor(String(user.telegramId)));
    if(url.pathname.startsWith('/api/archive/')){const id=decodeURIComponent(url.pathname.slice('/api/archive/'.length));const item=await archiveDetail(String(user.telegramId),id);if(!item)return json(res,404,{error:'النتيجة غير موجودة'});return json(res,200,{id:item.id,sourceName:item.sourceName,operation:item.operation,operationLabel:operationLabels[item.operation]||item.operation,createdAt:item.createdAt,result:item.result||''});}
    return json(res,404,{error:'Not found'});
  }catch(error){console.error('Mini App error:',error);return json(res,401,{error:error instanceof Error?error.message:'تعذر التحقق من جلسة Telegram'});}
}
async function serveStatic(relative:string,res:ServerResponse){const safe=resolve(STATIC_ROOT,relative);if(!safe.startsWith(STATIC_ROOT+`/`) && safe!==STATIC_ROOT)return json(res,404,{error:'Not found'});const ext=extname(safe);const type=ext==='.html'?'text/html; charset=utf-8':ext==='.css'?'text/css; charset=utf-8':ext==='.js'?'text/javascript; charset=utf-8':'application/octet-stream';try{res.writeHead(200,{'content-type':type,'cache-control':'no-cache'});createReadStream(safe).pipe(res).on('error',()=>res.end());}catch{json(res,404,{error:'Not found'});}}

export function startMiniApp(){const server=createServer(handle);server.listen(MINI_APP_PORT,MINI_APP_HOST,()=>console.log(`QMRMed Mini App listening on http://${MINI_APP_HOST}:${MINI_APP_PORT}`));return server;}
