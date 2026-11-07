/**
 * Плавный бегунок в таблетках-переключателях (решение владельца 06.11.2026): подсветка выбранной кнопки —
 * отдельный слой, который при нажатии плавно перетекает к новой кнопке (в том числе через соседние).
 * Работает для всех таблеток приложения без правки каждого компонента: следим за aria-pressed/aria-selected.
 */
// 08.11.2026: .queue-switch и .doc-type-switch — вкладки со значками в рамке (как разделы документа), без бегунка.
const GROUPS='.review-subtabs,.note-filter,.review-tabs';
const ACTIVE='[aria-pressed="true"],[aria-selected="true"]';

function place(group:HTMLElement){
 const active=group.querySelector<HTMLElement>(`:scope > ${ACTIVE.split(',').join(',:scope > ')}`);
 let thumb=group.querySelector<HTMLElement>(':scope > .pill-thumb');
 if(!active){thumb?.classList.remove('is-visible');return;}
 if(!thumb){thumb=document.createElement('span');thumb.className='pill-thumb';thumb.setAttribute('aria-hidden','true');group.prepend(thumb);
  // Первая установка — без анимации, чтобы бегунок не «прилетал» при открытии страницы.
  thumb.style.transition='none';requestAnimationFrame(()=>requestAnimationFrame(()=>{thumb!.style.transition='';}));}
 const g=group.getBoundingClientRect(),a=active.getBoundingClientRect();
 if(!a.width){thumb.classList.remove('is-visible');return;}
 thumb.style.width=`${a.width}px`;thumb.style.height=`${a.height}px`;
 thumb.style.transform=`translate(${a.left-g.left-group.clientLeft}px,${a.top-g.top-group.clientTop}px)`;
 thumb.classList.add('is-visible');group.classList.add('has-thumb');
}

export function startSlidingPills(){
 let queued=false;
 const update=()=>{if(queued)return;queued=true;requestAnimationFrame(()=>{queued=false;document.querySelectorAll<HTMLElement>(GROUPS).forEach(place);});};
 const observer=new MutationObserver(update);
 observer.observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['aria-pressed','aria-selected']});
 window.addEventListener('resize',update);update();
 return()=>{observer.disconnect();window.removeEventListener('resize',update);};
}
