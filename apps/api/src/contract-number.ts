import {HttpError} from './db.js';

// Единый формат номера договора ТП: такой же требует «Учёт ПУ», иначе синхронизация не сопоставит договоры.
export const CONTRACT_NUMBER_PATTERN=/^\d{5}-\d{2}-\d{8}-\d$/;
export const CONTRACT_NUMBER_HINT='ххххх-хх-хххххххх-х';

/** Приводит запись из ТУ/формы к единому виду: типографские тире → дефис, пробелы вокруг дефисов убираются. */
export function normalizeContractNumber(value:string){
 return value.replace(/ /g,' ').replace(/[‐-―−]/g,'-').trim().replace(/\s*-\s*/g,'-');
}
export function isContractNumber(value:string){return CONTRACT_NUMBER_PATTERN.test(value);}
export function requireContractNumber(value:string){
 const normalized=normalizeContractNumber(value);
 if(!isContractNumber(normalized))throw new HttpError(422,'CONTRACT_NUMBER_FORMAT',`Номер договора ТП должен быть в формате ${CONTRACT_NUMBER_HINT} (цифры), например 00123-26-00004567-1.`);
 return normalized;
}
