import test from 'node:test';
import assert from 'node:assert/strict';
import {xmlBlocks} from '../apps/api/src/documents.js';
import {compareRequisites,findingsPass,RULES_VERSION} from '../apps/api/src/tu-rules.js';

// ---------- Generic «Label: value» documents (earlier synthetic fixtures) ----------

const generic=(power='15 кВт',voltage='0,4 кВ',contract='00001-TEST-1',point='РУ-0,4 кВ ТП-У001')=>xmlBlocks('<w:document xmlns:w="w"><w:body>'+[
 `Приложение к договору № ${contract}`,
 `Максимальная мощность: ${power}, в том числе существующая мощность 7 кВт.`,
 `Класс напряжения: ${voltage}.`,
 'Адрес объекта: Учебный адрес, д. 15/31, к/н 00:00:0000000:001',
 `Точка присоединения: ${point}.`,
].map(s=>`<w:p><w:r><w:t>${s}</w:t></w:r></w:p>`).join('')+'</w:body></w:document>','word/document.xml');
type F=ReturnType<typeof compareRequisites>;
const field=(f:F,name:string)=>{const found=f.find(x=>x.field===name);assert.ok(found,`finding ${name}`);return found!;};

test('TU rules V4: version label',()=>assert.equal(RULES_VERSION,'DOCX_CONTEXT_V4'));

test('TU rules: exact units, decimal separators and leading-zero contract; existing power is not total',()=>{
 const f=compareRequisites(generic('15,0 кВт','400 В'),generic('15000 Вт'),'00001-TEST-1');
 assert.ok(f.every(r=>r.status==='MATCH'),JSON.stringify(f.map(r=>[r.field,r.status])));
 assert.equal(field(f,'power').act[0].value,'15000/1');
 assert.equal(field(f,'powerExisting').act[0].value,'7000/1');
 assert.equal(f.find(r=>r.field==='powerNew'),undefined,'derived on both sides: not reported separately');
 assert.ok(f.every(r=>r.act[0].blockId&&r.tu[0].quote));
 assert.ok(findingsPass(f));
});

test('TU rules: wrong power, voltage, contract and card identity block; missing/ambiguous are not matches',()=>{
 for(const [b,name] of [[generic('16 кВт'),'power'],[generic('15 кВт','600 В'),'voltage'],[generic('15 кВт','0,4 кВ','00002-TEST-1'),'contract']] as const)assert.equal(field(compareRequisites(b,generic(),'00001-TEST-1'),name).status,'DIFFERENCE');
 assert.equal(field(compareRequisites(generic(),generic(),'OTHER'),'contract').status,'DIFFERENCE');
 const empty=compareRequisites([],generic(),'00001-TEST-1');
 for(const name of ['contract','power','voltage','address','point'])assert.equal(field(empty,name).status,'UNKNOWN');
 assert.equal(findingsPass(empty),false);
 const ambiguous=[...generic(),...generic('16 кВт')];
 assert.equal(field(compareRequisites(ambiguous,generic(),'00001-TEST-1'),'power').status,'UNKNOWN');
});

test('TU rules: matching TP code does not prove equivalence of physical connection descriptions',()=>{
 const f=compareRequisites(generic('15 кВт','0,4 кВ','00001-TEST-1','Контакты кабеля от РУ-0,4 кВ ТП-У001'),generic(),'00001-TEST-1');
 assert.equal(field(f,'point').status,'MANUAL_REVIEW');
 const other=compareRequisites(generic('15 кВт','0,4 кВ','00001-TEST-1','Контакты кабеля от РУ-0,4 кВ ТП-У010'),generic(),'00001-TEST-1');
 assert.equal(field(other,'point').status,'DIFFERENCE');
});

test('TU rules: contradictory repeated labels in one paragraph and unresolved table headers stay unknown',()=>{
 const values=generic();
 values[1]={...values[1],text:'Максимальная мощность: 15 кВт; Максимальная мощность: 20 кВт'};
 assert.equal(field(compareRequisites(values,generic(),'00001-TEST-1'),'power').status,'UNKNOWN');
 values[1]={...values[1],text:'Максимальная мощность'};
 assert.equal(field(compareRequisites(values,values,'00001-TEST-1'),'power').status,'UNKNOWN');
});

test('TU rules: unsafe numeric forms and significant address punctuation cannot create false matches',()=>{
 for(const value of ['-15 кВт','1e3 кВт','10–15 кВт','15 кВт/ч','15 кВт·ч','15±1 кВт'])assert.equal(field(compareRequisites(generic(value),generic(),'00001-TEST-1'),'power').status,'UNKNOWN',value);
 assert.equal(field(compareRequisites(generic('15 000 Вт'),generic(),'00001-TEST-1'),'power').status,'MATCH');
 const address=(s:string)=>generic().map(b=>({...b,text:b.text.replace('15/31',s)}));
 assert.equal(field(compareRequisites(address('1.1'),address('11'),'00001-TEST-1'),'address').status,'DIFFERENCE');
});

// ---------- Synthetic copy of the standard «Россети Юг» templates: TU with Word numbering, AVTU with tables ----------

const NS='xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const esc=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;');
const p=(text:string,level?:number)=>`<w:p>${level===undefined?'':`<w:pPr><w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="1"/></w:numPr></w:pPr>`}<w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
const table=(rows:string[][])=>`<w:tbl><w:tblPr/>${rows.map(r=>`<w:tr>${r.map(c=>`<w:tc>${p(c)}</w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`;
type Template={contract:string;applicant:string;house:string;tp:string;power:string;existing:string;added:string;applicantItems:number;actApplicantItems:number;centre:string};
const base:Template={contract:'00000-26-00000001-1',applicant:'Учебный Пётр Сергеевич',house:'7',tp:'ТП-Н100',power:'15',existing:'7',added:'8',applicantItems:6,actApplicantItems:6,centre:'ПС 110/10 кВ «Учебная»'};
function tu(t=base){
 const address=`Учебный край, с. Примерное, ул. Береговая, д. ${t.house}, к/н 00:00:0000000:111.`;
 const body=[
  p('07-05/0001-26'),p(`Приложение к договору № ${t.contract}`),p('об осуществлении технологического присоединения к электрическим сетям'),
  p(`Заявитель: ${t.applicant}.`),
  p('Наименование энергопринимающих устройств Заявителя: ЭПУ нежилого здания.',0),
  p(`Наименование и место нахождения объектов …: «Нежилое здание» по адресу: ${address}`,0),
  p(`Максимальная мощность присоединяемых энергопринимающих устройств Заявителя: ${t.power} кВт, в том числе существующая мощность ${t.existing} кВт.`,0),
  p('Категория надежности: III-8 кВт.',0),
  p('Класс напряжения электрических сетей, к которым осуществляется технологическое присоединение: 0,4 кВ.',0),
  p(`Точка(и) присоединения (вводные распределительные устройства, линии электропередачи): РУ-0,4 кВ ${t.tp} УРЭС (15 кВт).`,0),
  p(`Основной источник питания: ${t.centre}.`,0),p('Резервный источник питания: нет.',0),
  p('Сетевая организация осуществляет (до точки присоединения):',0),...Array.from({length:6},(_,i)=>p(`Мероприятие сетевой организации ${i+1}.`,1)),p(''),
  p('Заявитель осуществляет (от точки присоединения):',0),...Array.from({length:t.applicantItems},(_,i)=>p(`Мероприятие заявителя ${i+1}, от точки присоединения, указанной в пункте 7.`,1)),
  p(`Срок действия настоящих технических условий составляет 2 года со дня заключения договора №${t.contract} об осуществлении технологического присоединения.`,0),
 ].join('');
 return [...xmlBlocks(`<w:document ${NS}><w:body>${body}</w:body></w:document>`,'word/document.xml'),...xmlBlocks(`<w:ftr ${NS}>${p('07-05/0001-26')}</w:ftr>`,'word/footer1.xml')];
}
function avtu(t=base){
 const address=`Учебный край, с. Примерное, ул. Береговая, д. ${t.house}, к/н 00:00:0000000:111`;
 const body=[
  p('АКТ'),p('О ВЫПОЛНЕНИИ ТЕХНИЧЕСКИХ УСЛОВИЙ'),p('№ 07-05/0001-26 от 28 октября 2026 г.'),
  p(`Публичным акционерным обществом «Сетевая компания», именуемым в дальнейшем Сетевой организацией, с одной стороны и ${t.applicant}, именуемый(ая) в дальнейшем Заявитель, с другой стороны, составили настоящий акт:`),
  p(`1. Характеристики присоединения по техническим условиям от 01.09.2026 № 07-05/0001-26 к договору от 01.09.2026 № ${t.contract} об осуществлении технологического присоединения к электрическим сетям энергопринимающих устройств: «ЭПУ нежилого здания», ${address}.`),
  p('2. В ходе проверки рассмотрено выполнение ТУ от 01.09.2026 № 07-05/0001-26:'),
  p('Сетевая организация осуществляет: Пункты 10.1 - 10.6 - выполнены.'),p(`Заявитель осуществляет: Пункты 11.1 - 11.${t.actApplicantItems} - выполнены.`),
  p(`3. Максимальная мощность (всего) ${t.power},0 (пятнадцать) кВт, в том числе:`),
  p(`максимальная мощность (без учета ранее присоединенной (существующей) максимальной мощности) ${t.added},0 кВт;`),
  p(`ранее присоединенная максимальная мощность ${t.existing},0 кВт`),p('максимальная мощность объектов микрогенерации (всего) 0,0 кВт.'),
  p('Категория надежности электроснабжения'),p('I-ая – 0,0 кВт;'),p('II-ая – 0,0 кВт;'),p(`III-я – ${t.power},0 кВт.`),
  p('Перечень точек присоединения:'),
  table([['N','Источник питания (наименование питающих линий)','Описание точки присоединения','Уровень напряжения (кВ)','Максимальная мощность (кВт)','Максимальная мощность объектов микрогенерации (кВт)'],
   ['1',t.centre.replace(' «','   «'),`Контакты присоединения СИП 4х16 кВ Заявителя от РУ-0,4 кВ  ${t.tp} Сетевой организации в сторону ВПУ-0,4 кВ Заявителя`,'0,4',`${t.power},0`,'0,0']]),
  p(`5. Проведен осмотр электроустановок заявителя ВПУ-0,4 кВ, расположенных по адресу: ${address}, сетевой организацией в лице электромонтера, построенных в рамках выполнения технических условий от 01.09.2026 № 07-05/0001-26 к договору от 01.09.2026 № ${t.contract}.`),
  table([['Место установки узла учета электроэнергии','Тип','Зав. №','Класс точности','Ктт; Ктн','Поверка'],['ВПУ-0,4 кВ','Учебный счётчик','00000001','1,0s','-','08.11.2024']]),
  p('7. Прочие отметки: Нет.'),
 ].join('');
 return xmlBlocks(`<w:document ${NS}><w:body>${body}</w:body></w:document>`,'word/document.xml');
}

test('TU rules V4: table metadata and Word list levels are read without changing block ids',()=>{
 const blocks=avtu();
 assert.ok(blocks.every((b,i)=>b.id===`word/document.xml:p:${i}`));
 const header=blocks.find(b=>b.text==='Уровень напряжения (кВ)')!;
 assert.deepEqual(header.table,{table:0,row:0,cell:3});
 assert.deepEqual(blocks.find(b=>b.text==='0,4')!.table,{table:0,row:1,cell:3});
 assert.equal(tu().find(b=>b.text.startsWith('Мероприятие сетевой'))!.numbering!.level,1);
});

test('TU rules V4: the standard TU + AVTU pair matches; only the connection point needs a person',()=>{
 const f=compareRequisites(avtu(),tu(),base.contract);
 const statuses=Object.fromEntries(f.map(x=>[x.field,x.status]));
 assert.deepEqual(statuses,{contract:'MATCH',power:'MATCH',voltage:'MATCH',address:'MATCH',point:'MANUAL_REVIEW',applicant:'MATCH',tuNumber:'MATCH',powerExisting:'MATCH',powerNew:'MATCH',supplyCenter:'MATCH',epuName:'MATCH',tuItemsNetwork:'MATCH',tuItemsApplicant:'MATCH',reliability:'INFO'});
 assert.equal(field(f,'power').act.find(v=>v.value==='15000/1')!.shown,'15 кВт');
 assert.equal(field(f,'voltage').act[0].shown,'0,4 кВ');
 assert.equal(findingsPass(f),false);
 assert.ok(findingsPass(f.filter(x=>x.field!=='point')));
});

test('TU rules V4: real-template discrepancies are found',()=>{
 const check=(changed:Partial<Template>,name:string,status='DIFFERENCE',inTu=false)=>{
  const t={...base,...changed};
  const f=compareRequisites(inTu?avtu():avtu(t),inTu?tu(t):tu(),base.contract);
  assert.equal(field(f,name).status,status,`${name}: ${JSON.stringify(changed)}`);
 };
 check({power:'150',added:'143'},'power');
 check({tp:'ТП-Н010'},'point');
 check({house:'9'},'address');
 check({actApplicantItems:5},'tuItemsApplicant');
 check({applicant:'Другой Иван Иванович'},'applicant');
 check({existing:'5',added:'10'},'powerExisting');
 check({centre:'ПС 35/10 кВ «Другая»'},'supplyCenter','MANUAL_REVIEW');
 check({contract:'00000-26-00000002-1'},'contract');
});

test('TU rules V4: «8,0» is one number, not two; the added power is not mistaken for existing or total power',()=>{
 const f=compareRequisites(avtu(),tu(),base.contract);
 assert.deepEqual(f.find(x=>x.field==='power')!.act.map(v=>v.value),['15000/1']);
 assert.deepEqual(f.find(x=>x.field==='powerExisting')!.act.map(v=>v.value),['7000/1']);
 assert.deepEqual(f.find(x=>x.field==='powerNew')!.act.map(v=>v.value),['8000/1']);
});
