/** Дополнительные документы договора: прикладываются к документу, версию акта не создают. */
export const EXTRA_KINDS=['PSU','PREV_ACT','POLE_SCHEME'];
type Api=(path:string,body?:object|FormData)=>Promise<any>;
export async function uploadDocument(api:Api,actId:string,file:File,type:string,number='',date=''){
 const data=new FormData();data.append('documentType',type);if(type==='TU'){if(number.trim())data.append('documentNumber',number.trim());if(date)data.append('documentDate',date);}data.append('file',file);
 const stored=await api(`/api/v1/acts/${actId}/files`,data);if(type==='TU'||EXTRA_KINDS.includes(type))return {file:stored};
 const act=await api(`/api/v1/acts/${actId}`);const version=await api(`/api/v1/acts/${actId}/versions`,{fileId:stored.id,expectedRevision:act.revision});return {file:stored,version};
}
