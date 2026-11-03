import type {Block} from './documents.js';

// Import suggestions only. Never infer a value when the source is ambiguous.
export function extractTuMetadata(blocks:Block[]){
 const text=blocks.filter(b=>b.part==='word/document.xml').map(b=>b.text).join('\n').replace(/\u00a0/g,' ');
 const unique=(values:string[])=>[...new Set(values.map(v=>v.replace(/\s+/g,' ').trim()).filter(Boolean))];
 const contracts=unique([...text.matchAll(/Приложение\s+к\s+договору\s*№\s*([\p{L}\d][\p{L}\d/–—‑-]*)/giu)].map(m=>m[1].replace(/[–—‑]/g,'-')));
 const applicants=unique([...text.matchAll(/(?:^|\n)\s*(?:\d+[.)]\s*)?Заявитель\s*:\s*([^\n]+)(?:\n(?!\s*(?:\d+[.)]|[\p{L} ]{1,60}:))([^\n]+))?/giu)].map(m=>m[1].replace(/[\s.,;]+$/u,'')));
 const addresses=unique([...text.matchAll(/(?:по\s+адресу|Адрес\s+объекта)\s*:\s*([^\n]+(?:\n(?!\s*(?:\d+[.)]\s|Максимальная|Класс|Точка|Все данные|Заявитель))[^\n]+)*)/giu)].map(m=>m[1]));
 const dates=unique([...text.matchAll(/Приложение\s+к\s+договору\s*№\s*[\p{L}\d/–—‑-]+\s+от\s+(\d{2})[.](\d{2})[.](\d{4})/giu)].map(m=>`${m[3]}-${m[2]}-${m[1]}`)).filter(v=>{const d=new Date(v);return !Number.isNaN(d.valueOf())&&d.toISOString().slice(0,10)===v;});
 const fields={contractNumber:contracts,applicant:applicants,address:addresses,contractDate:dates};
 return {fields:Object.fromEntries(Object.entries(fields).map(([k,v])=>[k,{value:v.length===1?v[0]:'',status:v.length===1?'FOUND':v.length?'AMBIGUOUS':'NOT_FOUND'}])),source:'TU_DOCX',limitations:'Извлечённые реквизиты нужно проверить. Неоднозначные и отсутствующие значения не подставляются.'};
}
