// Shared desktop/native login UI. Remembered names never contain passwords or codes.
const nameStore={get:async()=>null,set:async()=>{}};
export function mountAccountAuth(root,{call,authenticated,rememberStore=nameStore}){
 let mode='password',busy=false,countdown=0,timer,challenge=null,disposed=false,touched=false;
 const field=(label,name,type='text',extra='')=>`<label>${label}<span class="account-password-field"><input name="${name}" type="${type}" required ${extra}>${type==='password'?`<button type="button" data-auth-reveal="${name}" aria-label="按住显示密码">◉</button>`:''}</span></label>`;
 root.innerHTML=`<nav class="account-login-tabs" role="tablist">${[['password','账号密码'],['email','邮箱验证码']].map(([id,label])=>`<button type="button" role="tab" data-auth-mode="${id}" aria-selected="${id===mode}">${label}</button>`).join('')}</nav>
 <form class="account-login-form"><section data-auth-panel="password">
 ${field('账号','account','text','autocomplete="username" placeholder="神思账号" maxlength="256"')}${field('密码','password','password','autocomplete="current-password" maxlength="256"')}
 <div class="account-login-row"><div data-auth-remember-slot="password"></div><div class="account-login-options"><button type="button" data-auth-register>注册账号</button><button type="button" data-auth-mode="recover">忘记密码？</button></div></div></section>
 <section data-auth-panel="email" hidden>${field('邮箱','email','email','autocomplete="email" maxlength="254"')}<label>验证码<span class="account-code-input"><input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required><button type="button" data-auth-code>获取验证码</button></span></label><div data-auth-remember-slot="email"></div></section>
 <section data-auth-panel="recover" hidden><button type="button" data-auth-mode="password">返回登录</button>${field('账号','recoverAccount','text','autocomplete="username"')}<p data-auth-question></p>${field('密保答案','recoverAnswer','password','autocomplete="off"')}${field('新密码','newPassword','password','autocomplete="new-password" minlength="8" maxlength="128"')}<button type="button" data-auth-question-load>获取密保问题</button></section>
 <label class="account-remember"><input name="remember" type="checkbox">记住账号</label><p data-auth-status role="status"></p><button class="primary" type="submit">登录</button></form>
 <dialog class="account-register-dialog" aria-label="注册神思账号"><form data-auth-register-form><header><h2>注册神思账号</h2><button type="button" data-auth-register-close aria-label="关闭注册">×</button></header><section>${field('账号','registerAccount','text','autocomplete="username"')}${field('笔名（可选，审核后显示）','displayName','text','autocomplete="nickname" maxlength="40"').replace(' required ',' ')}${field('绑定手机或邮箱','contact','text','autocomplete="email"')}${field('密码','registerPassword','password','autocomplete="new-password" minlength="8" maxlength="128"')}${field('密保问题','securityQuestion')}${field('密保答案','securityAnswer','password','autocomplete="off"')}</section><p data-auth-register-status role="status"></p><button class="primary" type="submit">注册并登录</button></form></dialog>`;
 const form=root.querySelector('.account-login-form'),registration=root.querySelector('[data-auth-register-form]'),registerDialog=root.querySelector('.account-register-dialog'),mainStatus=root.querySelector('[data-auth-status]'),input=name=>form.elements.namedItem(name)||registration.elements.namedItem(name),codeButton=root.querySelector('[data-auth-code]'),remember=root.querySelector('.account-remember');
 let status=mainStatus;
 let errorDialog;
 // The same visible failure path is used by both native mobile and desktop.
 function showError(error){
  const message=error.message||'操作未完成，请重试';status.textContent=message;
  errorDialog?.close();errorDialog=document.createElement('dialog');errorDialog.className='account-auth-error';errorDialog.setAttribute('aria-label','账号操作提示');
  const popup=errorDialog,text=document.createElement('p'),close=document.createElement('button');text.textContent=message;text.setAttribute('role','alert');close.type='button';close.textContent='知道了';close.onclick=()=>popup.close();popup.append(text,close);popup.addEventListener('close',()=>popup.remove(),{once:true});root.append(popup);popup.showModal();
 }
 const email=()=>input('email').value.trim().toLowerCase();
 root.oninput=()=>{touched=true;};
 Promise.resolve().then(()=>rememberStore.get()).then(saved=>{if(!disposed&&!touched&&saved){input('account').value=String(saved.account||'');input('email').value=String(saved.email||'');input('remember').checked=true;}}).catch(()=>{if(!disposed)mainStatus.textContent='未能读取记住的账号，可手动输入。';});
 function updateCode(){codeButton.textContent=countdown>0?countdown+' 秒后重发':'获取验证码';codeButton.disabled=busy||countdown>0;}
 function coolDown(seconds){countdown=Math.min(86400,Math.max(1,Math.ceil(Number(seconds)||60)));clearInterval(timer);updateCode();timer=setInterval(()=>{if(disposed||!root.isConnected){clearInterval(timer);return;}countdown=Math.max(0,countdown-1);updateCode();if(!countdown)clearInterval(timer);},1000);}
 function switchMode(value){mode=value;if(mode==='password'||mode==='email')root.querySelector(`[data-auth-remember-slot="${mode}"]`).append(remember);remember.hidden=mode==='recover';root.querySelectorAll('[data-auth-panel]').forEach(panel=>{const active=panel.dataset.authPanel===mode;panel.hidden=!active;panel.querySelectorAll('input').forEach(el=>el.disabled=!active);});root.querySelectorAll('[data-auth-mode][role=tab]').forEach(el=>el.setAttribute('aria-selected',String(el.dataset.authMode===mode)));form.querySelector('[type=submit]').textContent=({password:'登录',email:'验证并登录',recover:'重置密码'})[mode];status.textContent='';}
 switchMode(mode);
 const hidePasswords=()=>root.querySelectorAll('[data-auth-reveal]').forEach(button=>input(button.dataset.authReveal).type='password');
 root.onpointerdown=event=>{const reveal=event.target.closest('[data-auth-reveal]');if(reveal&&!busy){event.preventDefault();input(reveal.dataset.authReveal).type='text';reveal.setPointerCapture(event.pointerId);}};
 root.onpointerup=root.onpointercancel=root.onlostpointercapture=hidePasswords;
 async function run(fn){if(busy||disposed)return;busy=true;root.querySelectorAll('button').forEach(b=>b.disabled=true);status.textContent='正在处理…';try{await fn();}catch(error){if(!disposed){showError(error);if(error.retryAfterSeconds)coolDown(error.retryAfterSeconds);}}finally{busy=false;if(!disposed){root.querySelectorAll('button').forEach(b=>b.disabled=false);updateCode();}}}
 async function done(){clearInterval(timer);for(const name of ['password','code','registerPassword','securityAnswer'])input(name).value='';await authenticated();}
 root.onclick=event=>{
  event.stopPropagation();if(busy||disposed)return;
  if(event.target.closest('[data-auth-register]')){status=root.querySelector('[data-auth-register-status]');status.textContent='';registerDialog.showModal();return;}
  if(event.target.closest('[data-auth-register-close]')){registerDialog.close();status=mainStatus;return;}
  const tab=event.target.closest('[data-auth-mode]');if(tab){switchMode(tab.dataset.authMode);return;}
  if(event.target.closest('[data-auth-question-load]'))void run(async()=>{const result=await call('recovery-question',{account:input('recoverAccount').value.trim()});root.querySelector('[data-auth-question]').textContent=result.securityQuestion||result.question||'';status.textContent='请回答密保问题。';});
  if(event.target.closest('[data-auth-code]')){if(countdown||!input('email').reportValidity())return;void run(async()=>{const address=email();status.textContent='正在发送验证码，请稍候…';const result=await call('email-code',{email:address});if(!result.challengeId)throw Error('验证码服务未返回校验编号');const lifetime=Number(result.expiresInSeconds);if(!Number.isFinite(lifetime)||lifetime<=0||lifetime>600)throw Error('验证码有效期无效或已过期，请稍后重新获取。');challenge={email:address,id:result.challengeId,expiresAt:Date.now()+lifetime*1000};status.textContent='验证码已发送，请查收。';coolDown(result.retryAfterSeconds||60);});}
 };
 registerDialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();else status=mainStatus;});
 registration.onsubmit=event=>{event.preventDefault();void run(async()=>{await call('register',{account:input('registerAccount').value.trim(),displayName:input('displayName').value.trim(),contact:input('contact').value.trim(),password:input('registerPassword').value,securityQuestion:input('securityQuestion').value.trim(),securityAnswer:input('securityAnswer').value,remember:true});registerDialog.close();status=mainStatus;await done();});};
 form.noValidate=true;
 form.onsubmit=event=>{event.preventDefault();void run(async()=>{
  if(mode==='email'){
   if(challenge?.email===email()&&challenge.expiresAt<=Date.now())throw Error('验证码已过期，请重新获取验证码后登录。');
   if(!challenge||challenge.email!==email())throw Error('请先为当前邮箱获取验证码。');
  }
  if(!form.checkValidity())throw Error(mode==='email'?'请填写有效邮箱和六位数字验证码。':'请完整填写当前登录信息。');
  if(mode==='recover'){await call('recover',{account:input('recoverAccount').value.trim(),securityAnswer:input('recoverAnswer').value,newPassword:input('newPassword').value});input('recoverAnswer').value='';input('newPassword').value='';switchMode('password');status.textContent='密码已重置，请登录。';return;}
  const body=mode==='email'?{email:email(),challengeId:challenge.id,code:input('code').value}:{account:input('account').value.trim(),password:input('password').value};
  await call(mode==='email'?'email-login':'login',{...body,remember:true});
  try{await rememberStore.set(input('remember').checked?{account:input('account').value.trim(),email:email()}:null);}catch{status.textContent='已登录，但未能保存记住的账号。';}
  await done();
 });};
 return {dispose(){disposed=true;clearInterval(timer);errorDialog?.close();hidePasswords();root.querySelectorAll('input[type=password],input[name=code]').forEach(el=>el.value='');registerDialog.close();root.onclick=root.oninput=root.onpointerdown=root.onpointerup=root.onpointercancel=root.onlostpointercapture=null;}};
}
