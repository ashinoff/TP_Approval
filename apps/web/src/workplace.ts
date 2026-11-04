type Row=Record<string,any>;
export type Section='queue'|'work'|'preparation'|'approved'|'upload'|'progress'|'corrections'|'drafts'|'documents';
export const sectionNames:Record<Section,string>={queue:'На согласование',work:'Все в работе',preparation:'Подготовка актов',approved:'Согласованные',upload:'Загрузка документа',progress:'На согласовании',corrections:'Не согласованные',drafts:'Черновики',documents:'Все документы'};
/** Вкладки раздела «Все документы» инженера: только просмотр, загрузка — в отдельном меню. */
export const documentTabs:Section[]=['drafts','progress','corrections','approved','documents'];
export const documentTabNames:Partial<Record<Section,string>>={drafts:'Черновики',progress:'На согласовании',corrections:'Не согласованные',approved:'Согласованные',documents:'Все'};
/** Черновики — прежнее серверное представление upload. */
export const registryView=(section:Section)=>section==='drafts'?'upload':section;
export const CONTRACT_NUMBER_PATTERN=/^\d{5}-\d{2}-\d{8}-\d$/;
export const normalizeContractNumber=(value:string)=>value.replace(/ /g,' ').replace(/[‐-―−]/g,'-').trim().replace(/\s*-\s*/g,'-');
export function defaultSection(profile:Row,tasks:Row[]):Section{return tasks.some(t=>t.role!=='RIRU_ENGINEER')||profile.roles.some((r:Row)=>['RIRU_HEAD','RES_HEAD','SUE','STP','GI'].includes(r.role))?'queue':profile.roles.some((r:Row)=>r.role==='RIRU_ENGINEER')?'upload':'work';}
export function assignedVersion(detail:Row,tasks:Row[]){const task=tasks.find(t=>t.act_id===detail.id&&t.role!=='RIRU_ENGINEER');return detail.cycles.find((c:Row)=>c.id===task?.cycle_id)?.version_id;}
export function initialVersion(detail:Row,tasks:Row[],section:Section){return (section==='approved'?detail.presentation.approvedPublication?.versionId:null)??assignedVersion(detail,tasks)??detail.versions.at(-1)?.id??'';}
export function actUrl(id:string,section:Section,extra:Record<string,string>={}){return `#/acts/${id}?`+new URLSearchParams({section,...extra});}
export function parseLocation(hash:string){const [path,query='']=hash.replace(/^#\/?/,'').split('?');const q=new URLSearchParams(query);const valid=(s:string|null):Section|undefined=>s&&s in sectionNames?s as Section:undefined;const match=/^acts\/([a-f0-9-]{36})$/i.exec(path);return {id:match?.[1],section:valid(q.get('section'))??valid(path),panel:q.get('panel')??'document',comment:q.get('comment')??undefined,version:q.get('version')??undefined};}
/** Почему пользователь не может оставить замечание к этой версии; undefined — может. */
export function remarkBlockReason(detail:Row,tasks:Row[],profile:Row,versionId:string|undefined):string|undefined{
 const version=detail.versions.find((v:Row)=>v.id===versionId);
 if(!version)return 'Документ ещё не загружен.';
 const cycle=detail.cycles.find((c:Row)=>c.version_id===versionId);
 const mine=tasks.filter(t=>t.act_id===detail.id&&t.role!=='RIRU_ENGINEER');
 const task=mine.find(t=>t.cycle_id===cycle?.id);
 if(task&&detail.author_id!==profile.id&&version.created_by!==profile.id)return undefined;
 if(detail.author_id===profile.id||version.created_by===profile.id)return 'Вы автор этого документа: замечания оставляют согласующие. Исправления вносятся новой версией.';
 if(mine.length){const other=detail.versions.find((v:Row)=>detail.cycles.some((c:Row)=>c.id===mine[0].cycle_id&&c.version_id===v.id));return `Ваша задача относится к версии ${other?.number??'другой'} — выберите её в списке версий.`;}
 if(['DRAFT','RETURNED','REVISING'].includes(detail.state))return 'Документ не на согласовании: замечания оставляют согласующие после отправки.';
 const route=detail.presentation?.route;const stages=[route?.head,route?.res,...(route?.parallel??[])].filter((s:Row|null)=>s?.status==='active') as Row[];
 const who=(p:Row|string|null)=>typeof p==='string'?p:p?.name??'';
 // Задача этапа назначена этой учётке, но в списке её задач нет — значит, роль для РЭС документа сейчас не действует.
 const own=stages.find(s=>typeof s.person==='object'&&s.person?.id===profile.id);
 if(own)return `Задача «${own.label}» назначена вам, но роль «${own.label}» для РЭС этого документа у вашей учётки сейчас не действует. Попросите администратора проверить роли в разделе «Пользователи».`;
 const active=stages.map(s=>who(s.person)?`${s.label} — ${who(s.person)}`:s.label);
 return `Замечания оставляет согласующий текущего этапа${active.length?` (${active.join('; ')})`:''}. Вы вошли как ${profile.name}: у вас нет задачи по этой версии документа.`;
}
