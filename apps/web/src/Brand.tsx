import './brand.css';

/** Фирменный знак (как в «Учёте ПУ»): молния в синем скруглённом квадрате. */
export function BrandMark({className='rosseti-mark'}:{className?:string}){
 return <span className={className} aria-hidden="true">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>
 </span>;
}

/** Фирменная загрузка РОССЕТИ (как в «Учёте ПУ»): буквы по очереди загораются синим. Текст — для экранного диктора. */
export function RossetiLoader({label='Загрузка…',size='normal'}:{label?:string;size?:'normal'|'small'}){
 return <div role="status" className={`rosseti-loader rosseti-${size}`}>
  <span className="rosseti-letters" aria-hidden="true">{['Р','О','С','С','Е','Т','И'].map((l,i)=><span key={i} className="rosseti-letter" style={{animationDelay:`${i*0.3}s`}}>{l}</span>)}</span>
  <span className="rosseti-label">{label}</span>
 </div>;
}
