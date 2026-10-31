import RouteFlow from './RouteFlow.js';
import {Icon,IconButton,StatusBadge,statusNames,roleNames,shortDate,dateTime} from './Ui.js';
export type Filters={q:string;resId:string;status:string;stage:string;from:string;to:string;comments:string;overdue:boolean;mine:boolean;action:boolean};
export const emptyFilters:Filters={q:'',resId:'',status:'',stage:'',from:'',to:'',comments:'',overdue:false,mine:false,action:false};
type Row=Record<string,any>;
export default function Registry({data,filters,onFilters,resUnits,page,onPage,busy,canCreate,onCreate,onAction,tasksMode=false}:{
  data:{items:Row[];total:number;summary:Record<string,number>;limit:number};filters:Filters;onFilters:(filters:Filters)=>void;
  resUnits:Row[];page:number;onPage:(n:number)=>void;busy:boolean;canCreate:boolean;onCreate:()=>void;onAction:(action:string,row:Row)=>void;tasksMode?:boolean
}){
  const set=(key:keyof Filters,value:string|boolean)=>onFilters({...filters,[key]:value});
  const stats=[['total','Всего','file',''],['inReview','На согласовании','clock','IN_REVIEW'],['rework','На доработке','return','REWORK'],['overdue','Просрочено','alert','OVERDUE'],['approved','Согласовано','check','APPROVED']];
  return <section className="registry-workspace" aria-label="Реестр документов">
    <div className="stat-grid">{stats.map(([key,label,icon,status])=><button className={`stat-card stat-${key} ${filters.status===status&&status?'stat-selected':''}`} key={key} onClick={()=>set('status',status)} aria-label={`${label}: ${data.summary[key]??0}`}><span className="stat-icon"><Icon name={icon}/></span><span><small>{label}</small><strong>{data.summary[key]??0}</strong></span><Icon name="arrow" size={14}/></button>)}</div>
    <section className="registry-controls card"><div className="registry-toolbar"><label className="search-field"><Icon name="search"/><span className="sr-only">Поиск документов</span><input type="search" value={filters.q} onChange={e=>set('q',e.target.value)} placeholder="Номер, договор, заявитель, адрес, опора, питающий центр"/></label>{canCreate&&<button className="primary-button" onClick={onCreate}><Icon name="plus"/>Создать акт</button>}<button className="secondary-button" onClick={()=>onFilters({...emptyFilters})}><Icon name="refresh" size={16}/>Сбросить фильтры</button></div>
      <div className="filter-grid"><label>РЭС<select value={filters.resId} onChange={e=>set('resId',e.target.value)}><option value="">Все доступные РЭС</option>{resUnits.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
        <label>Статус<select value={filters.status} onChange={e=>set('status',e.target.value)}><option value="">Все статусы</option>{Object.entries(statusNames).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
        <label>Этап<select value={filters.stage} onChange={e=>set('stage',e.target.value)}><option value="">Все этапы</option>{['RIRU','RES_HEAD','PARALLEL','SUE','STP','GI','COMPLETED'].map(r=><option key={r} value={r}>{roleNames[r]}</option>)}</select></label>
        <label>Дата создания с<input type="date" value={filters.from} onChange={e=>set('from',e.target.value)}/></label><label>Дата создания по<input type="date" value={filters.to} onChange={e=>set('to',e.target.value)}/></label>
        <label>Замечания<select value={filters.comments} onChange={e=>set('comments',e.target.value)}><option value="">Все документы</option><option value="with">С замечаниями</option><option value="without">Без замечаний</option></select></label>
      </div><div className="filter-flags"><span><Icon name="filter" size={14}/>Уточнить выборку</span><label><input type="checkbox" checked={filters.overdue} onChange={e=>set('overdue',e.target.checked)}/>Просроченные</label><label><input type="checkbox" checked={filters.mine} onChange={e=>set('mine',e.target.checked)}/>Мои документы</label><label><input type="checkbox" checked={filters.action||tasksMode} disabled={tasksMode} onChange={e=>set('action',e.target.checked)}/>Требуют моего действия</label><small>Показатели учитывают фильтры и права доступа</small></div>
    </section>
    <section className="card registry-table-card"><div className="registry-table-heading"><div><h2>{tasksMode?'Документы, требующие решения':'Акты технологического присоединения'}</h2><p>Найдено: {data.total} · Параллельная проверка СУЭ, СТП и ГИ обозначена общей группой</p></div>{busy&&<span className="loading-label" role="status">Обновление…</span>}</div>
      <div className="registry-scroll" tabIndex={0} aria-label="Таблица актов"><table className="registry-table"><thead><tr><th>Акт / договор</th><th>Заявитель / объект</th><th>РЭС</th><th>Дата</th><th>Маршрут согласования</th><th>Статус</th><th>Замеч.</th><th>Срок, МСК</th><th>Действия</th></tr></thead>
        <tbody>{data.items.map(a=><tr key={a.id} data-testid={`registry-row-${a.id}`} className={a.overdue?'registry-row-overdue':''}>
          <td data-label="Акт / договор" className="registry-number"><b>{a.act_number}</b><small>{a.contract_number}</small>{a.version&&<span className="version-caption">Word v{a.version} · цикл {a.cycle??'—'}</span>}</td>
          <td data-label="Заявитель / объект" className="registry-applicant"><span>{a.applicant}</span><small title={a.address}>{a.address}</small></td><td data-label="РЭС">{a.res_name}</td><td data-label="Дата">{shortDate(a.created_at)}</td>
          <td data-label="Маршрут" className="registry-route-cell"><RouteFlow route={a.route} compact/><span className="stage-caption">{a.state==='CENTRAL_COLLECTING'?'Сбор замечаний продолжается':a.state==='RETURNED'?'Возвращён РИРУ на доработку':roleNames[a.stage]}</span></td>
          <td data-label="Статус"><StatusBadge status={a.status}/>{a.overdue&&a.status!=='OVERDUE'&&<span className="deadline-danger"><Icon name="alert" size={12}/>Просрочено</span>}</td>
          <td data-label="Замечания"><button className={`comment-count ${a.commentCount?'has-comments':''}`} disabled={!a.commentCount||busy} onClick={()=>onAction('comments',a)} aria-label={`Замечания акта ${a.act_number}: ${a.commentCount}`}><Icon name="comment" size={14}/>{a.commentCount}</button></td>
          <td data-label="Срок" className="registry-deadline">{a.due_at?<><time>{dateTime(a.due_at)}</time>{a.overdue&&<strong>Просрочено</strong>}</>:<span className="muted">—</span>}</td>
          <td data-label="Действия" className="registry-actions"><div className="row-actions">
            <IconButton icon="open" label="Открыть карточку" onClick={()=>onAction('open',a)} disabled={busy}/><IconButton icon="matrix" label="Открыть матрицу" onClick={()=>onAction('matrix',a)} disabled={busy}/>
            <IconButton icon="check" label="Согласовать акт" onClick={()=>onAction('approve',a)} disabled={busy||!a.actions.approve} reason={a.actions.approveReason}/><IconButton icon="return" label="Вернуть с замечаниями" onClick={()=>onAction('return',a)} disabled={busy||!a.actions.return} reason={a.actions.returnReason}/>
            <IconButton icon="print" label="Печать DOCX" onClick={()=>{}} disabled reason="Генератор чистовой и служебной печати ещё не проверен"/>
            <IconButton icon="download" label="Скачать Word" onClick={()=>onAction('download',a)} disabled={busy||!a.actions.downloadFileId} reason="Документ Word ещё не загружен"/>
            <IconButton icon="history" label="История акта" onClick={()=>onAction('history',a)} disabled={busy}/><IconButton icon="comment" label="Открыть замечания" onClick={()=>onAction('comments',a)} disabled={busy||!a.commentCount} reason="Замечаний пока нет"/>
          </div></td>
        </tr>)}</tbody></table>
        {!data.items.length&&<div className="empty-state"><span><Icon name="search" size={28}/></span><h3>Документы не найдены</h3><p>Измените условия поиска или сбросьте фильтры.</p></div>}
      </div><div className="pagination"><span>{data.total?`${(page-1)*data.limit+1}–${Math.min(page*data.limit,data.total)} из ${data.total}`:'0 документов'}</span><div><button className="secondary-button" disabled={page<=1||busy} onClick={()=>onPage(page-1)}>Назад</button><span>Страница {page}</span><button className="secondary-button" disabled={page*data.limit>=data.total||busy} onClick={()=>onPage(page+1)}>Далее</button></div></div>
    </section>
  </section>;
}
