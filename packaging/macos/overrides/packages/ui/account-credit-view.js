// Several model configurations can belong to one account. Never add their
// balances together or use another account's balance for a missing result.
export const knownAccountCredit=row=>typeof row?.credit==='number'&&Number.isFinite(row.credit)&&row.credit>=0;
// Paint a same-profile saved balance before a slow upstream read completes.
// Failure of the snapshot must not prevent a live read; neither path generates.
export async function readSelectedAccountCredits(api,profileId,refresh,accept){
 if(refresh){try{accept(await api('/media/credits',{profileId,refresh:false}));}catch{/* Live lookup can still recover a missing snapshot. */}}
 accept(await api('/media/credits',{profileId,refresh}));
}
export function mergeAccountCreditSnapshots(previous,incoming){
 const rows=new Map(previous.map(row=>[row.profileId,row]));
 for(const row of incoming){const prior=rows.get(row.profileId),sameScope=prior?.creditScope===row.creditScope&&(!prior?.accountId||!row.accountId||prior.accountId===row.accountId);rows.set(row.profileId,!knownAccountCredit(row)&&row.creditQuerySupported!==false&&sameScope&&knownAccountCredit(prior)?{...prior,...row,credit:prior.credit,creditUpdatedAt:prior.creditUpdatedAt,liveVerified:false}:row);}
 return [...rows.values()];
}
export function selectedAccountCreditLabel(profile,rows=[],official){
 const row=profile?(profile.memberRef?official:rows.find(p=>p.profileId===profile.id)):official;
 const time=row?.creditUpdatedAt?new Date(row.creditUpdatedAt):null;
 const snapshot=row?.liveVerified===false?'上次查询 · '+(time&&Number.isFinite(time.getTime())?time.toLocaleString()+' · ':''):'';
 return knownAccountCredit(row)?`${snapshot}${row.accountName||row.name||profile?.name||'官方算力'} · ${row.credit}积分`:'—';
}
export function accountCreditRows(rows=[]){
 const byAccount=new Map();
 for(const row of rows){if(!knownAccountCredit(row)||!row.accountId)continue;const key=row.provider+':'+row.accountId;if(!byAccount.has(key))byAccount.set(key,{...row,names:[row.name]});else{const old=byAccount.get(key);if(!old.names.includes(row.name))old.names.push(row.name);if(Date.parse(row.creditUpdatedAt)>Date.parse(old.creditUpdatedAt))Object.assign(old,{...row,names:old.names});}}
 return [...byAccount.values()];
}
