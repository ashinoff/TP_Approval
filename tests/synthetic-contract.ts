import {createHash} from 'node:crypto';
/** Синтетический номер договора ТП в рабочем формате ххххх-хх-хххххххх-х; одинаковый seed — одинаковый номер. */
export function synthContract(seed:string){
 const digits=BigInt('0x'+createHash('sha256').update(seed).digest('hex').slice(0,12)).toString().padStart(8,'0').slice(-8);
 return `99999-26-${digits}-1`;
}
