import {useEffect,useImperativeHandle,useRef,useState,type Ref} from 'react';
import {renderAsync} from 'docx-preview';
import DOMPurify from 'dompurify';
type Row=Record<string,any>;
export type SelectionAnchor={kind:'OOXML_PARAGRAPH_V1';part:string;blockId:string;blockHash:string;fileHash:string;start:number;end:number;quote:string};
const frameHtml=`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; base-uri 'none'; form-action 'none'"></head><body></body></html>`;
export type DocumentViewerHandle={scrollToBlock:(blockId:string)=>void;highlightBlocks:(blockIds:string[])=>void;scrollToRatio:(ratio:number)=>void};
export default function DocumentViewer({bytes,model,comments,onSelection,onComment,focusedId,focusRequest,onScrollRatio,ref}:{bytes:ArrayBuffer;model:Row;comments:Row[];onSelection:(a:SelectionAnchor|null)=>void;onComment:(id:string)=>void;focusedId?:string;focusRequest?:number;onScrollRatio?:(ratio:number)=>void;ref?:Ref<DocumentViewerHandle>}){
 const frame=useRef<HTMLIFrameElement>(null);const [ready,setReady]=useState(0),[error,setError]=useState(''),[zoom,setZoom]=useState(85),[zoomChosen,setZoomChosen]=useState(false),[pages,setPages]=useState(0),[page,setPage]=useState(1),[query,setQuery]=useState(''),[hits,setHits]=useState<HTMLElement[]>([]),[hit,setHit]=useState(0);
 const callbacks=useRef({onSelection,onComment,onScrollRatio});callbacks.current={onSelection,onComment,onScrollRatio};
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
  const scroll=()=>{if(silentScroll.current){silentScroll.current=false;return;}const max=doc.documentElement.scrollHeight-win.innerHeight;callbacks.current.onScrollRatio?.(max>0?win.scrollY/max:0);};
  win.addEventListener('scroll',scroll,{passive:true});return()=>win.removeEventListener('scroll',scroll);
 },[ready]);
 useEffect(()=>{let active=true;let started=false;let cleanup=()=>{};const run=async()=>{const doc=frame.current?.contentDocument;if(!doc?.body||!doc.querySelector('meta[http-equiv]')||started)return;started=true;setReady(0);setError('');callbacks.current.onSelection(null);
 try{const host=document.createElement('div'),styles=document.createElement('div');await renderAsync(bytes,host,styles,{renderHeaders:true,renderFooters:true,renderComments:false,renderAltChunks:false,ignoreLastRenderedPageBreak:false,breakPages:true,useBase64URL:true});if(!active)return;
 // Sanitize in the creating realm, then adopt into an iframe with no scripts/network/navigation.
 const safe=DOMPurify.sanitize(host.innerHTML,{FORBID_TAGS:['style','script','iframe','object','embed','form','input','button','svg','math','link','meta'],FORBID_ATTR:['srcset','formaction','action','href']});
 const css=[...styles.querySelectorAll('style')].map(s=>s.textContent??'').join('\n').replace(/@import[^;]*;/gi,'').replace(/url\((?!\s*["']?(?:data:|blob:))[^)]*\)/gi,'url("")');
 doc.body.innerHTML=safe;const style=doc.createElement('style');style.textContent=css+`\nhtml{background:#e9eef2}body{margin:0}.docx-wrapper{padding:20px!important;background:#e9eef2!important;zoom:var(--scale,.85)}mark[data-remark-ids]{background:#ffd9d3;color:inherit;box-shadow:inset 0 -2px 0 #c62828;border-radius:2px;padding:0 1px;cursor:pointer}mark[data-remark-ids]:hover{background:#ffc4ba}mark[data-remark-ids]:focus{outline:2px solid #c62828;outline-offset:1px}.jump-hit{background:#fff1b8!important;box-shadow:0 0 0 4px #fff1b8;transition:background .4s}.check-hit{background:#ffe7a3;box-shadow:0 0 0 3px #ffe7a3;border-radius:2px}.search-hit{outline:3px solid #d7a82e}.docx-wrapper>section{position:relative}.page-caption{font:12px sans-serif;color:#7b8d96;text-align:center;margin-bottom:8px}.docx-wrapper a{pointer-events:none}`;doc.head.querySelectorAll('style').forEach(s=>s.remove());doc.head.append(style);
 for(const el of doc.body.querySelectorAll<HTMLElement>('[style]')){if(/url\s*\(/i.test(el.getAttribute('style')??''))el.removeAttribute('style');}
 const paragraphs=doc.body.querySelectorAll<HTMLElement>('article p,header p,footer p');for(const p of paragraphs){const part=p.closest('header')?'header':p.closest('footer')?'footer':'document';const candidates=model.blocks.filter((b:Row)=>b.part.includes('/'+part)&&b.text===p.textContent&&b.text.length);if(candidates.length===1){p.dataset.blockId=candidates[0].id;p.dataset.blockHash=candidates[0].sha256;}}
 const sections=Array.from(doc.querySelectorAll<HTMLElement>('section.docx'));sections.forEach((s,i)=>{s.id=`preview-page-${i+1}`;const caption=doc.createElement('div');caption.className='page-caption';caption.textContent=`Страница предпросмотра ${i+1}`;s.before(caption);});setPages(sections.length);setPage(1);
 const select=()=>{const selection=doc.getSelection();if(!selection||selection.isCollapsed||!selection.rangeCount){callbacks.current.onSelection(null);return;}const range=selection.getRangeAt(0);const start=(range.startContainer.nodeType===1?range.startContainer:range.startContainer.parentElement) as Element;const end=(range.endContainer.nodeType===1?range.endContainer:range.endContainer.parentElement) as Element;const p=start.closest<HTMLElement>('p[data-block-id]');if(!p||end.closest('p[data-block-id]')!==p){callbacks.current.onSelection(null);return;}const pre=doc.createRange();pre.selectNodeContents(p);pre.setEnd(range.startContainer,range.startOffset);const from=pre.toString().length;const quote=range.toString();const block=model.blocks.find((b:Row)=>b.id===p.dataset.blockId);if(!block||block.text.slice(from,from+quote.length)!==quote||!quote.length||quote.length>5000){callbacks.current.onSelection(null);return;}callbacks.current.onSelection({kind:'OOXML_PARAGRAPH_V1',part:block.part,blockId:block.id,blockHash:block.sha256,fileHash:model.sha256,start:from,end:from+quote.length,quote});};
 const click=(e:Event)=>{const mark=(e.target as Element).closest<HTMLElement>('mark[data-remark-ids]');if(mark)callbacks.current.onComment(mark.dataset.remarkIds!.split(',')[0]);};
 const key=(e:KeyboardEvent)=>{if((e.key==='Enter'||e.key===' ')&&(e.target as Element).matches('mark[data-remark-ids]')){e.preventDefault();click(e);}};
 doc.addEventListener('mouseup',select);doc.addEventListener('keyup',select);doc.addEventListener('touchend',select);doc.addEventListener('click',click);doc.addEventListener('keydown',key);cleanup=()=>{doc.removeEventListener('mouseup',select);doc.removeEventListener('keyup',select);doc.removeEventListener('touchend',select);doc.removeEventListener('click',click);doc.removeEventListener('keydown',key);};setReady(n=>n+1);
 }catch(e){if(active)setError('Не удалось отобразить DOCX: '+(e as Error).message);}};const f=frame.current!;f.addEventListener('load',run);if(f.contentDocument?.readyState==='complete')void run();return()=>{active=false;cleanup();f.removeEventListener('load',run);};},[bytes,model]);
 useEffect(()=>{const doc=frame.current?.contentDocument;if(!ready||!doc)return;doc.querySelectorAll('mark[data-remark-ids]').forEach(m=>m.replaceWith(...m.childNodes));doc.body.normalize();
 for(const p of doc.querySelectorAll<HTMLElement>('p[data-block-id]')){const notes=comments.filter(c=>c.anchor?.blockId===p.dataset.blockId&&c.anchor.fileHash===model.sha256);if(!notes.length)continue;const walker=doc.createTreeWalker(p,4);const nodes:Text[]=[];let node;while(node=walker.nextNode())nodes.push(node as Text);let offset=0;for(const text of nodes){const len=text.length;const cuts=new Set([0,len]);for(const c of notes){cuts.add(Math.max(0,Math.min(len,c.anchor.start-offset)));cuts.add(Math.max(0,Math.min(len,c.anchor.end-offset)));}const points=[...cuts].sort((a,b)=>a-b);const fragment=doc.createDocumentFragment();for(let i=0;i<points.length-1;i++){const a=points[i],b=points[i+1];const ids=notes.filter(c=>c.anchor.start<offset+b&&c.anchor.end>offset+a).map(c=>c.id);const str=text.data.slice(a,b);if(ids.length){const m=doc.createElement('mark');m.dataset.remarkIds=ids.join(',');m.tabIndex=0;m.setAttribute('role','button');m.title=`Замечания: ${ids.length}`;m.setAttribute('aria-label',`Замечание: ${str}`);m.textContent=str;fragment.append(m);}else fragment.append(doc.createTextNode(str));}text.replaceWith(fragment);offset+=len;}}
 },[ready,comments,model]);
 useEffect(()=>{const doc=frame.current?.contentDocument;if(!doc||!focusedId)return;const mark=[...doc.querySelectorAll<HTMLElement>('mark[data-remark-ids]')].find(m=>m.dataset.remarkIds?.split(',').includes(focusedId));mark?.scrollIntoView({block:'center'});mark?.focus({preventScroll:true});},[focusedId,focusRequest,ready,comments]);
 // Until the user picks a scale, fit the A4 page (≈794px + margins) into the available width.
 useEffect(()=>{
  if(!ready||zoomChosen||!frame.current)return;
  const fit=(frame.current.clientWidth-40)/794*100;
  const option=[50,60,70,85,100].filter(n=>n<=fit).at(-1)??50;
  setZoom(option);
 },[ready,zoomChosen]);
 useEffect(()=>{frame.current?.contentDocument?.documentElement?.style.setProperty('--scale',String(zoom/100));},[zoom,ready]);
 useEffect(()=>{const doc=frame.current?.contentDocument;if(!doc)return;doc.querySelectorAll('.search-hit').forEach(p=>p.classList.remove('search-hit'));const matches=query.trim()?[...doc.querySelectorAll<HTMLElement>('article p,header p,footer p')].filter(p=>p.textContent?.toLocaleLowerCase().includes(query.toLocaleLowerCase())):[];matches.forEach(p=>p.classList.add('search-hit'));setHits(matches);setHit(0);matches[0]?.scrollIntoView({block:'center'});},[query,ready]);
 return <section className="word-preview" aria-label="Предпросмотр DOCX"><div className="word-tools"><label>Масштаб<select aria-label="Масштаб" value={zoom} onChange={e=>{setZoomChosen(true);setZoom(Number(e.target.value));}}>{[50,60,70,85,100,125,150].map(n=><option value={n} key={n}>{n}%</option>)}</select></label><label>Страница<select aria-label="Страница" value={page} onChange={e=>{setPage(Number(e.target.value));frame.current?.contentDocument?.getElementById(`preview-page-${e.target.value}`)?.scrollIntoView();}}>{Array.from({length:pages},(_,i)=><option key={i} value={i+1}>{i+1} / {pages}</option>)}</select></label><label>Поиск в документе<input value={query} onChange={e=>setQuery(e.target.value)}/></label><button className="secondary-button" disabled={!hits.length} onClick={()=>{const next=(hit+1)%hits.length;setHit(next);hits[next]?.scrollIntoView({block:'center'});}}>Далее {hits.length?`${hit+1}/${hits.length}`:'0'}</button></div>{error&&<p role="alert">{error}</p>}<iframe ref={frame} title="Документ DOCX — экспериментальный просмотр" sandbox="allow-same-origin" srcDoc={frameHtml}/>{!ready&&!error&&<p role="status">Подготовка предпросмотра…</p>}</section>;
}
