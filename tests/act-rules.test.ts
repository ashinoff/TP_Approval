import test from 'node:test';
import assert from 'node:assert/strict';
import {actFindings} from '../apps/api/src/act-rules.js';
// Синтетические абзацы; у PDF-блоков — страница и координаты кусков (y растёт вверх, как в PDF).
const block=(id:string,text:string,extra:Record<string,unknown>={})=>({id,part:'pdf/page1',text,sha256:'',...extra});
const at=(y:number)=>({page:2,spans:[{item:0,start:0,end:1,box:[200,y,260,y+8]}]});
const byField=(f:any[])=>Object.fromEntries(f.map(x=>[x.field,x]));
const responsibility=(seals:string,verification:string)=>[
 block('s',`8.1. Ответственность за целостность пломб госповерителя и энергоснабжающей организации, сохранность схемы и приборов учета несет: ${seals}.`),
 block('v',`8.2. Ответственность за своевременную метрологическую поверку счетчиков, трансформаторов тока и трансформаторов напряжения несет: ${verification}.`),
];

test('Act rules: п. 8.2 — поверку всегда несёт сетевая организация',()=>{
 const ok=byField(actFindings({blocks:responsibility('Заявитель','Сетевая организация')}));
 assert.equal(ok.verificationParty.status,'MATCH');assert.equal(ok.verificationParty.act[0].shown,'Сетевая организация');
 const bad=byField(actFindings({blocks:responsibility('Заявитель','Заявитель')}));
 assert.equal(bad.verificationParty.status,'DIFFERENCE');assert.match(bad.verificationParty.reason,/должна быть «Сетевая организация»/);
});

test('Act rules: п. 8.1 — сторона подтверждается человеком',()=>{
 for(const party of ['Заявитель','Сетевая организация']){
  const f=byField(actFindings({blocks:responsibility(party,'Сетевая организация')})).sealsParty;
  assert.equal(f.status,'MANUAL_REVIEW');assert.equal(f.act[0].shown,party);assert.match(f.reason,/Подтвердите/);
 }
 assert.match(byField(actFindings({blocks:responsibility('Потребитель','Сетевая организация')})).sealsParty.reason,/ожидается «Заявитель» или «Сетевая организация»/);
});

const description=(text:string)=>[
 block('h',"Описание границ балансовой принадлежности объектов электроэнергетики",{table:{table:1,row:0,cell:0}}),
 block('d',text,{table:{table:1,row:1,cell:0}}),
 block('nh','Наименование электроустановки (оборудования), находящейся в эксплуатации сетевой организации',{table:{table:2,row:0,cell:0}}),
 block('ah','Наименование электроустановки (оборудования), находящейся в эксплуатации заявителя',{table:{table:2,row:0,cell:1}}),
 block('n','опора №7 ВЛ-0,4 кВ фидер «Лесной» ТП-Б12',{table:{table:2,row:1,cell:0}}),
 block('a','СИП 4х16 L=9м, ВРУ-0,4 кВ',{table:{table:2,row:1,cell:1}}),
];
const scheme=[block('l1','ВЛ-0,4 кВ «Лесной»',at(610)),block('l2','оп. №7',at(618)),block('l3','СИП 4х16 L=9м',at(580)),block('l4','8.5. Приборы учета установлены в: ВРУ-0,4 кВ.',at(560))];
const boundaries=[{page:2,y:600,x0:150,x1:320,networkAbove:true}];

test('Act rules: граница на схеме совпадает с описанием',()=>{
 const f=byField(actFindings({blocks:[...description('- контакты присоединения СИП 4х16 L=9м заявителя от ВЛ-0,4кВ ф. «Лесной» ТП-Б12 сетевой организации'),...scheme] as any,boundaries})).boundaryScheme;
 assert.equal(f.status,'MATCH');
 assert.match(f.norm,/Сетевая организация: ВЛ-0,4 кВ «Лесной», оп\. №7; заявитель: СИП 4х16/);
 assert.ok(!f.act.some((v:any)=>v.blockId==='l4'),'Numbered paragraph under the scheme is not a scheme label');
 assert.ok(f.act.some((v:any)=>v.blockId==='d'&&v.shown==='ф. «Лесной»'),'The matching value in the description is marked');
});

test('Act rules: элемент схемы записан за другой стороной или отсутствует',()=>{
 const wrong=[...description('- контакты присоединения заявителя от ВЛ-0,4кВ ф. «Лесной» ТП-Б12'),...scheme].map(b=>b.id==='a'?{...b,text:'ВРУ-0,4 кВ'}:b.id==='n'?{...b,text:'опора №7 ВЛ-0,4 кВ фидер «Лесной», СИП 4х16'}:b);
 assert.equal(byField(actFindings({blocks:wrong as any,boundaries})).boundaryScheme.status,'DIFFERENCE');
 const missing=[...description('- контакты присоединения от ВЛ-0,4кВ ф. «Лесной»'),...scheme].map(b=>b.id==='a'?{...b,text:'ВРУ-0,4 кВ'}:b);
 const f=byField(actFindings({blocks:missing as any,boundaries})).boundaryScheme;
 assert.equal(f.status,'MANUAL_REVIEW');assert.match(f.reason,/СИП 4х16/);
 assert.equal(byField(actFindings({blocks:missing as any})).boundaryScheme,undefined,'No red line — no boundary finding');
});
