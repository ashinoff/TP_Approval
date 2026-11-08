import {Icon} from './Ui.js';

/**
 * Панель просмотра документа в одну строку (09.11.2026): масштаб и «по ширине» — значки в рамке со свечением,
 * номер страницы, поиск с подсказкой в самом поле и переход к следующему совпадению. Проценты масштаба — в подсказке.
 */
export default function ViewerTools({zoom,onZoom,onFit,page,pages,onPage,query,onQuery,hits,hit,onNext}:{zoom:number;onZoom:(z:number)=>void;onFit:()=>void;page:number;pages:number;onPage:(n:number)=>void;query:string;onQuery:(q:string)=>void;hits:number;hit:number;onNext:()=>void}){
 return <div className="word-tools viewer-tools">
  <div className="zoom-control" role="group" aria-label="Масштаб">
   <button type="button" className="tool-icon" aria-label="Уменьшить" title={`Уменьшить · ${zoom}%`} disabled={zoom<=40} onClick={()=>onZoom(Math.max(40,zoom-10))}><Icon name="zoomout" size={18}/></button>
   <output className="sr-only" aria-live="polite">{zoom}%</output>
   <button type="button" className="tool-icon" aria-label="Увеличить" title={`Увеличить · ${zoom}%`} disabled={zoom>=200} onClick={()=>onZoom(Math.min(200,zoom+10))}><Icon name="zoomin" size={18}/></button>
   <button type="button" className="tool-icon zoom-fit" aria-label="По ширине" title="Страница по ширине окна" onClick={onFit}><Icon name="fitwidth" size={18}/></button>
  </div>
  {pages>1&&<select className="page-select" aria-label="Страница" title="Перейти к странице" value={page} onChange={e=>onPage(Number(e.target.value))}>{Array.from({length:pages},(_,i)=><option key={i} value={i+1}>{i+1} / {pages}</option>)}</select>}
  <label className="viewer-search"><Icon name="search" size={16}/><input aria-label="Поиск в документе" placeholder="Поиск в документе" value={query} onChange={e=>onQuery(e.target.value)}/>
   {query.trim()&&<span className="viewer-hits">{hits?`${hit+1}/${hits}`:'0'}</span>}
   <button type="button" className="tool-icon" aria-label="Далее" title="Следующее совпадение" disabled={!hits} onClick={onNext}><Icon name="next" size={16}/></button>
  </label>
 </div>;
}
