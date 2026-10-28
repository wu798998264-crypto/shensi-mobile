const el=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;return e;};
export function mountServicePanels(root,{account,nutstore,marketplace}){
 const bar=el('nav');bar.className='service-tools';root.append(bar);
 const dialog=(title)=>{const d=el('dialog'),h=el('h2',title),close=el('button','关闭'),status=el('p');status.setAttribute('role','status');close.onclick=()=>{d.close();d.remove();};d.append(h,close,status);root.append(d);d.showModal();return {d,status,run:async fn=>{status.textContent='正在连接…';try{await fn();}catch(e){status.textContent=e.message||'操作失败';}}};};
 const button=(text,action)=>{const b=el('button',text);b.onclick=action;bar.append(b);};
 button('账户设置',()=>{
  const {d,status,run}=dialog('神思账户'),form=el('form'),name=el('input'),password=el('input'),login=el('button','登录');name.placeholder='账号';name.autocomplete='username';name.setAttribute('aria-label','账号');password.placeholder='密码';password.type='password';password.autocomplete='current-password';password.setAttribute('aria-label','密码');login.type='submit';form.append(name,password,login);d.append(form);
  const refresh=el('button','核验账号与权益'),logout=el('button','退出登录'),vip=el('p','购买算力套餐 / VIP：暂未开放，不能支付。');d.append(refresh,logout,vip);
  const show=s=>{status.textContent=s.status==='verified'?'已登录：'+(s.user.displayName||s.user.account):s.status==='verification_required'?'已保存登录，请联网核验':'未登录';form.hidden=s.status==='verified';logout.hidden=s.status==='signed_out';};
  form.onsubmit=e=>{e.preventDefault();run(async()=>{login.disabled=true;try{show(await account.login({account:name.value,password:password.value}));password.value='';}finally{login.disabled=false;}});};
  refresh.onclick=()=>run(async()=>{const r=await account.entitlements();show(r);status.textContent+=' · 可用积分 '+r.quota.available+' · 预留 '+r.quota.reserved;});logout.onclick=()=>run(async()=>show(await account.logout()));run(async()=>show(await account.status()));
 });
 button('坚果云',()=>{
  const {d,status,run}=dialog('坚果云同步'),form=el('form'),name=el('input'),password=el('input'),connect=el('button','连接并保存');name.placeholder='坚果云账号';name.setAttribute('aria-label','坚果云账号');password.placeholder='第三方应用密码（非登录密码）';password.type='password';password.setAttribute('aria-label','坚果云应用密码');connect.type='submit';form.append(name,password,connect);d.append(form);
  const probe=el('button','连通性测试'),roundtrip=el('button','独立测试文件写入与回读'),disconnect=el('button','退出连接'),note=el('p','个人库自动同步尚未接齐桌面冲突协议，当前不会上传笔记。读写测试只操作独立随机测试文件。');d.append(probe,roundtrip,disconnect,note);
  const show=s=>{form.hidden=s.configured===true||s.connected===true;status.textContent=form.hidden?'已保存连接：'+s.account+'（可点击测试实时核验）':'尚未连接';};
  form.onsubmit=e=>{e.preventDefault();run(async()=>{connect.disabled=true;try{show(await nutstore.connect({account:name.value,password:password.value}));password.value='';}finally{connect.disabled=false;}});};
  probe.onclick=()=>run(async()=>{await nutstore.probe();status.textContent='实时连通性通过；不代表个人库同步已完成。';});
  roundtrip.onclick=()=>run(async()=>{await nutstore.roundTripProbe();status.textContent='随机测试文件写入、下载及内容核对通过，已清理测试文件。';});
  disconnect.onclick=()=>run(async()=>show(await nutstore.disconnect()));run(async()=>show(await nutstore.status()));
 });
 button('手机插件广场',()=>{const {d,status,run}=dialog('手机插件广场');run(async()=>{const result=await marketplace.catalog();status.textContent='线上 '+result.platform+' 分区 · '+result.total+' 个插件';if(!result.items.length)d.append(el('p','服务器当前没有已发布的手机插件，不能下载。'));for(const item of result.items)d.append(el('p',item.name+' · '+item.version));});});
}
