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

test('Act rules: место границы по рисунку сверяется с описанием',()=>{
 const desc=description('- контакты присоединения СИП 4х16 L=9м заявителя от опоры №7 ВЛ-0,4кВ ф. «Лесной» ТП-Б12 сетевой организации в сторону ВРУ-0,4кВ заявителя');
 const on=(o:object)=>byField(actFindings({blocks:[...desc,...scheme] as any,boundaries:[{...boundaries[0],on:o}] as any})).boundaryPlace;
 const pole=on({kind:'pole',box:[290,596,302,608]});
 assert.equal(pole.status,'MATCH');assert.deepEqual(pole.act[0].area,{page:2,box:[290,596,302,608]});
 assert.equal(on({kind:'box',label:'ВРУ-0,4 кВ Заявителя',box:[0,0,1,1]}).status,'DIFFERENCE');
 const tpDesc=description('- контакты подключения КЛ-0,23 кВ ВВГ 2х4 L=3 м заявителя от ВУ-0,4 кВ ж/д по ул. Северная, 16, ТП-176 сетевой организации в сторону ВРУ-0,23 кВ заявителя');
 const tp=byField(actFindings({blocks:tpDesc as any,boundaries:[{...boundaries[0],on:{kind:'box',label:'ВУ-0,4 кВ ж.д. по ул. Северная, 16 ТП-176 СРЭС',box:[0,0,1,1]}}] as any})).boundaryPlace;
 assert.equal(tp.status,'MATCH');assert.match(tp.reason,/РУ\/ВУ ТП/);
 assert.equal(byField(actFindings({blocks:desc as any,boundaries})).boundaryPlace.status,'INFO','Line not on a pole or a box — a person looks');
});

test('Act rules: единообразие переменных шаблона по всему акту',()=>{
 const blocks=[block('a','ВРУ-0,23 кВ, КЛ-0,23 кВ ВВГ 2х4 L=3 м, ВА 40 А'),block('b','контакты подключения ВВГ 2х4 L=3 м от ВУ-0,4 кВ ТП-176 в сторону ВРУ-0,23 кВ'),
  block('c','ВРУ-0,22 кВ Герун Ж.И. Р=7 кВт'),block('d','ВА 40 А'),block('e','ВУ-0,4 кВ ж.д. по ул. Северная, 16 ТП-176 СРЭС')];
 const f=byField(actFindings({blocks:blocks as any}));
 assert.equal(f['same.ВРУ'].status,'MATCH','0,22 and 0,23 kV are the same voltage');
 assert.equal(f['same.ТП'].status,'MATCH');assert.equal(f['same.вводной автомат'].status,'MATCH');assert.equal(f['same.длина провода'].status,'MATCH');
 const old=byField(actFindings({blocks:[...blocks,block('x','фидер «Альпийская» ТП-47 СРЭС, ВА 25 А')] as any}));
 assert.equal(old['same.ТП'].status,'MANUAL_REVIEW');assert.match(old['same.ТП'].reason,/ТП-176 \(2 места\), ТП-47 \(1 место\)/);
 assert.equal(old['same.ТП'].act[0].shown,'ТП-47','The odd value comes first');
 assert.equal(old['same.вводной автомат'].status,'MANUAL_REVIEW');
});
