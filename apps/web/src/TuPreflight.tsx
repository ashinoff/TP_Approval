import {useState} from 'react';
import {dateTime} from './Ui.js';
import {openBlockers} from './ActDocument.js';

type Row=Record<string,any>;

const statusText:Record<string,string>={MATCH:'✓ Совпадает',DIFFERENCE:'⚠ Расхождение',MANUAL_REVIEW:'? Проверить вручную',UNKNOWN:'? Не распознано',INFO:'i Для сведения'};
const CONFIRMABLE=['MANUAL_REVIEW','UNKNOWN'];
const RULES_HINT='Сверка выполняется локально по правилам, без ИИ: договор, заявитель, номер ТУ, мощность, напряжение, питающий центр, адрес, точка присоединения и пункты ТУ, а также номиналы ВА, трансформаторов тока и сечение провода по справочникам. Это помощь инженеру, а не инженерная экспертиза: спорные пункты проверяет человек.';

/** Shown value: the human form if the rule supplied one, otherwise the paragraph text. */
const shown=(v:Row)=>v.shown??v.quote;

type Jump=(blockId:string,side:'act'|'tu')=>void;
function Evidence({side,values,onJump}:{side:string;values:Row[];onJump?:Jump}){
 if(!values?.length)return <p className="tu-evidence tu-evidence-missing"><span>{side}</span>не найдено</p>;
 return <>{values.map((v,i)=><p className="tu-evidence" key={i}>
  <span>{side}</span>
  {onJump?<button type="button" className="tu-quote" title={v.quote} onClick={()=>onJump(v.blockId,side==='ТУ'?'tu':'act')}>{shown(v)}</button>:<q title={v.quote}>{shown(v)}</q>}
 </p>)}</>;
}

function ConfirmForm({field,busy,onConfirm}:{field:Row;busy:boolean;onConfirm:(field:string,comment:string)=>void}){
 const [open,setOpen]=useState(false),[comment,setComment]=useState('');
 if(!open)return <button type="button" className="secondary-button tu-confirm-open" disabled={busy} onClick={()=>setOpen(true)}>Подтвердить вручную</button>;
 return <form className="tu-confirm" aria-label={`Подтверждение: ${field.label}`} onSubmit={e=>{e.preventDefault();if(comment.trim().length>=10)onConfirm(field.field,comment.trim());}}>
  <label>Что сверено и почему значение верное<textarea value={comment} minLength={10} maxLength={2000} required onChange={e=>setComment(e.target.value)} placeholder="Например: точка присоединения в АВТУ соответствует п. 7 ТУ, ТП-Н100"/></label>
  <div className="tu-confirm-actions">
   <button className="primary-button" disabled={busy||comment.trim().length<10}>Подтвердить</button>
   <button type="button" onClick={()=>{setOpen(false);setComment('');}}>Отмена</button>
  </div>
 </form>;
}

/**
 * «Сверка с ТУ». The engineer runs the check and confirms disputable items; reviewers see the same report read-only,
 * including who confirmed what manually.
 */
export default function TuPreflight({check,required,busy,editable=true,onCheck,onConfirm,onJump,tuJump}:{check?:Row;required:boolean;busy:boolean;editable?:boolean;onCheck?:()=>void;onConfirm?:(field:string,comment:string)=>void;onJump?:Jump;tuJump?:boolean}){
 const onTuJump=tuJump?onJump:undefined;
 const findings:Row[]=check?.findings??[];
 const confirmations:Row[]=check?.confirmations??[];
 const confirmed=new Map<string,Row>(confirmations.map(c=>[c.field as string,c] as [string,Row]));
 const blockers=openBlockers(check);
 const count=(status:string)=>findings.filter(f=>f.status===status).length;
 let summary:string;
 if(!required)summary='Проверка отключена для этого прежнего учебного сценария.';
 else if(!check)summary=editable?'До отправки проверьте текущую версию по прикреплённым ТУ.':'Сверка с ТУ для этой версии не выполнялась.';
 else if(check.status==='PASS')summary='Проверенные реквизиты совпали. Можно отправить на согласование.';
 else if(!blockers.length)summary=editable?'Спорные пункты подтверждены вручную. Можно отправить на согласование.':'Инженер подтвердил спорные пункты вручную — см. комментарии ниже.';
 else if(blockers.some((b:Row)=>b.status==='DIFFERENCE'))summary='Отправка заблокирована: исправьте расхождения с ТУ в документе.';
 else summary='Отправка заблокирована: подтвердите спорные пункты вручную или исправьте документ.';
 return <section className="tu-preflight" aria-label="Сверка с техническими условиями">
  <div className="section-heading">
   <h3>Сверка с ТУ <span className="info-hint" title={RULES_HINT} aria-label={RULES_HINT}>i</span></h3>
   {editable&&onCheck&&<button type="button" disabled={busy} onClick={onCheck}>Проверить по ТУ</button>}
  </div>
  <p className={`tu-summary${check&&blockers.length?' tu-summary-blocked':''}`}>{summary}</p>
  {findings.length>0&&<p className="tu-counts">
   <span className="tu-count-ok">Совпадает: {count('MATCH')}</span>
   {count('DIFFERENCE')>0&&<span className="tu-count-bad">Расхождений: {count('DIFFERENCE')}</span>}
   {count('MANUAL_REVIEW')+count('UNKNOWN')>0&&<span className="tu-count-warn">Проверить вручную: {count('MANUAL_REVIEW')+count('UNKNOWN')}{confirmations.length?`, подтверждено: ${confirmations.length}`:''}</span>}
   {check?.created_at&&<span>Проверено {dateTime(check.created_at)}</span>}
  </p>}
  <ul className="tu-findings">
   {findings.filter(f=>f.status!=='MATCH').map(f=>{
    const confirmation=confirmed.get(f.field);
    const state=f.status==='MATCH'?'ok':f.status==='INFO'?'info':f.status==='DIFFERENCE'?'bad':confirmation?'confirmed':'warn';
    return <li key={f.field} className={`tu-finding tu-${state}`}>
     <div className="tu-finding-head">
      <b>{f.label}</b>
      <strong className={f.status==='MATCH'?'success':f.status==='INFO'?'':'deadline-danger'}>{statusText[f.status]??f.status}</strong>
     </div>
     {f.status!=='MATCH'&&<p className="tu-reason">{f.reason}</p>}
     <Evidence side="Акт" values={f.act} onJump={onJump}/>
     {(!f.norm||f.tu?.length>0)&&<Evidence side="ТУ" values={f.tu} onJump={onTuJump}/>}
     {f.norm&&<p className="tu-evidence tu-norm"><span>Норма</span>{f.norm}</p>}
     {confirmation&&<p className="tu-confirmed">Подтверждено вручную: {confirmation.actorName}, {dateTime(confirmation.createdAt)}. «{confirmation.comment}»</p>}
     {!confirmation&&editable&&onConfirm&&CONFIRMABLE.includes(f.status)&&<ConfirmForm field={f} busy={busy} onConfirm={onConfirm}/>}
    </li>;
   })}
  </ul>
  {count('MATCH')>0&&<details className="tu-matches" open={findings.every(f=>f.status==='MATCH')||undefined}>
   <summary>Совпадает: {count('MATCH')}</summary>
   <ul>
    {findings.filter(f=>f.status==='MATCH').map(f=><li key={f.field} className="tu-match">
     <span className="tu-match-label" title={f.norm}>✓ {f.label}</span>
     <span className="tu-match-value" title={f.act[0]?.quote}>{f.act[0]?(onJump?<button type="button" className="tu-quote" onClick={()=>onJump(f.act[0].blockId,'act')}>{shown(f.act[0])}</button>:shown(f.act[0])):''}</span>
    </li>)}
   </ul>
  </details>}
 </section>;
}
