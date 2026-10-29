const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function createAccountSecurity({call,updated,toast,user}){
 let dialog,busy=false,timers=[];
 const field=(label,name,type='text',value='',extra='')=>`<label>${label}<input name="${name}" aria-label="${label}" type="${type}" value="${h(value)}" ${extra}></label>`;
 function close(){if(busy)return;dialog?.close();}
 function open(title,body,submit,submitText='保存'){
  if(dialog?.open)return;
  dialog=document.createElement('dialog');dialog.className='account-security-dialog';dialog.setAttribute('aria-label',title);
  dialog.innerHTML=`<form><header><h2>${title}</h2><button type="button" data-account-close aria-label="关闭${title}">×</button></header><div class="account-security-body">${body}</div><p role="status" data-account-status></p><footer><button type="button" data-account-close>取消</button><button type="submit" class="primary">${submitText}</button></footer></form>`;
  document.body.append(dialog);const form=dialog.querySelector('form');
  form.onsubmit=event=>{event.preventDefault();void run(()=>submit(form));};
  dialog.onclick=event=>{if(event.target.closest('[data-account-close]'))close();};
  dialog.oncancel=event=>{if(busy)event.preventDefault();};
  dialog.onclose=()=>{timers.forEach(clearInterval);timers=[];dialog.remove();};dialog.showModal();return form;
 }
 const input=(form,name)=>form.elements.namedItem(name);
 const message=text=>{if(dialog?.open)dialog.querySelector('[data-account-status]').textContent=text;};
 async function run(operation){if(busy)return;busy=true;const locked=new Map([...dialog.querySelectorAll('button,input,select')].map(el=>[el,{disabled:el.disabled,cooling:el.dataset.cooldown==='true'}]));for(const el of locked.keys())el.disabled=true;
  try{await operation();}catch(error){message(error.message);}finally{busy=false;for(const [el,state]of locked)if(el.isConnected)el.disabled=state.disabled&&!state.cooling||el.dataset.cooldown==='true';}
 }
 async function finish(text){await updated();toast(text);dialog.close();}
 function codeField(label,name){return `<label>${label}<span class="account-input-action"><input name="${name}" aria-label="${label}" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required><button type="button" data-account-code="${name}">获取验证码</button></span></label>`;}
 function bindCode(form,name,purpose,email){let challenge;
  const button=form.querySelector(`[data-account-code="${name}"]`);button.onclick=()=>void run(async()=>{
   const address=email().trim();if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))throw Error('请填写有效邮箱');
   const result=await call('email-code',{email:address,purpose});if(!result.challengeId)throw Error('验证码服务未返回校验编号');
   challenge={email:address,challengeId:result.challengeId,expiresAt:Date.now()+(result.expiresInSeconds||300)*1000};message('验证码已发送至 '+address);
   let remaining=60;button.dataset.cooldown='true';button.textContent='60 秒后重发';
   const timer=setInterval(()=>{if(!button.isConnected){clearInterval(timer);return;}remaining--;button.disabled=remaining>0||busy;button.textContent=remaining>0?remaining+' 秒后重发':'获取验证码';if(remaining<=0){delete button.dataset.cooldown;clearInterval(timer);}},1000);timers.push(timer);
  }).finally(()=>{if(button.dataset.cooldown)button.disabled=true;});
  return ()=>{if(!challenge||challenge.expiresAt<=Date.now()||challenge.email!==email().trim())throw Error('请先为当前邮箱获取验证码');return {email:challenge.email,challengeId:challenge.challengeId,code:input(form,name).value};};
 }
 async function profile(){const state=await call('profile-status');if(state.policy!=='pre_approval')throw Error('账号资料审核服务尚未更新，暂不能提交笔名与头像');const review=state.review,candidate=review&&['pending_review','rejected'].includes(review.status)?review.patch:state.user||user();let avatar=candidate.avatar||'';
  const reviewText=review?({pending_review:'待审核：通过后才公开。',rejected:'未通过：'+(review.reason||'请修改后重新提交'),approved:'当前资料已审核通过。',superseded:'此前提交已被替代。'}[review.status]||''):'';
  const form=open('编辑个人信息',`<p class="account-profile-review">${h(reviewText)} 提交的笔名与头像仅本人及审核人员可见；通过前继续显示默认资料或上次通过的资料。</p>${field('笔名','displayName','text',candidate.displayName,'maxlength="40" required')}<label>头像<input name="avatarFile" aria-label="账户头像文件" type="file" accept="image/png,image/jpeg,image/webp"></label><div class="account-avatar-preview">${avatar?`<img src="${h(avatar)}" alt="待审核头像预览">`:''}</div><button type="button" data-avatar-clear>移除头像</button>`,async form=>{const result=await call('profile',{displayName:input(form,'displayName').value.trim(),avatar});await finish(result.review?.status==='pending_review'?'已提交审核，通过后才会公开':'资料未变更，继续显示已通过资料');},'提交审核');
  if(!form)return;
  input(form,'avatarFile').onchange=()=>void run(async()=>{const file=input(form,'avatarFile').files[0];if(!file)return;if(file.size>10*1024*1024)throw Error('请选择小于 10MB 的图片');const bitmap=await createImageBitmap(file);try{const canvas=document.createElement('canvas'),scale=Math.min(1,256/Math.max(bitmap.width,bitmap.height));canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);const nextAvatar=canvas.toDataURL('image/png');if(nextAvatar.length>180000)throw Error('头像过大，请选择更简单的图片');avatar=nextAvatar;form.querySelector('.account-avatar-preview').innerHTML=`<img src="${avatar}" alt="待保存账户头像">`;}finally{bitmap.close();}});
  form.querySelector('[data-avatar-clear]').onclick=()=>{avatar='';form.querySelector('.account-avatar-preview').textContent='';};
 }
 async function bindEmail(){let proof;
  const form=open('验证绑定邮箱',`${field('邮箱','email','email','','autocomplete="email" required')}${codeField('邮箱验证码','code')}<p class="muted">验证码仅用于绑定当前账号；验证后可用该邮箱登录。</p>`,async()=>{await call('email-bind',proof());await finish('邮箱已验证绑定');},'验证绑定');
  if(form)proof=bindCode(form,'code','bind',()=>input(form,'email').value);
 }
 async function password(){const account=user();if(!account.emailVerifiedAt){toast('请先验证绑定邮箱');return;}let proof;
  const form=open('设置 / 修改密码',`<p>验证邮箱：${h(account.email)}</p>${/^emailuser_/u.test(account.account)?field('登录账号','account','text','','required maxlength="80"'):`<p>登录账号：${h(account.account)}</p>`}${codeField('邮箱验证码','code')}${field('新密码','newPassword','password','','required minlength="8" maxlength="128" autocomplete="new-password"')}${field('确认新密码','confirmPassword','password','','required minlength="8" maxlength="128" autocomplete="new-password"')}<p class="muted">保存后其他设备的登录会话会退出。</p>`,async form=>{const newPassword=input(form,'newPassword').value;if(newPassword!==input(form,'confirmPassword').value)throw Error('两次输入的密码不一致');await call('password',{...proof(),account:input(form,'account')?.value||account.account,newPassword});await finish('账号密码已更新');},'验证并保存');
  if(form)proof=bindCode(form,'code','password',()=>account.email);
 }
 async function merge(){const config=await call('merge-config');if(!config.enabled){toast('当前账号不支持合并');return;}
  let proofs={},ticket='',confirmed=false,expiresAt=0;
  const slot=(id,title)=>`<fieldset><legend>${title}</legend><label>核验方式<select name="${id}Method" aria-label="${title}核验方式"><option value="password">账号密码</option>${config.methods?.includes('email')?'<option value="email">邮箱验证码</option>':''}</select></label><div data-proof-password="${id}">${field(title+'账号',id+'Account','text',id==='target'?user().account:'','required autocomplete="username"')}${field(title+'密码',id+'Password','password','','required autocomplete="current-password"')}</div><div data-proof-email="${id}" hidden>${field(title+'邮箱',id+'Email','email',id==='target'?user().email:'','required')}${codeField(title+'验证码',id+'Code')}</div></fieldset>`;
  const form=open('核验并合并账号',`<p>当前账号为主。分别核验后，先预览资料、会员权益和积分，再确认合并。</p><div data-merge-proofs>${slot('target','当前主账号')}${slot('source','待合并账号')}</div><div data-merge-preview hidden></div>`,async form=>{
   if(!confirmed){const values=id=>input(form,id+'Method').value==='email'?{slot:id,method:'email',...proofs[id]()}:{slot:id,method:'password',account:input(form,id+'Account').value.trim(),password:input(form,id+'Password').value};
    const target=await call('merge-prove',values('target')),source=await call('merge-prove',values('source')),result=await call('merge-preview',{targetProof:target.proof,sourceProof:source.proof});ticket=result.ticket;const preview=result.preview;if(!ticket||preview.target?.id!==user().id)throw Error('合并预览身份无效');expiresAt=Date.now()+(result.expiresInSeconds||180)*1000;back.hidden=false;
    const area=form.querySelector('[data-merge-preview]');area.innerHTML=`<h3>确认合并预览</h3><p>主账号：${h(preview.target.account)} · ${h(preview.target.displayName)}</p><p>待合并账号：${h(preview.source.account)} · ${h(preview.source.displayName)}</p><p>当前积分 ${h(preview.availableBefore)} + 转入 ${h(preview.transferUnits)} = ${h(preview.availableAfter)}</p><p>Skill ${h(preview.skills)} 项 · 下载记录 ${h(preview.downloads)} 项</p><p>会员权益：${h((preview.memberships||[]).map(row=>`${row.tier} / ${row.status} / ${row.expiresAt?new Date(row.expiresAt).toLocaleDateString():'无固定到期日'}`).join('；'))}</p><p>${h(preview.policy)}</p><label><input type="checkbox" name="confirmMerge">我确认以当前账号为主合并；其他登录会话会退出。</label>`;area.hidden=false;form.querySelector('[data-merge-proofs]').hidden=true;for(const el of form.querySelectorAll('input,select'))el.required=false;input(form,'confirmMerge').required=true;form.querySelector('[type=submit]').textContent='确认合并至当前主账号';confirmed=true;message('请核对账号、会员权益及转入额度后确认。');return;
   }
   if(Date.now()>=expiresAt)throw Error('合并预览已过期，请点击重新核验');if(!input(form,'confirmMerge').checked)throw Error('请先确认以当前账号为主合并');await call('merge-commit',{ticket,confirmTargetId:user().id});await finish('账号合并完成，会员与积分已刷新');
  },'核验并预览');if(!form)return;
  const methods=[];
  for(const id of ['target','source']){proofs[id]=bindCode(form,id+'Code','merge',()=>input(form,id+'Email').value);const change=()=>{const email=input(form,id+'Method').value==='email';for(const method of ['email','password']){const area=form.querySelector(`[data-proof-${method}="${id}"]`),active=(method==='email')===email;area.hidden=!active;area.querySelectorAll('input').forEach(el=>{el.disabled=!active;el.required=active;});}};methods.push(change);input(form,id+'Method').onchange=change;change();}
  const back=document.createElement('button');back.type='button';back.textContent='重新核验';back.hidden=true;form.querySelector('footer').prepend(back);
  back.onclick=()=>{if(busy)return;ticket='';expiresAt=0;confirmed=false;const area=form.querySelector('[data-merge-preview]');area.hidden=true;area.replaceChildren();form.querySelector('[data-merge-proofs]').hidden=false;methods.forEach(change=>change());back.hidden=true;form.querySelector('[type=submit]').textContent='核验并预览';message('请重新核验两个账号，获取最新的资料、权益和积分预览。');};
 }
 async function plans(){const data=await call('billing-config');open('会员套餐',`<p>${h(data.message||'会员套餐以服务端返回为准。')}</p>${(data.plans||[]).map(plan=>`<section class="setting-block"><strong>${h(plan.name||plan.id)}</strong><p>${h(plan.description||'')}</p></section>`).join('')}<p>${data.paymentEnabled?'当前页面展示套餐信息。':'支付渠道尚未开放。'}</p>`,async()=>dialog.close(),'关闭');}
 return {profile,bindEmail,password,merge,plans};
}
