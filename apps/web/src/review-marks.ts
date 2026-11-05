import type {BlockMark} from './DocumentViewer.js';
type Row=Record<string,any>;
const shown=(v?:Row)=>v?(v.shown??v.value):'—';

/**
 * Отметки сверки с ТУ для одного документа: зелёный — реквизит совпадает с ТУ (или подтверждён вручную),
 * красный — расхождение, жёлтый — не удалось сопоставить, нужна проверка глазами. Справочные пункты (INFO) не красим.
 */
export function checkMarks(check:Row|undefined,side:'act'|'tu'):BlockMark[]{
 if(!check)return [];
 const confirmed=new Set((check.confirmations??[]).map((c:Row)=>c.field));
 const marks:BlockMark[]=[];
 for(const f of check.findings??[] as Row[]){
  if(f.status==='INFO')continue;
  const values:Row[]=f[side]??[];
  const pair=`в акте ${shown(f.act?.[0])}, в ТУ ${shown(f.tu?.[0])}`;
  const [tone,title]:[BlockMark['tone'],string]=f.norm&&side==='act'?(f.status==='MATCH'?['ok',`✓ ${f.label}: по справочнику (${shown(values[0])}). ${f.norm}`]
   :confirmed.has(f.field)?['ok',`✓ ${f.label}: подтверждено вручную`]
   :[f.status==='DIFFERENCE'?'bad':'warn',`${f.status==='DIFFERENCE'?'✗':'?'} ${f.label}: ${f.reason} ${f.norm}`])
   :f.status==='MATCH'?['ok',`✓ ${f.label}: совпадает с ТУ (${shown(values[0])})`]
   :confirmed.has(f.field)?['ok',`✓ ${f.label}: подтверждено вручную`]
   :f.status==='DIFFERENCE'?['bad',`✗ ${f.label}: расхождение — ${pair}`]
   :['warn',`? ${f.label}: проверьте вручную — ${f.reason??pair}`];
  for(const v of values)if(v.blockId)marks.push({blockId:v.blockId,tone,title});
 }
 return marks;
}

/** Абзацы основного текста, которых нет в другой версии: что изменилось или добавлено. */
export function changedMarks(model:Row|undefined,other:Row|undefined,otherLabel:string):BlockMark[]{
 if(!model||!other)return [];
 const norm=(t:string)=>t.replace(/\s+/g,' ').trim();
 const texts=new Set((other.blocks as Row[]).filter(b=>b.part==='word/document.xml').map(b=>norm(b.text)));
 return (model.blocks as Row[]).filter(b=>b.part==='word/document.xml'&&norm(b.text)&&!texts.has(norm(b.text)))
  .map(b=>({blockId:b.id,tone:'changed' as const,title:`Отличается от ${otherLabel}`}));
}

/** Парный абзац в другом документе для клика по отмеченному реквизиту. */
export function pairedBlock(check:Row|undefined,blockId:string,from:'act'|'tu'){
 const to=from==='act'?'tu':'act';
 const f=(check?.findings??[] as Row[]).find((x:Row)=>(x[from]??[]).some((v:Row)=>v.blockId===blockId)&&x[to]?.[0]?.blockId);
 return f?.[to][0].blockId as string|undefined;
}
