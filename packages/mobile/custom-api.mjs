// User-entered endpoints and secrets stay in Android Keystore, never notebook sync.
const key='shensi.mobile.custom-api.v1',maxBytes=2*1024*1024;
export function customApiBase(value,{allowLoopback=false}={}){
 const u=new URL(String(value).trim());
 if((u.protocol!=='https:'&&!(allowLoopback&&u.protocol==='http:'&&u.hostname==='127.0.0.1'))||u.username||u.password||u.search||u.hash)throw Error('API地址必须为不带账号、查询参数的HTTPS地址');
 u.pathname=u.pathname.replace(/\/+$/,'');if(/\/(models|chat\/completions)$/.test(u.pathname))throw Error('请填写API基础地址，例如 https://example.com/v1');return u.href.replace(/\/+$/,'');
}
export function createCustomApiClient({secureVault,transport,allowLoopback=false,timeoutMs=95000}){
 let queue=Promise.resolve();
 const serial=fn=>{const next=queue.catch(()=>{}).then(fn);queue=next;return next;};
 async function load(){const raw=await secureVault.get(key);if(!raw)return [];const rows=JSON.parse(raw);if(!Array.isArray(rows)||rows.length>30)throw Error('API配置记录无效，原记录保留');return rows;}
 const publicRow=({secret,...row})=>({...row,hasKey:!!secret});
 async function request(config,action,messages){
  if(!transport)throw Error('原生API连接器未加载');let timer;
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('API请求超时，未自动重发；请先核对供应商结果')),timeoutMs);});
  try{
   const result=await Promise.race([transport({url:customApiBase(config.baseUrl,{allowLoopback})+(action==='models'?'/models':'/chat/completions'),method:action==='models'?'GET':'POST',authorization:config.secret?'Bearer '+config.secret:'',body:action==='models'?'':JSON.stringify({model:config.model,messages,stream:false})}),timeout]);
   if(!Number.isInteger(result?.status))throw Error('API连接未确认，未自动重发');
   if(result.status<200||result.status>=300)throw Error(({401:'API密钥无效或已过期',403:'API没有此模型的使用权限',402:'API余额不足',429:'API额度不足或请求过于频繁'}[result.status]||'API请求失败')+'（HTTP '+result.status+'）');
   const raw=typeof result.data==='string'?result.data:JSON.stringify(result.data);if(new TextEncoder().encode(raw).length>maxBytes)throw Error('API响应过大，未载入');
   let data;try{data=JSON.parse(raw);}catch{throw Error('API没有返回兼容的JSON内容');}
   if(data.error)throw Error('API返回错误，未得到生成内容，请核对模型和供应商状态');return data;
  }catch(error){if(error?.message?.startsWith('API')||error?.message?.startsWith('原生'))throw error;throw Error('API网络连接失败，未自动重发');}finally{clearTimeout(timer);}
 }
 return {
  list:()=>serial(async()=> (await load()).map(publicRow)),
  save:input=>serial(async()=>{const rows=await load(),old=input.id?rows.find(r=>r.id===input.id):null;if(input.id&&!old)throw Error('API配置已变化，请刷新');if(!old&&rows.length>=30)throw Error('最多保存30个API配置');
   const name=String(input.name||'').trim(),model=String(input.model||'').trim(),baseUrl=customApiBase(input.baseUrl,{allowLoopback});if(!name||name.length>100||!model||model.length>200)throw Error('请填写配置名称和模型');
   if(old&&old.baseUrl!==baseUrl&&!input.secret)throw Error('更换API地址时请重新输入密钥，避免发送到错误服务');
   const secret=String(input.secret||old?.secret||'');if(secret.length>16384||/[\r\n]/.test(secret))throw Error('API密钥格式无效');
   const row={id:old?.id||crypto.randomUUID(),name,baseUrl,model,secret};await secureVault.set(key,JSON.stringify([...rows.filter(r=>r.id!==row.id),row]));return publicRow(row);
  }),
  remove:id=>serial(async()=>{await secureVault.set(key,JSON.stringify((await load()).filter(r=>r.id!==id)));}),
  models:id=>serial(async()=>{const row=(await load()).find(r=>r.id===id);if(!row)throw Error('请选择API配置');const data=await request(row,'models');if(!Array.isArray(data.data))throw Error('API模型列表格式不兼容');return data.data.map(m=>m.id).filter(id=>typeof id==='string'&&id.length<201).slice(0,500);}),
  chat:async(id,messages)=>{const row=await serial(async()=> (await load()).find(r=>r.id===id));if(!row)throw Error('请选择API配置');
   if(!Array.isArray(messages)||!messages.length||messages.length>40||messages.some(m=>!['user','assistant'].includes(m.role)||typeof m.content!=='string')||JSON.stringify(messages).length>100000)throw Error('对话过长，请新建对话');
   const data=await request(row,'chat',messages),answer=data.choices?.[0]?.message?.content;if(typeof answer!=='string'||!answer.trim())throw Error('API未返回文本结果，请核对模型兼容性');return answer;
  }
 };
}
