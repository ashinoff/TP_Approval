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
