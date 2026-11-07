import {createHash} from 'node:crypto';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import {HttpError} from './db.js';
import type {Block} from './documents.js';

/**
 * PDF — основной формат документов (решение владельца 05.11.2026): только PDF, сохранённые из Word/Excel,
 * с текстовым слоем на каждой странице; сканы запрещены. Модель документа — те же абзацы (Block), что и у DOCX,
 * поэтому правила сверки и привязка замечаний (блок + смещения в тексте) работают без изменений.
 * К каждому блоку добавлены куски текста pdf.js с координатами: по ним браузер отмечает значения на странице.
 *
 * Абзацы: строка начинается с элемента hasEOL; продолжение абзаца — без отступа, с обычным междустрочием,
 * предыдущая строка дотянута до правого края (выключка по ширине). Таблицы — по рамкам, которые Word рисует
 * тонкими залитыми прямоугольниками: текст внутри ячейки собирается в один блок с координатами {table,row,cell}.
 * Текст в полосе 12 pt у края листа не учитывается: там Word оставляет невидимые метки мест подписей.
 */
export type PdfSpan={item:number;start:number;end:number;box:[number,number,number,number]};
export type PdfBlock=Block&{page:number;spans:PdfSpan[]};
/** Красная линия границы балансовой принадлежности на схеме: горизонталь на странице и сторона сетевой организации. */
export type PdfBoundary={page:number;y:number;x0:number;x1:number;networkAbove:boolean};
export type PdfModel={sha256:string;format:'pdf';pages:{width:number;height:number}[];blocks:PdfBlock[];boundaries:PdfBoundary[]};

const MAX_PAGES=60;
const EDGE=12;
type Item={i:number;str:string;x:number;y:number;w:number;h:number;eol:boolean};
type Line={items:Item[];x:number;y:number;right:number;h:number};
type Cell={x0:number;y0:number;x1:number;y1:number};
const hash=(s:string|Uint8Array)=>createHash('sha256').update(s).digest('hex');

function load(bytes:Uint8Array){
 return pdfjs.getDocument({data:Uint8Array.from(bytes),isEvalSupported:false,disableFontFace:true,useSystemFonts:false,stopAtErrors:false,verbosity:0}).promise;
}

/** Безопасность и пригодность: открывается без пароля, без скриптов, вложений и форм, на каждой странице есть текст. */
export async function validatePdf(bytes:Uint8Array){
 if(bytes.length<8||Buffer.from(bytes.subarray(0,5)).toString('latin1')!=='%PDF-')throw new HttpError(415,'INVALID_PDF','Файл не является PDF.');
 let doc:Awaited<ReturnType<typeof load>>;
 try{doc=await load(bytes);}
 catch(e){
  if((e as {name?:string}).name==='PasswordException')throw new HttpError(415,'PDF_ENCRYPTED','PDF защищён паролем — сохраните документ без защиты.');
  throw new HttpError(415,'INVALID_PDF','PDF повреждён или не читается.');
 }
 try{
  if(doc.numPages>MAX_PAGES)throw new HttpError(413,'PDF_TOO_MANY_PAGES',`В документе больше ${MAX_PAGES} страниц.`);
  if(await doc.getJSActions())throw new HttpError(415,'UNSAFE_PDF','В PDF есть сценарии (JavaScript) — сохраните документ из Word/Excel заново.');
  if(await doc.getAttachments())throw new HttpError(415,'UNSAFE_PDF','В PDF вложены файлы — сохраните документ из Word/Excel без вложений.');
  if(await doc.getFieldObjects())throw new HttpError(415,'UNSAFE_PDF','PDF содержит заполняемые поля формы — сохраните документ из Word/Excel заново.');
  for(let n=1;n<=doc.numPages;n++){
   const page=await doc.getPage(n);
   if(await page.getJSActions())throw new HttpError(415,'UNSAFE_PDF','В PDF есть сценарии (JavaScript).');
   const text=(await page.getTextContent()).items.map(i=>'str' in i?i.str:'').join('');
   if(text.replace(/\s/g,'').length<20)throw new HttpError(422,'PDF_SCANNED',`Страница ${n} без текстового слоя — похоже на скан. Загружайте PDF, сохранённый из Word или Excel.`);
  }
 }finally{await doc.destroy();}
}

/** Ячейки таблиц по рамкам: вертикальные и горизонтальные тонкие заливки страницы. */
type Ops=Awaited<ReturnType<Awaited<ReturnType<Awaited<ReturnType<typeof load>>['getPage']>>['getOperatorList']>>;
function tableCells(ops:Ops){
 const O=pdfjs.OPS;
 const h:number[][]=[],v:number[][]=[];
 // Текущая матрица преобразования (save/restore/transform): рамки могут рисоваться со сдвигом системы координат.
 type M=[number,number,number,number,number,number];let ctm:M=[1,0,0,1,0,0];const stack:M[]=[];
 const mul=(m:M,n:M):M=>[m[0]*n[0]+m[2]*n[1],m[1]*n[0]+m[3]*n[1],m[0]*n[2]+m[2]*n[3],m[1]*n[2]+m[3]*n[3],m[0]*n[4]+m[2]*n[5]+m[4],m[1]*n[4]+m[3]*n[5]+m[5]];
 const at=(x:number,y:number):[number,number]=>[ctm[0]*x+ctm[2]*y+ctm[4],ctm[1]*x+ctm[3]*y+ctm[5]];
 for(let i=0;i<ops.fnArray.length-1;i++){
  const fn=ops.fnArray[i];
  if(fn===O.save){stack.push(ctm);continue;}
  if(fn===O.restore){ctm=stack.pop()??[1,0,0,1,0,0];continue;}
  if(fn===O.transform){ctm=mul(ctm,ops.argsArray[i] as M);continue;}
  if(fn!==O.constructPath||![O.fill,O.eoFill].includes(ops.fnArray[i+1]))continue;
  const m=ops.argsArray[i][2] as number[];if(!m)continue;
  const [ax,ay]=at(m[0],m[1]),[bx,by]=at(m[2],m[3]);const [x0,y0,x1,y1]=[Math.min(ax,bx),Math.min(ay,by),Math.max(ax,bx),Math.max(ay,by)];
  if(y1-y0<1.6&&x1-x0>3)h.push([x0,(y0+y1)/2,x1]);else if(x1-x0<1.6&&y1-y0>3)v.push([(x0+x1)/2,y0,y1]);
 }
 return {h,v};
}
/**
 * Граница на схеме — красная горизонтальная линия (в бланках Россети — обводка толщиной от 1 pt). Учитываются
 * матрицы преобразования и вложенные формы (схема Visio вставлена в PDF как форма со своим масштабом).
 */
function redLines(ops:Ops){
 const O=pdfjs.OPS;type M=[number,number,number,number,number,number];let ctm:M=[1,0,0,1,0,0];const stack:M[]=[];
 const mul=(m:M,n:M):M=>[m[0]*n[0]+m[2]*n[1],m[1]*n[0]+m[3]*n[1],m[0]*n[2]+m[2]*n[3],m[1]*n[2]+m[3]*n[3],m[0]*n[4]+m[2]*n[5]+m[4],m[1]*n[4]+m[3]*n[5]+m[5]];
 const at=(x:number,y:number):[number,number]=>[ctm[0]*x+ctm[2]*y+ctm[4],ctm[1]*x+ctm[3]*y+ctm[5]];
 let color:ArrayLike<number>=[0,0,0],width=1;const lines:{y:number;x0:number;x1:number}[]=[];
 for(let i=0;i<ops.fnArray.length-1;i++){
  const fn=ops.fnArray[i],args=ops.argsArray[i];
  if(fn===O.save){stack.push(ctm);continue;}
  if(fn===O.restore){ctm=stack.pop()??[1,0,0,1,0,0];continue;}
  if(fn===O.transform){ctm=mul(ctm,args as M);continue;}
  if(fn===O.paintFormXObjectBegin){stack.push(ctm);if(args?.[0])ctm=mul(ctm,args[0] as M);continue;}
  if(fn===O.paintFormXObjectEnd){ctm=stack.pop()??[1,0,0,1,0,0];continue;}
  if(fn===O.setStrokeRGBColor){color=args as ArrayLike<number>;continue;}
  if(fn===O.setLineWidth){width=args[0];continue;}
  if(fn!==O.constructPath||![O.stroke,O.closeStroke].includes(ops.fnArray[i+1]))continue;
  if(!(color[0]>=180&&color[1]<=90&&color[2]<=90)||width*Math.abs(ctm[3]||ctm[0])<0.9)continue;
  const m=args[2] as number[];if(!m)continue;
  const [ax,ay]=at(m[0],m[1]),[bx,by]=at(m[2],m[3]);
  if(Math.abs(by-ay)<2&&Math.abs(bx-ax)>=40)lines.push({y:(ay+by)/2,x0:Math.min(ax,bx),x1:Math.max(ax,bx)});
 }
 return lines;
}
function cellOf(x:number,y:number,lines:{h:number[][];v:number[][]}):Cell|undefined{
 const near=1;
 const left=lines.v.filter(([vx,y0,y1])=>vx<=x+near&&y>=y0-near&&y<=y1+near).sort((a,b)=>b[0]-a[0])[0];
 const right=lines.v.filter(([vx,y0,y1])=>vx>=x-near&&y>=y0-near&&y<=y1+near&&(!left||vx>left[0]+2)).sort((a,b)=>a[0]-b[0])[0];
 if(!left||!right)return undefined;
 const top=lines.h.filter(([x0,hy,x1])=>hy>=y-near&&x>=x0-near&&x<=x1+near).sort((a,b)=>a[1]-b[1])[0];
 const bottom=lines.h.filter(([x0,hy,x1])=>hy<=y+near&&x>=x0-near&&x<=x1+near).sort((a,b)=>b[1]-a[1])[0];
 if(!top||!bottom)return undefined;
 return {x0:left[0],x1:right[0],y0:bottom[1],y1:top[1]};
}

/** Текст строки из кусков: пробел по расстоянию между кусками, табуляция — на большом разрыве. */
function joinItems(items:Item[],spans:PdfSpan[],offset:number){
 let text='';let prev:Item|undefined;
 for(const it of items){
  if(prev&&it.str){
   const gap=it.x-(prev.x+prev.w);
   if(gap>14)text+='\t';
   else if(gap>Math.max(1.2,it.h*0.18)&&!/\s$/.test(text)&&!/^\s/.test(it.str))text+=' ';
  }
  if(!it.str)continue;
  spans.push({item:it.i,start:offset+text.length,end:offset+text.length+it.str.length,box:[it.x,it.y,it.x+it.w,it.y+it.h]});
  text+=it.str;prev=it;
 }
 return text;
}

export async function pdfModel(bytes:Uint8Array):Promise<PdfModel>{
 const doc=await load(bytes);
 try{
  const pages:PdfModel['pages']=[];const blocks:PdfBlock[]=[];const boundaries:PdfBoundary[]=[];let tables=0;
  for(let n=1;n<=doc.numPages;n++){
   const page=await doc.getPage(n);const [vx0,vy0,vx1,vy1]=page.view;pages.push({width:vx1-vx0,height:vy1-vy0});
   const content=await page.getTextContent();
   const items:Item[]=content.items.map((raw,i)=>{const it=raw as {str:string;transform:number[];width:number;height:number;hasEOL:boolean};
    return {i,str:it.str,x:it.transform[4],y:it.transform[5],w:it.width,h:it.height||Math.hypot(it.transform[2],it.transform[3]),eol:it.hasEOL};});
   const visible=items.filter(it=>it.y>vy0+EDGE&&it.y<vy1-EDGE&&it.x>vx0+EDGE/2&&it.x<vx1-EDGE/2);
   const ops=await page.getOperatorList();const borders=tableCells(ops);
   // Сторона сетевой организации — по подписи у стрелки границы («Сетевая организация» выше или ниже линии).
   for(const line of redLines(ops)){
    const label=(re:RegExp)=>items.find(it=>re.test(it.str)&&Math.abs(it.y-line.y)<60&&it.x>line.x0-80&&it.x<line.x1+80);
    const net=label(/^\s*Сетев/u),app=label(/^\s*Заявител/u);
    boundaries.push({page:n,y:line.y,x0:line.x0,x1:line.x1,networkAbove:net?net.y>line.y:app?app.y<line.y:true});
   }
   // Куски в ячейках таблиц — отдельно; остальное — строками.
   const cells=new Map<string,{cell:Cell;items:Item[]}>();const free:Item[]=[];
   for(const it of visible){
    const cell=it.str.trim()?cellOf(it.x+Math.min(it.w,4)/2,it.y+it.h/3,borders):undefined;
    if(cell){const key=[cell.x0,cell.y0,cell.x1,cell.y1].map(c=>c.toFixed(1)).join(',');if(!cells.has(key))cells.set(key,{cell,items:[]});cells.get(key)!.items.push(it);}
    else free.push(it);
   }
   // Строки: новая строка — по hasEOL предыдущего пустого куска или по смене высоты строки.
   const lines:Line[]=[];let current:Item[]=[];
   const flush=()=>{const real=current.filter(c=>c.str);if(real.length){const xs=real.map(r=>r.x);lines.push({items:current,x:Math.min(...xs),y:real[0].y,right:Math.max(...real.map(r=>r.x+r.w)),h:Math.max(...real.map(r=>r.h))});}current=[];};
   for(const it of free){
    const last=current.filter(c=>c.str).at(-1);
    if(last&&it.str&&Math.abs(it.y-last.y)>Math.max(2,last.h*0.5))flush();
    if(it.eol&&!it.str){flush();continue;}
    current.push(it);
   }
   flush();
   const rightEdge=Math.max(0,...lines.map(l=>l.right));
   // Абзацы.
   let para:Line[]=[];
   const emit=(group:Line[],table?:Block['table'])=>{
    if(!group.length)return;const spans:PdfSpan[]=[];let text='';
    for(const line of group){if(text)text+=table?' ':' ';text+=joinItems(line.items,spans,text.length);}
    text=text.replace(/ {2,}/g,' ').trim();if(!text)return;
    const block:PdfBlock={id:`pdf:p${n}:${blocks.length}`,part:`pdf/page${n}`,text,sha256:hash(text),page:n,spans};
    if(table)block.table=table;blocks.push(block);
   };
   for(const line of lines){
    const prev=para.at(-1);
    // Нумерованный пункт («1.», «10.2.», «-») всегда начинает новый абзац.
    const numbered=/^\s*(?:\d+(?:\.\d+)*\.|[-–•])\s/.test(line.items.map(i=>i.str).join(''));
    const continues=!numbered&&prev&&prev.y-line.y>0&&prev.y-line.y<=prev.h*1.75&&line.x<=prev.x+3&&prev.right>=rightEdge-25&&Math.abs(line.h-prev.h)<1.5;
    if(!continues){emit(para);para=[];}
    para.push(line);
   }
   emit(para);
   // Таблицы: ячейки, касающиеся друг друга, — одна таблица; строка/столбец — по порядку верхних/левых границ.
   const list=[...cells.values()].sort((a,b)=>b.cell.y1-a.cell.y1||a.cell.x0-b.cell.x0);
   const groups:{cells:typeof list}[]=[];
   for(const c of list){
    const g=groups.find(gr=>gr.cells.some(o=>Math.abs(o.cell.y0-c.cell.y1)<2||Math.abs(o.cell.y1-c.cell.y1)<2||Math.abs(o.cell.y0-c.cell.y0)<2)&&gr.cells.some(o=>o.cell.x0<c.cell.x1+2&&c.cell.x0<o.cell.x1+2||Math.abs(o.cell.x1-c.cell.x0)<2));
    if(g)g.cells.push(c);else groups.push({cells:[c]});
   }
   for(const g of groups){
    const table=tables++;const tops=[...new Set(g.cells.map(c=>c.cell.y1.toFixed(0)))].sort((a,b)=>Number(b)-Number(a));
    for(const c of g.cells){
     const row=tops.indexOf(c.cell.y1.toFixed(0));
     const lefts=[...new Set(g.cells.filter(o=>o.cell.y1.toFixed(0)===c.cell.y1.toFixed(0)).map(o=>o.cell.x0.toFixed(0)))].sort((a,b)=>Number(a)-Number(b));
     const cellLines:Line[]=[];let cur:Item[]=[];
     for(const it of c.items){const last=cur.at(-1);if(last&&Math.abs(it.y-last.y)>Math.max(2,last.h*0.5)){cellLines.push({items:cur,x:0,y:0,right:0,h:0});cur=[];}cur.push(it);}
     if(cur.length)cellLines.push({items:cur,x:0,y:0,right:0,h:0});
     emit(cellLines,{table,row,cell:lefts.indexOf(c.cell.x0.toFixed(0))});
    }
   }
  }
  return {sha256:hash(bytes),format:'pdf',pages,blocks,boundaries};
 }finally{await doc.destroy();}
}
export const isPdf=(bytes:Uint8Array)=>bytes.length>=5&&Buffer.from(bytes.subarray(0,5)).toString('latin1')==='%PDF-';
