// Синтетические PDF для тестов (без реальных документов и персональных данных): текстовый слой с кириллицей,
// таблица с рамками из тонких заливок (как сохраняет Word), невидимая метка у края листа, «скан» и PDF со сценарием.
import {readFileSync} from 'node:fs';
import {PDFDocument,rgb} from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

const FONT=readFileSync(new URL('../node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf',import.meta.url));
type Options={lines:string[];table?:string[][];columns?:number[];hiddenEdgeText?:string;scanned?:boolean;script?:boolean};

export async function syntheticPdf({lines,table,columns,hiddenEdgeText,scanned,script}:Options){
 const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);pdf.setProducer('Synthetic test fixture');
 const font=await pdf.embedFont(FONT,{subset:true});const page=pdf.addPage([595.32,841.92]);
 if(scanned){page.drawRectangle({x:60,y:500,width:400,height:200,color:rgb(.85,.85,.85)});return Buffer.from(await pdf.save());}
 let y=780;
 for(const text of lines){page.drawText(text,{x:71,y,size:10,font});y-=18;}
 if(table){
  const widths=columns??table[0].map(()=>480/table[0].length);const rowH=22;const x0=71;
  y-=8;
  for(const row of table){
   let x=x0;
   for(const [i,cell]of row.entries()){page.drawText(cell,{x:x+3,y:y-rowH+7,size:7,font});x+=widths[i];}
   // Рамки ячеек: тонкие залитые прямоугольники, как в PDF из Word.
   page.drawRectangle({x:x0,y,width:x-x0,height:0.5,color:rgb(0,0,0)});
   let vx=x0;for(const w of [0,...widths]){vx+=w;page.drawRectangle({x:vx-(w?0:0),y:y-rowH,width:0.5,height:rowH,color:rgb(0,0,0)});}
   page.drawRectangle({x:x0,y:y-rowH,width:x-x0,height:0.5,color:rgb(0,0,0)});
   y-=rowH;
  }
 }
 if(hiddenEdgeText)page.drawText(hiddenEdgeText,{x:120,y:5,size:8,font,color:rgb(1,1,1)});
 if(script)pdf.addJavaScript('synthetic','app.alert("synthetic")');
 return Buffer.from(await pdf.save());
}

/** Синтетический акт/ТУ с теми же реквизитами, что DOCX-фикстуры engineer.integration (checkedDocx). */
export function checkedPdf(power='15',contract='00001-26-00000004-1',type:'ACT'|'TU'='ACT'){
 return syntheticPdf({lines:[type==='TU'?'Технические условия — синтетический пример':'Акт ТП — синтетический пример',`Приложение к договору № ${contract}`,
  `Максимальная мощность: ${power} кВт, в том числе существующая мощность 7 кВт.`,'Класс напряжения: 0,4 кВ.','Адрес объекта: Учебный адрес, д. 15/31','Точка присоединения: РУ-0,4 кВ ТП-У001.',
  ...(type==='TU'?[]:['Устройства защиты: ВА-25А.'])],hiddenEdgeText:'Начальник учебного РЭС'});
}
