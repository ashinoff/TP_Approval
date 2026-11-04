import {useEffect,useImperativeHandle,useRef,useState,type Ref} from 'react';
import {renderAsync} from 'docx-preview';
import DOMPurify from 'dompurify';
type Row=Record<string,any>;
export type SelectionAnchor={kind:'OOXML_PARAGRAPH_V1';part:string;blockId:string;blockHash:string;fileHash:string;start:number;end:number;quote:string};
const frameHtml=`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; base-uri 'none'; form-action 'none'"></head><body></body></html>`;
/** Цветная отметка абзаца: ok — совпадает с ТУ, bad — расхождение, warn — проверить вручную, changed — изменён относительно другой версии. */
// Текст абзаца в модели содержит табуляции и переносы (\t, \n), а в отрисованном документе их нет.
// Сопоставляем абзацы и смещения по непробельным символам, чтобы это не мешало разметке и замечаниям.
const isWs=(c:string)=>/\s/.test(c);
const textKey=(t:string)=>t.replace(/\s+/g,'');
const nonWs=(s:string,end:number)=>{let n=0;for(let i=0;i<end&&i<s.length;i++)if(!isWs(s[i]))n++;return n;};
/** Индекс в строке после n непробельных символов: для начала фрагмента пропускаем пробелы, для конца — нет. */
const afterNonWs=(s:string,n:number,isStart:boolean)=>{let c=0;for(let i=0;i<=s.length;i++){if(c===n&&(!isStart||i===s.length||!isWs(s[i])))return i;if(i<s.length&&!isWs(s[i]))c++;}return s.length;};
const blockToDom=(dom:string,src:string,offset:number,isEnd:boolean)=>afterNonWs(dom,nonWs(src,offset),!isEnd);
export type BlockMark={blockId:string;tone:'ok'|'bad'|'warn'|'changed';title:string};
export type DocumentViewerHandle={scrollToBlock:(blockId:string)=>void;highlightBlocks:(blockIds:string[])=>void;scrollToRatio:(ratio:number)=>void};
export default function DocumentViewer({bytes,model,comments,onSelection,onComment,focusedId,focusRequest,onScrollRatio,marks,onMarkClick,onAddRemark,remarkBlocked,ref}:{bytes:ArrayBuffer;model:Row;comments:Row[];onSelection:(a:SelectionAnchor|null)=>void;onComment:(id:string)=>void;focusedId?:string;focusRequest?:number;onScrollRatio?:(ratio:number)=>void;marks?:BlockMark[];onMarkClick?:(blockId:string)=>void;onAddRemark?:()=>void;remarkBlocked?:string;ref?:Ref<DocumentViewerHandle>}){
 const frame=useRef<HTMLIFrameElement>(null);const [ready,setReady]=useState(0),[error,setError]=useState(''),[zoom,setZoom]=useState(85),[zoomChosen,setZoomChosen]=useState(false),[pages,setPages]=useState(0),[page,setPage]=useState(1),[query,setQuery]=useState(''),[hits,setHits]=useState<HTMLElement[]>([]),[hit,setHit]=useState(0);
 const callbacks=useRef({onSelection,onComment,onScrollRatio,onMarkClick});callbacks.current={onSelection,onComment,onScrollRatio,onMarkClick};
 const [float,setFloat]=useState<{x:number;y:number;invalid?:boolean}|null>(null);
 const silentScroll=useRef(false),highlighted=useRef<string[]>([]);
 // Lets the TU check panel show the paragraph a finding was taken from.
 useImperativeHandle(ref,()=>({scrollToBlock(blockId:string){
  const doc=frame.current?.contentDocument;
  const paragraph=doc?.querySelector<HTMLElement>(`p[data-block-id="${CSS.escape(blockId)}"]`);
  if(!paragraph)return;
  paragraph.scrollIntoView({block:'center'});
  paragraph.classList.add('jump-hit');
  setTimeout(()=>paragraph.classList.remove('jump-hit'),1800);
 },
 // Постоянная подсветка абзацев (например, расхождений автосверки) до следующего вызова.
 highlightBlocks(blockIds:string[]){
  highlighted.current=blockIds;
  const doc=frame.current?.contentDocument;if(!doc)return;
  doc.querySelectorAll('.check-hit').forEach(p=>p.classList.remove('check-hit'));
  for(const id of blockIds)doc.querySelector(`p[data-block-id="${CSS.escape(id)}"]`)?.classList.add('check-hit');
 },
 // Синхронная прокрутка: доля прокрутки 0..1, без обратного события.
 scrollToRatio(ratio:number){
  const win=frame.current?.contentWindow,root=frame.current?.contentDocument?.documentElement;if(!win||!root)return;
  silentScroll.current=true;win.scrollTo({top:Math.max(0,ratio*(root.scrollHeight-win.innerHeight))});
 }}),[]);
 useEffect(()=>{
  const win=frame.current?.contentWindow,doc=frame.current?.contentDocument;if(!ready||!win||!doc)return;
  // Подсветка переживает повторную отрисовку документа.
  for(const id of highlighted.current)doc.querySelector(`p[data-block-id="${CSS.escape(id)}"]`)?.classList.add('check-hit');
  const scroll=()=>{setFloat(null);if(silentScroll.current){silentScroll.current=false;return;}const max=doc.documentElement.scrollHeight-win.innerHeight;callbacks.current.onScrollRatio?.(max>0?win.scrollY/max:0);};
  win.addEventListener('scroll',scroll,{passive:true});return()=>win.removeEventListener('scroll',scroll);
 },[ready]);
 useEffect(()=>{let active=true;let started=false;let cleanup=()=>{};const run=async()=>{const doc=frame.current?.contentDocument;if(!doc?.body||!doc.querySelector('meta[http-equiv]')||started)return;started=true;setReady(0);setError('');callbacks.current.onSelection(null);
 try{const host=document.createElement('div'),styles=document.createElement('div');await renderAsync(bytes,host,styles,{renderHeaders:true,renderFooters:true,renderComments:false,renderAltChunks:false,ignoreLastRenderedPageBreak:false,breakPages:true,useBase64URL:true});if(!active)return;
 // Sanitize in the creating realm, then adopt into an iframe with no scripts/network/navigation.
 const safe=DOMPurify.sanitize(host.innerHTML,{FORBID_TAGS:['style','script','iframe','object','embed','form','input','button','svg','math','link','meta'],FORBID_ATTR:['srcset','formaction','action','href']});
 const css=[...styles.querySelectorAll('style')].map(s=>s.textContent??'').join('\n').replace(/@import[^;]*;/gi,'').replace(/url\((?!\s*["']?(?:data:|blob:))[^)]*\)/gi,'url("")');
 doc.body.innerHTML=safe;const style=doc.createElement('style');style.textContent=css+`\nhtml{background:#e9eef2}body{margin:0}.docx-wrapper{padding:20px!important;background:#e9eef2!important;zoom:var(--scale,.85);align-items:flex-start!important;width:max-content;min-width:100%;box-sizing:border-box}.docx-wrapper>section.docx{margin-left:auto!important;margin-right:auto!important}p[data-mark]{border-radius:2px;transition:background .2s}p[data-mark=ok]{background:#e4f4ea;box-shadow:-6px 0 0 #3c9a63}p[data-mark=bad]{background:#fde4e1;box-shadow:-6px 0 0 #c62828}p[data-mark=warn]{background:#fff1d1;box-shadow:-6px 0 0 #d99a1e}p[data-mark=changed]{background:#e4eefb;box-shadow:-6px 0 0 #2f7fd0}body.mark-click p[data-mark]{cursor:pointer}mark[data-remark-ids]{background:#ffd9d3;color:inherit;box-shadow:inset 0 -2px 0 #c62828;border-radius:2px;padding:0 1px;cursor:pointer}mark[data-remark-ids]:hover{background:#ffc4ba}mark[data-remark-ids]:focus{outline:2px solid #c62828;outline-offset:1px}.jump-hit{background:#fff1b8!important;box-shadow:0 0 0 4px #fff1b8;transition:background .4s}.check-hit{background:#ffe7a3;box-shadow:0 0 0 3px #ffe7a3;border-radius:2px}.search-hit{outline:3px solid #d7a82e}.docx-wrapper>section{position:relative}.page-caption{font:12px sans-serif;color:#7b8d96;text-align:center;margin-bottom:8px}.docx-wrapper a{pointer-events:none}`;doc.head.querySelectorAll('style').forEach(s=>s.remove());doc.head.append(style);
 for(const el of doc.body.querySelectorAll<HTMLElement>('[style]')){if(/url\s*\(/i.test(el.getAttribute('style')??''))el.removeAttribute('style');}
 const paragraphs=doc.body.querySelectorAll<HTMLElement>('article p,header p,footer p');for(const p of paragraphs){const part=p.closest('header')?'header':p.closest('footer')?'footer':'document';const key=textKey(p.textContent??'');const candidates=key?model.blocks.filter((b:Row)=>b.part.includes('/'+part)&&textKey(b.text)===key):[];if(candidates.length===1){p.dataset.blockId=candidates[0].id;p.dataset.blockHash=candidates[0].sha256;}}
 const sections=Array.from(doc.querySelectorAll<HTMLElement>('section.docx'));sections.forEach((s,i)=>{s.id=`preview-page-${i+1}`;const caption=doc.createElement('div');caption.className='page-caption';caption.textContent=`Страница предпросмотра ${i+1}`;s.before(caption);});setPages(sections.length);setPage(1);
 const select=()=>{setFloat(null);const selection=doc.getSelection();if(!selection||selection.isCollapsed||!selection.rangeCount){callbacks.current.onSelection(null);return;}const range=selection.getRangeAt(0);const box=range.getBoundingClientRect();const invalid=()=>{callbacks.current.onSelection(null);setFloat({x:box.left,y:box.bottom,invalid:true});};const start=(range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement) as Element;const end=(range.endContainer.nodeType===1?range.endContainer:range.endContainer.parentElement) as Element;const p=start.closest<HTMLElement>('p[data-block-id]');if(!p||end.closest('p[data-block-id]')!==p){invalid();return;}const pre=doc.createRange();pre.selectNodeContents(p);pre.setEnd(range.startContainer,range.startOffset);const domFrom=pre.toString().length,dom=p.textContent??'';const block=model.blocks.find((b:Row)=>b.id===p.dataset.blockId);if(!block){invalid();return;}const selected=range.toString();const from=afterNonWs(block.text,nonWs(dom,domFrom),true),to=afterNonWs(block.text,nonWs(dom,domFrom+selected.length),false);const quote=block.text.slice(from,to);if(!quote.trim()||quote.length>5000||textKey(quote)!==textKey(selected)){invalid();return;}callbacks.current.onSelection({kind:'OOXML_PARAGRAPH_V1',part:block.part,blockId:block.id,blockHash:block.sha256,fileHash:model.sha256,start:from,end:to,quote});setFloat({x:box.left,y:box.bottom});};
 const click=(e:Event)=>{const mark=(e.target as Element).closest<HTMLElement>('mark[data-remark-ids]');if(mark){callbacks.current.onComment(mark.dataset.remarkIds!.split(',')[0]);return;}const marked=(e.target as Element).closest<HTMLElement>('p[data-mark]');if(marked&&doc.getSelection()?.isCollapsed!==false)callbacks.current.onMarkClick?.(marked.dataset.blockId!);};
 const key=(e:KeyboardEvent)=>{if((e.key==='Enter'||e.key===' ')&&(e.target as Element).matches('mark[data-remark-ids]')){e.preventDefault();click(e);}};
 doc.addEventListener('mouseup',select);doc.addEventListener('keyup',select);doc.addEventListener('touchend',select);doc.addEventListener('click',click);doc.addEventListener('keydown',key);cleanup=()=>{doc.removeEventListener('mouseup',select);doc.removeEventListener('keyup',select);doc.removeEventListener('touchend',select);doc.removeEventListener('click',click);doc.removeEventListener('keydown',key);};setReady(n=>n+1);
 }catch(e){if(active)setError('Не удалось отобразить DOCX: '+(e as Error).message);}};const f=frame.current!;f.addEventListener('load',run);if(f.contentDocument?.readyState==='complete')void run();return()=>{active=false;cleanup();f.removeEventListener('load',run);};},[bytes,model]);
 useEffect(()=>{const doc=frame.current?.contentDocument;if(!ready||!doc)return;doc.querySelectorAll('mark[data-remark-ids]').forEach(m=>m.replaceWith(...m.childNodes));doc.body.normalize();
 for(const p of doc.querySelectorAll<HTMLElement>('p[data-block-id]')){const notes=comments.filter(c=>c.anchor?.blockId===p.dataset.blockId&&c.anchor.fileHash===model.sha256);if(!notes.length)continue;const dom=p.textContent??'',src=(model.blocks.find((b:Row)=>b.id===p.dataset.blockId)?.text??dom) as string;const at=new Map(notes.map(c=>[c.id,{start:blockToDom(dom,src,c.anchor.start,false),end:blockToDom(dom,src,c.anchor.end,true)}]));const walker=doc.createTreeWalker(p,4);const nodes:Text[]=[];let node;while(node=walker.nextNode())nodes.push(node as Text);let offset=0;for(const text of nodes){const len=text.length;const cuts=new Set([0,len]);for(const c of notes){cuts.add(Math.max(0,Math.min(len,at.get(c.id)!.start-offset)));cuts.add(Math.max(0,Math.min(len,at.get(c.id)!.end-offset)));}const points=[...cuts].sort((a,b)=>a-b);const fragment=doc.createDocumentFragment();for(let i=0;i<points.length-1;i++){const a=points[i],b=points[i+1];const ids=notes.filter(c=>at.get(c.id)!.start<offset+b&&at.get(c.id)!.end>offset+a).map(c=>c.id);const str=text.data.slice(a,b);if(ids.length){const m=doc.createElement('mark');m.dataset.remarkIds=ids.join(',');m.tabIndex=0;m.setAttribute('role','button');m.title=`Замечания: ${ids.length}`;m.setAttribute('aria-label',`Замечание: ${str}`);m.textContent=str;fragment.append(m);}else fragment.append(doc.createTextNode(str));}text.replaceWith(fragment);offset+=len;}}
 },[ready,comments,model]);
 useEffect(()=>{const doc=frame.current?.contentDocument;if(!doc||!focusedId)return;const mark=[...doc.querySelectorAll<HTMLElement>('mark[data-remark-ids]')].find(m=>m.dataset.remarkIds?.split(',').includes(focusedId));mark?.scrollIntoView({block:'center'});mark?.focus({preventScroll:true});},[focusedId,focusRequest,ready,comments]);
 // Цветные отметки сверки: атрибут data-mark и подсказка; переживают повторную отрисовку.
 const marksKey=JSON.stringify(marks??[]);
 useEffect(()=>{const doc=frame.current?.contentDocument;if(!ready||!doc)return;
  doc.querySelectorAll<HTMLElement>('p[data-mark]').forEach(p=>{delete p.dataset.mark;p.removeAttribute('title');});
  for(const m of (JSON.parse(marksKey) as BlockMark[])){const p=doc.querySelector<HTMLElement>(`p[data-block-id="${CSS.escape(m.blockId)}"]`);if(!p)continue;
   // Худший тон побеждает, если на абзац приходится несколько реквизитов.
   const rank={bad:3,warn:2,changed:1,ok:0};if(p.dataset.mark&&rank[p.dataset.mark as BlockMark['tone']]>=rank[m.tone]){p.title+='\n'+m.title;continue;}
   p.dataset.mark=m.tone;p.title=p.title?p.title+'\n'+m.title:m.title;}
  doc.body.classList.toggle('mark-click',!!onMarkClick);
 },[ready,marksKey,!!onMarkClick]);
 // Until the user picks a scale, fit the A4 page (≈794px + margins) into the available width.
 useEffect(()=>{
  if(!ready||zoomChosen||!frame.current)return;
  const fit=(frame.current.clientWidth-40)/794*100;
  const option=[50,60,70,85,100].filter(n=>n<=fit).at(-1)??50;
  setZoom(option);
 },[ready,zoomChosen]);
 useEffect(()=>{frame.current?.contentDocument?.documentElement?.style.setProperty('--scale',String(zoom/100));},[zoom,ready]);
 useEffect(()=>{const doc=frame.current?.contentDocument;if(!doc)return;doc.querySelectorAll('.search-hit').forEach(p=>p.classList.remove('search-hit'));const matches=query.trim()?[...doc.querySelectorAll<HTMLElement>('article p,header p,footer p')].filter(p=>p.textContent?.toLocaleLowerCase().includes(query.toLocaleLowerCase())):[];matches.forEach(p=>p.classList.add('search-hit'));setHits(matches);setHit(0);matches[0]?.scrollIntoView({block:'center'});},[query,ready]);
 return <section className="word-preview" aria-label="Предпросмотр DOCX"><div className="word-tools"><div className="zoom-control" role="group" aria-label="Масштаб"><button type="button" aria-label="Уменьшить" title="Уменьшить" disabled={zoom<=40} onClick={()=>{setZoomChosen(true);setZoom(z=>Math.max(40,z-10));}}>−</button><output aria-live="polite">{zoom}%</output><button type="button" aria-label="Увеличить" title="Увеличить" disabled={zoom>=200} onClick={()=>{setZoomChosen(true);setZoom(z=>Math.min(200,z+10));}}>+</button><button type="button" className="zoom-fit" title="Страница по ширине окна" onClick={()=>{setZoomChosen(true);if(frame.current)setZoom(Math.max(40,Math.min(200,Math.floor((frame.current.clientWidth-48)/794*100))));}}>По ширине</button></div><label>Страница<select aria-label="Страница" value={page} onChange={e=>{setPage(Number(e.target.value));frame.current?.contentDocument?.getElementById(`preview-page-${e.target.value}`)?.scrollIntoView();}}>{Array.from({length:pages},(_,i)=><option key={i} value={i+1}>{i+1} / {pages}</option>)}</select></label><label>Поиск в документе<input value={query} onChange={e=>setQuery(e.target.value)}/></label><button className="secondary-button" disabled={!hits.length} onClick={()=>{const next=(hit+1)%hits.length;setHit(next);hits[next]?.scrollIntoView({block:'center'});}}>Далее {hits.length?`${hit+1}/${hits.length}`:'0'}</button></div>{error&&<p role="alert">{error}</p>}<div className="word-frame"><iframe ref={frame} title="Документ DOCX — экспериментальный просмотр" sandbox="allow-same-origin" srcDoc={frameHtml}/>{float&&onAddRemark&&(float.invalid?<span className="float-remark float-hint" style={{left:Math.max(4,float.x),top:float.y+6}}>Выделите текст в пределах одного абзаца</span>
  :<button type="button" className={`float-remark${remarkBlocked?' float-blocked':''}`} title={remarkBlocked} style={{left:Math.max(4,float.x),top:float.y+6}} onMouseDown={e=>e.preventDefault()} onClick={()=>{setFloat(null);onAddRemark();}}>＋ Замечание</button>)}</div>{!ready&&!error&&<p role="status">Подготовка предпросмотра…</p>}</section>;
}
