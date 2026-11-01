import {mountAccountAuth} from '../../../packages/ui/account-auth.js';
import {createAccountSecurity} from '../../../packages/ui/account-security.js';
const el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};

// Native secure-vault client, or encrypted desktop preview bridge. No sample login.
export function mountMobileAccountPanel({d,status,run},account){
 d.classList.add('mobile-account-dialog');
 const loginArea=el('section'),identity=el('section'),actions=el('section'),rights=el('p'),reviewStatus=el('p'),refresh=el('button','核验账号与权益'),edit=el('button','编辑笔名与头像'),logout=el('button','退出登录');
 loginArea.className='account-login';identity.className='mobile-account-identity';actions.className='mobile-account-actions';reviewStatus.className='account-profile-review';
 actions.append(refresh,edit,logout);d.append(identity,loginArea,actions,reviewStatus,rights,el('p','购买算力套餐 / VIP：暂未开放，不能支付。'));
 let current={status:'signed_out'},auth,disposed=false;
 const method={'login':'login','register':'register','recovery-question':'recoveryQuestion','recover':'recover','email-code':'sendEmailCode','email-login':'emailLogin','profile-status':'profile','profile':'updateProfile'};
 // Profile submissions run in their own dialog, so reconcile failures here too.
 const reconcile=async fn=>{try{return await fn();}catch(error){const next=await account.status();if(next.status!==current.status||next.user?.id!==current.user?.id)show(next);throw error;}};
 const call=(name,body)=>reconcile(()=>{const fn=account[method[name]];if(typeof fn!=='function')throw Error('当前客户端尚未接入此账号操作');return fn(body);});
 const runAccount=fn=>run(()=>reconcile(fn));
 const security=createAccountSecurity({call,user:()=>current.user,updated:()=>reconcile(async()=>{show(await account.refresh());await showReview();}),toast:text=>{status.textContent=text;}});
 async function showReview(){if(disposed||current.status!=='verified'||!account.profile)return;const result=await account.profile();if(disposed)return;const review=result.review;reviewStatus.textContent=review?({pending_review:'笔名与头像待审核，通过前不公开。',rejected:'资料未通过：'+review.reason,approved:'笔名与头像已审核通过。',superseded:'此前提交已被替代。'}[review.status]||''):'笔名与头像须审核通过后显示。';}
 function show(state){
  if(disposed)return;current=state;const loggedIn=state.status!=='signed_out';identity.replaceChildren();loginArea.hidden=loggedIn;actions.hidden=!loggedIn;reviewStatus.hidden=!loggedIn;
  auth?.dispose();auth=null;if(loggedIn)loginArea.replaceChildren();
  status.textContent=state.status==='verified'?'已登录':state.status==='verification_required'?'已保存登录，正在联网核验…':'使用神思账号登录';
  if(loggedIn){const avatar=el('span');avatar.className='mobile-account-avatar';if(state.user?.avatar){const img=el('img');img.src=state.user.avatar;img.alt='已通过审核的账户头像';avatar.append(img);}else{avatar.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5"/><path d="M5 21v-2a7 7 0 0 1 14 0v2"/></svg>';}
   const text=el('div');text.append(el('strong',state.user?.displayName||'神思用户'),el('small',state.user?.account||''));identity.append(avatar,text);
  }else{
   rights.textContent=reviewStatus.textContent='';
   auth=mountAccountAuth(loginArea,{call,rememberStore:account.rememberedAccount||{get:async()=>null,set:async()=>{}},authenticated:async()=>{show(await account.status());try{await showReview();}catch(error){status.textContent='已登录；资料审核状态暂无法读取：'+error.message;}}});
  }
 }
 refresh.onclick=()=>void runAccount(async()=>{const r=await account.entitlements();show(r);const m=r.membership?.membership||r.membership;rights.textContent=[m?(m.entitled?'会员：'+(m.expiresAt?new Date(m.expiresAt).toLocaleDateString()+' 到期':'永久有效'):'尚无有效会员'):'会员权益暂无法核验',r.quota?'可用积分 '+r.quota.available+' · 预留 '+r.quota.reserved:'积分暂无法核验',r.cloudSyncStatus?.message,...Object.values(r.serviceErrors||{})].filter(Boolean).join(' · ');await showReview();});
 edit.onclick=()=>void runAccount(()=>security.profile());
 logout.onclick=()=>void runAccount(async()=>show(await account.logout()));
 d.addEventListener('close',()=>{disposed=true;auth?.dispose();},{once:true});
 void run(async()=>{let state=await account.status();show(state);if(state.status!=='signed_out'&&account.refresh){try{state=await account.refresh();show(state);await showReview();}catch(error){show(await account.status());throw error;}}});
}
