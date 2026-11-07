import {useEffect,useImperativeHandle,useRef,useState,type Ref} from 'react';
import {getDocument,GlobalWorkerOptions,TextLayer,type PDFDocumentProxy,type PageViewport} from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type {BlockMark,DocumentViewerHandle,JumpHit,SelectionAnchor} from './DocumentViewer.js';
import './pdf.css';
import {RossetiLoader} from './Brand.js';
GlobalWorkerOptions.workerSrc=workerUrl;
type Row=Record<string,any>;
type Span={item:number;start:number;end:number;box:[number,number,number,number]};
type Rect={left:number;top:number;width:number;height:number};
type PageView={n:number;viewport:PageViewport;el:HTMLDivElement;below:HTMLDivElement;above:HTMLDivElement};

/**
 * Точный просмотр PDF (основной формат документов): страницы рисует pdf.js, поверх — прозрачный текстовый слой для
 * выделения. Абзацы и координаты слов приходят из серверной модели (те же блоки, по которым идёт сверка), поэтому
 * отметки сверки, «куда смотреть», замечания и выделение работают по тем же блокам и смещениям, что и для DOCX.
 * Сценарии PDF не выполняются (isEvalSupported:false, без слоя форм и аннотаций).
 */
export default function PdfViewer({bytes,model,comments,onSelection,onComment,focusedId,focusRequest,onScrollRatio,marks,onMarkClick,onAddRemark,remarkBlocked,ref}:{bytes:ArrayBuffer;model:Row;comments:Row[];onSelection:(a:SelectionAnchor|null)=>void;onComment:(id:string)=>void;focusedId?:string;focusRequest?:number;onScrollRatio?:(ratio:number)=>void;marks?:BlockMark[];onMarkClick?:(blockId:string)=>void;onAddRemark?:()=>void;remarkBlocked?:string;ref?:Ref<DocumentViewerHandle>}){
 const scroller=useRef<HTMLDivElement>(null),frame=useRef<HTMLDivElement>(null);
 const [doc,setDoc]=useState<PDFDocumentProxy>(),[error,setError]=useState(''),[zoom,setZoom]=useState(85),[zoomChosen,setZoomChosen]=useState(false),[ready,setReady]=useState(0),
  [page,setPage]=useState(1),[query,setQuery]=useState(''),[hit,setHit]=useState(0),[float,setFloat]=useState<{x:number;y:number;invalid?:boolean}|null>(null);
 const views=useRef<PageView[]>([]);const silentScroll=useRef(false);
 const state=useRef<{highlighted:string[];jump?:{blockId:string;hit?:JumpHit};search?:string}>({highlighted:[]});
 const callbacks=useRef({onSelection,onComment,onScrollRatio,onMarkClick});callbacks.current={onSelection,onComment,onScrollRatio,onMarkClick};
 const blocks:Row[]=model.blocks;const byId=new Map<string,Row>(blocks.map(b=>[b.id,b]));
 // Кусок текста страницы (элемент pdf.js) → блок и его смещение в тексте блока.
 const itemIndex=useRef(new Map<string,{block:Row;span:Span}>());
 useEffect(()=>{const index=new Map<string,{block:Row;span:Span}>();for(const b of blocks)for(const s of (b.spans??[]) as Span[])index.set(`${b.page}:${s.item}`,{block:b,span:s});itemIndex.current=index;},[model]);

 useEffect(()=>{let active=true;setError('');setDoc(undefined);
  const task=getDocument({data:new Uint8Array(bytes.slice(0)),isEvalSupported:false,enableXfa:false});
  task.promise.then(d=>{if(active)setDoc(d);else void d.destroy();}).catch(e=>{if(active)setError('Не удалось открыть PDF: '+(e as Error).message);});
  return()=>{active=false;void task.destroy();};
 },[bytes]);

 // Масштаб «по ширине», пока пользователь не выбрал свой.
 useEffect(()=>{if(!doc||zoomChosen||!scroller.current)return;const width=model.pages?.[0]?.width??595;
  const fit=(scroller.current.clientWidth-40)/(width*96/72)*100;setZoom([50,60,70,85,100,120].filter(n=>n<=fit).at(-1)??50);},[doc,zoomChosen]);

 // Страницы: сразу — каркас всех листов нужного размера (по нему работают прокрутка, отметки и замечания), а холст и
 // текстовый слой pdf.js рисуются только у листов рядом с экраном. Раньше документ показывался лишь после отрисовки
 // всех страниц подряд — в режиме проверки (два документа) это было самым долгим.
 const drawRef=useRef<()=>void>(()=>{});
 useEffect(()=>{if(!doc||!scroller.current)return;let cancelled=false;const host=scroller.current;let observer:IntersectionObserver|undefined;
  const run=async()=>{
   const keep=host.scrollTop/Math.max(1,host.scrollHeight);host.replaceChildren();views.current=[];
   const dpr=Math.min(2,window.devicePixelRatio||1);
   const pages=await Promise.all(Array.from({length:doc.numPages},(_,i)=>doc.getPage(i+1)));if(cancelled)return;
   const paint=async(n:number)=>{
    const v=viewOf(n);if(!v||v.el.dataset.painted)return;v.el.dataset.painted='1';const p=pages[n-1],viewport=v.viewport;
    const canvas=document.createElement('canvas');canvas.width=Math.floor(viewport.width*dpr);canvas.height=Math.floor(viewport.height*dpr);
    canvas.style.width=`${viewport.width}px`;canvas.style.height=`${viewport.height}px`;
    const text=document.createElement('div');text.className='textLayer';
    v.el.prepend(canvas);v.below.after(text);
    await p.render({canvasContext:canvas.getContext('2d')!,viewport,transform:dpr!==1?[dpr,0,0,dpr,0,0]:undefined}).promise;if(cancelled)return;
    const layer=new TextLayer({textContentSource:await p.getTextContent(),container:text,viewport});await layer.render();if(cancelled)return;
    layer.textDivs.forEach((d,i)=>{d.dataset.item=String(i);});drawRef.current();
   };
   observer=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting)void paint(Number((e.target as HTMLElement).dataset.page)).catch(err=>{if(!cancelled)setError('Не удалось отобразить PDF: '+(err as Error).message);});},{root:host,rootMargin:'800px 0px'});
   pages.forEach((p,i)=>{const n=i+1;
    const viewport=p.getViewport({scale:zoom/100*96/72});
    const el=document.createElement('div');el.className='pdf-page';el.id=`pdf-page-${n}`;el.dataset.page=String(n);
    el.style.width=`${viewport.width}px`;el.style.height=`${viewport.height}px`;el.style.setProperty('--scale-factor',String(viewport.scale));
    const below=document.createElement('div');below.className='pdf-overlay pdf-below';
    const above=document.createElement('div');above.className='pdf-overlay pdf-above';
    const caption=document.createElement('div');caption.className='page-caption';caption.textContent=`Страница ${n}`;
    el.append(below,above);host.append(caption,el);
    views.current.push({n,viewport,el,below,above});observer!.observe(el);
   });
   host.scrollTop=keep*host.scrollHeight;setReady(r=>r+1);
  };
  void run().catch(e=>{if(!cancelled)setError('Не удалось отобразить PDF: '+(e as Error).message);});
  return()=>{cancelled=true;observer?.disconnect();};
 },[doc,zoom]);

 // Прямоугольники куска текста или его части (по доле символов) в координатах страницы.
 const rects=(view:PageView,spans:Span[],from=0,to=Infinity):Rect[]=>{
  const lines:{y:number;x0:number;x1:number;y0:number;y1:number}[]=[];
  for(const s of spans){
   if(s.end<=from||s.start>=to)continue;
   const len=Math.max(1,s.end-s.start),[x0,y0,x1,y1]=s.box,h=y1-y0;
   const a=x0+(x1-x0)*Math.max(0,from-s.start)/len,b=x0+(x1-x0)*Math.min(len,to-s.start)/len;
   const line=lines.find(l=>Math.abs(l.y-y0)<h/2);
   if(line){line.x0=Math.min(line.x0,a);line.x1=Math.max(line.x1,b);}else lines.push({y:y0,x0:a,x1:b,y0:y0-h*0.25,y1:y0+h*0.95});
  }
  return lines.map(l=>{const [vx0,vy0,vx1,vy1]=view.viewport.convertToViewportRectangle([l.x0,l.y0,l.x1,l.y1]);
   return {left:Math.min(vx0,vx1)-2,top:Math.min(vy0,vy1)-1,width:Math.abs(vx1-vx0)+4,height:Math.abs(vy1-vy0)+2};});
 };
 const viewOf=(n:number)=>views.current.find(v=>v.n===n);
 const box=(parent:HTMLElement,r:Rect,cls:string,extra:Record<string,string>={})=>{const d=document.createElement('div');d.className=cls;Object.assign(d.style,{left:`${r.left}px`,top:`${r.top}px`,width:`${r.width}px`,height:`${r.height}px`});for(const [k,v]of Object.entries(extra))d.setAttribute(k,v);parent.append(d);return d;};
 const valueRange=(text:string,needle?:string)=>{if(!needle)return null;const esc=needle.trim().split(/\s+/).map(p=>p.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('\\s*');
  const m=new RegExp(esc,'iu').exec(text)??(/\d+(?:[.,]\d+)?/.exec(needle)?new RegExp(`(?<![\\d.,])${/\d+(?:[.,]\d+)?/.exec(needle)![0].replace(/[.,]/,'[.,]')}(?:[.,]0+)?(?![\\d])`).exec(text):null);
  return m?[m.index,m.index+m[0].length] as const:null;};

 // Вся разметка поверх страниц перерисовывается целиком: отметки сверки, подсветка, «куда смотреть», поиск, замечания.
 const marksKey=JSON.stringify(marks??[]);
 const draw=()=>{
  for(const v of views.current){v.below.replaceChildren();v.above.replaceChildren();}
  // Отметка ложится на само значение («ТП-А645», «СИП 4х16»), а не на весь абзац; не нашлось в тексте — абзац целиком.
  // Подсказка при наведении собирает все реквизиты абзаца.
  const rank={bad:3,warn:2,changed:1,ok:0};const tone=new Map<string,BlockMark>();const pieces=new Map<string,{tone:BlockMark['tone'];range:readonly [number,number]|null}[]>();
  for(const m of (JSON.parse(marksKey) as BlockMark[])){const was=tone.get(m.blockId);if(!was||rank[m.tone]>rank[was.tone])tone.set(m.blockId,{...m,title:was?was.title+'\n'+m.title:m.title});else tone.set(m.blockId,{...was,title:was.title+'\n'+m.title});
   const b=byId.get(m.blockId);if(!b)continue;const range=m.tone==='changed'?null:valueRange(b.text,m.text);const list=pieces.get(m.blockId)??[];
   const same=list.find(p=>p.range?.[0]===range?.[0]&&p.range?.[1]===range?.[1]);if(same){if(rank[m.tone]>rank[same.tone])same.tone=m.tone;}else list.push({tone:m.tone,range});pieces.set(m.blockId,list);}
  // Подсказка при наведении («✓ Номинал ВА: по справочнику…»): отметки лежат под текстом, поэтому title — на кусках текста.
  for(const v of views.current)v.el.querySelectorAll<HTMLElement>('.textLayer [data-item][title]').forEach(el=>el.removeAttribute('title'));
  for(const [id,m]of tone){const b=byId.get(id);const v=b&&viewOf(b.page);if(!v)continue;
   const list=pieces.get(id)??[];const whole=list.find(p=>!p.range);
   for(const p of whole?[whole]:list)for(const r of rects(v,b.spans,p.range?.[0],p.range?.[1]))box(v.below,r,'pdf-mark',{'data-mark':whole?m.tone:p.tone,'data-block':id,title:m.title});
   for(const s of b.spans as Span[])v.el.querySelector<HTMLElement>(`.textLayer [data-item="${s.item}"]`)?.setAttribute('title',m.title);}
  for(const id of state.current.highlighted){const b=byId.get(id);const v=b&&viewOf(b.page);if(v)for(const r of rects(v,b.spans))box(v.below,r,'pdf-check-hit');}
  if(state.current.search){const q=state.current.search.toLocaleLowerCase();for(const b of blocks){const at=b.text.toLocaleLowerCase().indexOf(q);const v=at>=0&&viewOf(b.page);if(v)for(const r of rects(v,b.spans,at,at+q.length))box(v.below,r,'pdf-search-hit');}}
  const j=state.current.jump;
  if(j){const b=byId.get(j.blockId);const v=b&&viewOf(b.page);
   if(v){const all=rects(v,b.spans);if(all.length){const u={left:Math.min(...all.map(r=>r.left)),top:Math.min(...all.map(r=>r.top)),right:Math.max(...all.map(r=>r.left+r.width)),bottom:Math.max(...all.map(r=>r.top+r.height))};
     box(v.above,{left:u.left-4,top:u.top-4,width:u.right-u.left+8,height:u.bottom-u.top+8},'pdf-jump',{'data-jump':j.hit?.tone??'focus'});}
    const range=valueRange(b.text,j.hit?.text);if(range)for(const r of rects(v,b.spans,range[0],range[1]))box(v.below,r,'pdf-value-hit');}}
  for(const c of comments){const a=c.anchor;if(!a||a.fileHash!==model.sha256)continue;const b=byId.get(a.blockId);const v=b&&viewOf(b.page);if(!v)continue;
   for(const r of rects(v,b.spans,a.start,a.end)){const d=box(v.above,r,'pdf-remark',{'data-remark-id':c.id,role:'button',tabindex:'0','aria-label':`Замечание: ${a.quote}`,title:'Замечание'});
    d.addEventListener('click',()=>callbacks.current.onComment(c.id));d.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();callbacks.current.onComment(c.id);}});
    if(c.id===focusedId)d.classList.add('is-focused');}}
 };
 drawRef.current=draw;
 useEffect(()=>{if(ready)draw();},[ready,marksKey,comments,focusedId]);
 useEffect(()=>{if(!ready||!focusedId)return;scroller.current?.querySelector<HTMLElement>(`[data-remark-id="${CSS.escape(focusedId)}"]`)?.scrollIntoView({block:'center'});},[focusedId,focusRequest,ready]);

 const scrollToRect=(blockId:string)=>{const b=byId.get(blockId);const v=b&&viewOf(b.page);const host=scroller.current;if(!v||!host)return;
  const r=rects(v,b.spans)[0];if(!r)return;silentScroll.current=true;host.scrollTop=v.el.offsetTop+r.top-host.clientHeight/2;};
 useImperativeHandle(ref,()=>({
  scrollToBlock(blockId,hit){state.current.jump={blockId,hit};draw();scrollToRect(blockId);},
  pointAt(blockId,hit){state.current.jump={blockId,hit};draw();},
  highlightBlocks(ids){state.current.highlighted=ids;draw();},
  scrollToRatio(ratio){const host=scroller.current;if(!host)return;silentScroll.current=true;host.scrollTop=ratio*(host.scrollHeight-host.clientHeight);},
 }));

 // Прокрутка: синхронизация с другим окном и номер текущей страницы.
 useEffect(()=>{const host=scroller.current;if(!host)return;
  const scroll=()=>{setFloat(null);const mid=host.scrollTop+host.clientHeight/3;const current=views.current.filter(v=>v.el.offsetTop<=mid).at(-1);if(current)setPage(current.n);
   if(silentScroll.current){silentScroll.current=false;return;}const max=host.scrollHeight-host.clientHeight;callbacks.current.onScrollRatio?.(max>0?host.scrollTop/max:0);};
  host.addEventListener('scroll',scroll,{passive:true});return()=>host.removeEventListener('scroll',scroll);},[]);

 // Выделение → привязка замечания: начало и конец в одном блоке, смещения в тексте блока.
 const position=(node:Node,offset:number)=>{const span=(node.nodeType===1?node:node.parentElement) as HTMLElement|null;const item=span?.closest<HTMLElement>('[data-item]');const pageEl=span?.closest<HTMLElement>('.pdf-page');
  if(!item||!pageEl)return null;const hit=itemIndex.current.get(`${pageEl.dataset.page}:${item.dataset.item}`);if(!hit)return null;
  return {block:hit.block,offset:hit.span.start+Math.min(offset,hit.span.end-hit.span.start)};};
 useEffect(()=>{const host=scroller.current;if(!host)return;
  const select=()=>{setFloat(null);const sel=window.getSelection();if(!sel||sel.isCollapsed||!sel.rangeCount||!host.contains(sel.anchorNode)){callbacks.current.onSelection(null);return;}
   const range=sel.getRangeAt(0);const frameBox=frame.current!.getBoundingClientRect();const rb=range.getBoundingClientRect();const at={x:rb.left-frameBox.left,y:rb.bottom-frameBox.top};
   const a=position(range.startContainer,range.startOffset);let b=position(range.endContainer,range.endOffset);
   // Замечание привязывается к одному абзацу. Выделение, заехавшее в следующий (тройной щелчок, протяжка до конца
   // строки), обрезается по концу первого абзаца, а не отклоняется.
   if(a&&(!b||b.block.id!==a.block.id))b={block:a.block,offset:a.block.text.length};
   if(!a||!b||b.offset<=a.offset){callbacks.current.onSelection(null);setFloat({...at,invalid:true});return;}
   const quote=a.block.text.slice(a.offset,b.offset);if(!quote.trim()||quote.length>5000){callbacks.current.onSelection(null);setFloat({...at,invalid:true});return;}
   callbacks.current.onSelection({kind:'OOXML_PARAGRAPH_V1',part:a.block.part,blockId:a.block.id,blockHash:a.block.sha256,fileHash:model.sha256,start:a.offset,end:b.offset,quote});setFloat(at);};
  const click=(e:MouseEvent)=>{if(window.getSelection()?.isCollapsed===false||!callbacks.current.onMarkClick)return;
   // Отметки лежат под текстовым слоем и «прозрачны» для мыши — ищем по координатам клика.
   const inside=(el:Element)=>{const r=el.getBoundingClientRect();return e.clientX>=r.left&&e.clientX<=r.right&&e.clientY>=r.top&&e.clientY<=r.bottom;};
   const mark=[...host.querySelectorAll<HTMLElement>('.pdf-mark')].find(inside);
   if(mark?.dataset.block)callbacks.current.onMarkClick(mark.dataset.block);};
  host.addEventListener('mouseup',select);host.addEventListener('keyup',select);host.addEventListener('touchend',select);host.addEventListener('click',click);
  return()=>{host.removeEventListener('mouseup',select);host.removeEventListener('keyup',select);host.removeEventListener('touchend',select);host.removeEventListener('click',click);};
 },[model]);

 const hits=query.trim()?blocks.filter(b=>b.text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())):[];
 useEffect(()=>{state.current.search=query.trim()||undefined;setHit(0);if(ready){draw();if(hits[0])scrollToRect(hits[0].id);}},[query,ready]);
 const pages=doc?.numPages??0;
 return <section className="word-preview pdf-preview" aria-label="Просмотр PDF"><div className="word-tools">
  <div className="zoom-control" role="group" aria-label="Масштаб">
   <button type="button" aria-label="Уменьшить" title="Уменьшить" disabled={zoom<=40} onClick={()=>{setZoomChosen(true);setZoom(z=>Math.max(40,z-10));}}>−</button><output aria-live="polite">{zoom}%</output>
   <button type="button" aria-label="Увеличить" title="Увеличить" disabled={zoom>=200} onClick={()=>{setZoomChosen(true);setZoom(z=>Math.min(200,z+10));}}>+</button>
   <button type="button" className="zoom-fit" title="Страница по ширине окна" onClick={()=>{setZoomChosen(true);if(scroller.current)setZoom(Math.max(40,Math.min(200,Math.floor((scroller.current.clientWidth-48)/((model.pages?.[0]?.width??595)*96/72)*100))));}}>По ширине</button></div>
  <label>Страница<select aria-label="Страница" value={page} onChange={e=>{const n=Number(e.target.value);setPage(n);const v=viewOf(n);if(v&&scroller.current){silentScroll.current=true;scroller.current.scrollTop=v.el.offsetTop-24;}}}>{Array.from({length:pages},(_,i)=><option key={i} value={i+1}>{i+1} / {pages}</option>)}</select></label>
  <label>Поиск в документе<input value={query} onChange={e=>setQuery(e.target.value)}/></label>
  <button className="secondary-button" disabled={!hits.length} onClick={()=>{const next=(hit+1)%hits.length;setHit(next);scrollToRect(hits[next].id);}}>Далее {hits.length?`${hit+1}/${hits.length}`:'0'}</button>
 </div>{error&&<p role="alert">{error}</p>}
 <div className="word-frame pdf-frame" ref={frame}><div className={`pdf-scroll${onMarkClick?' mark-click':''}`} ref={scroller} role="document" aria-label="Документ PDF"/>
  {float&&onAddRemark&&(float.invalid?<span className="float-remark float-hint" style={{left:Math.max(4,float.x),top:float.y+6}}>Замечание ставится к тексту документа — начните выделение с текста абзаца</span>
   :<button type="button" className={`float-remark${remarkBlocked?' float-blocked':''}`} title={remarkBlocked} style={{left:Math.max(4,float.x),top:float.y+6}} onMouseDown={e=>e.preventDefault()} onClick={()=>{setFloat(null);onAddRemark();}}>＋ Замечание</button>)}
 </div>{!ready&&!error&&<RossetiLoader label="Подготовка просмотра…"/>}</section>;
}
