// Serialized into our owned account window. No cookies, storage or global chat
// scraping: only controls and messages belonging to the freshly created task.
export async function doubaoPageAction(op,arg={},openSourceCore=null){
 const visible=e=>{if(!e?.getClientRects().length)return false;for(let p=e;p;p=p.parentElement){const s=getComputedStyle(p);if(p.hidden||p.inert||p.getAttribute('aria-hidden')==='true'||s.display==='none'||s.visibility==='hidden'||Number(s.opacity)===0)return false;}return true;};
 const enabled=e=>visible(e)&&!e.disabled&&e.getAttribute('aria-disabled')!=='true';
 const controls=()=>[...document.querySelectorAll('button,a,[role="button"],[data-testid]')].filter(enabled);
 const label=e=>(e.getAttribute('aria-label')||e.getAttribute('title')||e.innerText||'').replace(/\s+/g,' ').trim();
 const find=(re,testid)=>{const known=testid?controls().filter(e=>e.dataset.testid===testid):[];if(known.length===1)return known[0];const matches=controls().filter(e=>re.test(label(e))),leaves=matches.filter(e=>!matches.some(other=>other!==e&&e.contains(other)));return leaves.length===1?leaves[0]:null;};
 // The live page exposes the same action in both its sidebar and header.
 // Prefer the unique navigation action, never a same-named history link.
 const newConversationEntries=()=>controls().filter(e=>{
  if(e.closest('[data-testid="message-list"],[data-testid="send_message"],[data-testid="receive_message"]'))return false;
  if(e.tagName==='A'&&/\/chat\/\d+/.test(e.getAttribute('href')||''))return false;
  if(!(e.matches('button,a,[role="button"]')||e.dataset.testid==='create_conversation_button'))return false;
  const value=label(e).replace(/[()（）]/g,' ').replace(/\s+/g,' ').trim();
  // Live Work layout renamed the navigation action, not history messages.
  if(e.closest('nav,[role="navigation"]')&&e.closest('[data-testid="create_office_task_button"]')&&/^新工作任务(?:\s*(?:Ctrl\s*\+?\s*J))?$/i.test(value))return true;
  return /^新对话(?:\s*(?:(?:Ctrl|Alt|Shift|⌘|⌃|⇧|\+|K|N)\s*)+)?$/i.test(value);
 }).filter((e,_i,all)=>!all.some(other=>other!==e&&e.contains(other)));
 const newConversationEntry=()=>{
  const all=newConversationEntries(),navigation=all.filter(e=>e.closest('nav,[role="navigation"]'));
  // Work now exposes both “新工作任务” and “新对话” in the same sidebar.
  // They are different actions: prefer the unique ordinary chat entry;
  // keep rejecting duplicate chat actions and use Work only as a fallback.
  const chats=navigation.filter(e=>!e.closest('[data-testid="create_office_task_button"]'));
  if(chats.length)return chats.length===1?chats[0]:null;
  if(navigation.length)return navigation.length===1?navigation[0]:null;
  return all.length===1?all[0]:null;
 };
 const editor=()=>[...document.querySelectorAll('div.tiptap.ProseMirror[contenteditable="true"],textarea,[contenteditable="true"]')].find(e=>enabled(e)&&!e.readOnly);
 const hasUploads=()=>!!document.querySelector('[class*="uploading"],[class*="upload-preview"]')||[...document.querySelectorAll('input[type="file"]')].some(e=>e.files?.length);
 const creationRoute=()=>/^https:\/\/(www\.)?doubao\.com\/chat\/create-(image|video)\/?$/.exec(location.href)?.[2]||'';
 const creationTab=kind=>{
  const tabs=controls().filter(e=>e.dataset.testid==='creation-skill-switch-tab-'+kind&&e.getAttribute('role')==='tab'&&!e.hasAttribute('data-disabled'));
  return tabs.length===1?tabs[0]:null;
 };
 const matchesEditor=(e,value)=>{
  if(!e)return false;const expected=String(value).replace(/\r\n/g,'\n');
  if(String(e.value??e.innerText??'').replace(/\r\n/g,'\n')===expected)return true;
  if(e.tagName==='TEXTAREA')return false;
  // Chromium counts an empty <div><br></div> paragraph twice in innerText.
  // Serialize only the proven plain paragraph/inline schema. Preserve every
  // space and empty paragraph; never trim or flatten an unknown rich node.
  const allowed=new Set(['DIV','P','BR','SPAN','STRONG','EM','B','I','U','S','CODE']);
  if([...e.querySelectorAll('*')].some(n=>!allowed.has(n.tagName)||n.getAttribute('contenteditable')==='false'))return false;
  const read=node=>{
   if(node.nodeType===3)return node.data;if(node.tagName==='BR')return '\n';
   if(node.childNodes.length===1&&node.firstChild.nodeName==='BR')return '';
   let result='',started=false,previousBlock=false;
   for(const child of node.childNodes){if(child.nodeType!==1&&child.nodeType!==3)continue;
    if(child.nodeType===1&&child.tagName==='BR'&&child.classList.contains('ProseMirror-trailingBreak'))continue;
    const block=child.nodeType===1&&['DIV','P'].includes(child.tagName);
    if(started&&(block||previousBlock))result+='\n';result+=read(child);started=true;previousBlock=block;
   }return result;
  };
  return read(e).replace(/\r\n/g,'\n')===expected;
 };
 const modeState=()=>{
  const e=editor(),chips=[...document.querySelectorAll('[data-testid="skill_input_exit_button"]')].filter(visible),chip=chips.find(c=>c.getAttribute('data-input-engine-action-source')==='actionbar')||chips[0];
  const placeholders=[e?.getAttribute('placeholder'),...e?[...e.querySelectorAll('[data-placeholder]')].map(p=>p.getAttribute('data-placeholder')):[]].filter(Boolean).join(' ');
  // Tiptap removes its placeholder decoration once text is inserted. Keep
  // the explicit selected capability chip as evidence on a non-empty editor;
  // contradictory placeholders and unknown chips still fail closed.
  const filledWithoutPlaceholder=!placeholders&&!!String(e?.value??e?.innerText??'').trim();
  // The observed dedicated creation page has tabs instead of the old chip.
  // Require its exact creation route, active tab and matching placeholder (or exact
  // owned draft after Tiptap removes the placeholder); a URL alone is not mode.
  // Live video selection retains /chat/create-image. The unique selected tab
  // and editor, not the URL suffix, identify the requested capability.
  const route=creationRoute(),activeTabs=route?['image','video'].filter(kind=>{const tab=creationTab(kind);return tab&&tab.getAttribute('aria-selected')!=='false'&&tab.getAttribute('data-state')!=='inactive'&&(tab.getAttribute('aria-selected')==='true'||tab.getAttribute('data-state')==='active');}):[],selected=activeTabs.length===1?activeTabs[0]:'';
  const dedicated=!chip&&selected&&(route==='image'||selected==='video')&&((selected==='image'?/^(?:描述你想要的图片)$/:/^(?:描述你想要的视频)$/).test(placeholders)||filledWithoutPlaceholder&&matchesEditor(e,arg.prompt))?selected:'';
  const kind=chip&&/视频生成/.test(label(chip))&&(/视频/.test(placeholders)||filledWithoutPlaceholder)?'video':chip&&/图像生成|图片生成/.test(label(chip))&&(/图片|图像/.test(placeholders)||filledWithoutPlaceholder)?'image':dedicated||(!chip&&!route&&!!find(/^对话$/,'chat_input_action_mode')?'text':'');
  return {ready:!!e&&kind===arg.kind,kind,chip:!!chip,placeholder:placeholders.slice(0,100)};
 };
 const clean=e=>{
  const c=e.cloneNode(true);
  // Remove provider chrome structurally, never by stripping phrases from the
  // user's answer (which may legitimately quote the provider disclaimer).
  c.querySelectorAll('[class*="suggest-message"],[class*="suggest-list"],[class*="message-action"],[data-testid="message_footer"],[data-testid="message_suggestion"],[data-testid="code-bar"],[class*="disclaimer"],[aria-hidden="true"],time,button,[role="button"]').forEach(n=>n.remove());
  // Serialize the detached tree: do not attach cloned event handlers/media to
  // the live page. Keep block boundaries and preformatted answer content.
  const blocks=new Set(['P','DIV','SECTION','ARTICLE','H1','H2','H3','H4','H5','H6','LI','UL','OL','BLOCKQUOTE','PRE','TR']);
  const read=n=>{if(n.nodeType===3)return n.data;if(n.nodeType!==1||['SCRIPT','STYLE','TEMPLATE'].includes(n.tagName))return '';if(n.tagName==='BR')return '\n';if(n.tagName==='PRE')return '\n'+n.textContent+'\n';const value=[...n.childNodes].map(read).join('');return blocks.has(n.tagName)?'\n'+value+'\n':value;};
  return read(c).replace(/\n{3,}/g,'\n\n').trim();
 };
 const matchesRenderedPrompt=(content,text)=>{
  if(text===arg.prompt)return true;
  // Media-mode chips are rendered as a fixed prefix in the sent bubble.
  // Only remove that observed prefix, never arbitrary leading instructions.
  const prefix={image:'生成图片：',video:'生成视频：'}[arg.kind];
  const ownedPreparedMode=arg.preparedMode===arg.kind&&arg.renderedPromptUrl===location.href&&/^https:\/\/(www\.)?doubao\.com\/chat\/\d+\/?$/.test(location.href);
  // Observed native video bubbles append default parameter chips to the exact
  // sent text. Only this known formatting, owned video mode and original route
  // are accepted; never strip arbitrary suffixes or another requested duration.
  const videoSuffix=Number(arg.durationSeconds)===15?'，15s，720p':'，10s，720p';
  if(ownedPreparedMode&&arg.kind==='video'&&text.startsWith(prefix)&&text.endsWith(videoSuffix))text=text.slice(0,-videoSuffix.length);
  if(prefix&&text.startsWith(prefix)&&(ownedPreparedMode||String(arg.prompt||'').startsWith(arg.kind==='image'?'请使用图片生成功能，':'请使用视频生成功能，')))text=text.slice(prefix.length);
  if(text===arg.prompt)return true;
  // After a send, Doubao renders Markdown headings and adds CJK/Latin
  // typography spaces. Match only this recorded formal conversation, never a
  // nearby prompt, an arbitrary page, code block or a partial substring.
  if(!content||arg.renderedPromptUrl!==location.href||!/^https:\/\/(www\.)?doubao\.com\/chat\/\d+\/?$/.test(location.href)||/[`]/.test(arg.prompt||'')||content.querySelector('pre,code,table,img,video,a'))return false;
  let expected=String(arg.prompt||'');
  if(content.querySelector('h1,h2,h3,h4,h5,h6'))expected=expected.replace(/^#{1,6}[ \t]+/gm,'');
  const typography=value=>value.replace(/\r\n/g,'\n').replace(/\s+/g,' ').replace(/(?<=\p{Script=Han}) +(?=[A-Za-z0-9])|(?<=[A-Za-z0-9]) +(?=\p{Script=Han})/gu,'').trim();
  // The owned bubble renders Markdown emphasis instead of its delimiters.
  // Remove only balanced markers whose full content has a matching DOM node;
  // unrelated asterisks, changed text and partial prompts still fail equality.
  const emphasis=(selector,pattern)=>{const rendered=new Set([...content.querySelectorAll(selector)].map(e=>typography(e.textContent||'')));expected=expected.replace(pattern,(all,a,b)=>rendered.has(typography(a||b))?a||b:all);};
  emphasis('strong,b',/\*\*([^\n*]+)\*\*|__([^\n_]+)__/g);
  emphasis('em,i',/(?<!\*)\*([^\n*]+)\*(?!\*)|(?<!_)_([^\n_]+)_(?!_)/g);
  return typography(text)===typography(expected);
 };
 const completionMarkers='[class*="message-action-bar"],[class*="suggest-message-list"],[data-testid="message_action_bar"]';
 const messages=()=>{
  const semantic=[...document.querySelectorAll('[data-testid="send_message"],[data-testid="receive_message"]')].filter(visible);
  const fallback='[class*="inner-item"],[data-testid="message_block"],[data-message-id]';
  return (semantic.length?semantic:[...document.querySelectorAll(fallback)].filter(e=>visible(e)&&!e.parentElement?.closest(fallback))).map((e,index)=>{
   const contents=[...e.querySelectorAll('[data-testid="message_text_content"]')].filter(c=>!c.parentElement?.closest('[data-testid="message_text_content"]')),content=contents[0],role=(e.getAttribute('data-role')||e.getAttribute('data-message-role')||'').toLowerCase(),testid=e.getAttribute('data-testid'),isUser=role==='user'||testid==='send_message'||!!e.querySelector('[data-role="user"],[data-message-role="user"],[data-testid="user_message"]'),text=isUser&&content?(content.innerText||content.textContent||'').trim():contents.length?contents.map(clean).filter(Boolean).join('\n\n'):clean(e),user=isUser||arg.prompt&&text===arg.prompt,assistant=role==='assistant'||testid==='receive_message'||!!e.querySelector('[data-role="assistant"],[data-message-role="assistant"],[data-testid="assistant_message"],[class*="message-action-bar"],[class*="suggest-message-list"]');
   const owner=e.closest('[data-message-id],[data-testid="union_message"]')||e;
   const isAssistant=user?false:assistant||e.querySelector('div.grid')?true:null;
   // Completion belongs to this reply, never its union/parent or a user's
   // action bar. Use the same signal for live and virtualized history reads.
   return {e,index,id:owner.getAttribute('data-message-id')||owner.id||e.id||'',assistant:isAssistant,completed:isAssistant===true&&!!e.querySelector(completionMarkers),text,promptMatches:user&&matchesRenderedPrompt(content,text)};
  });
 };
 const promptOnlyReply=value=>/^(?:(?:以下|下面|这是).{0,30}(?:提示词|分镜|脚本)|(?:已|已经)(?:为[你您])?(?:完成|生成)(?:了)?(?:视频|图片|图像)?(?:提示词|分镜|脚本)|(?:提示词|分镜|脚本)生成(?:完成|成功))/.test(String(value||'').trim());
 const referenceOnlyReply=value=>{
  const t=String(value||''),mediaStatus=t.replace(/(?:提示词|分镜|脚本)\s*生成(?:完成|成功)/g,'');
  // Completing a prompt/script is not evidence that the attached reference
  // clip was generated. Preserve explicit media completion, not generic
  // “already generated” prose that can describe a text deliverable.
  if(/生成(?:完成|成功)|(?:已|已经)(?:为[你您])?生成(?:了)?\s*(?:(?:一|两|三|四|[1-9])(?:段|张|个))?\s*(?:视频|图片|图像)(?!\s*(?:脚本|分镜|提示词))|(?:视频|图片|图像)(?:已|已经)生成/.test(mediaStatus))return false;
  return promptOnlyReply(t)||/同氛围.{0,80}参考|(?:以下|下面|这些|这[段张个些]).{0,32}(?:参考视频|视频参考|参考图片|图片参考|素材参考)/s.test(t)||/(?:无法|不能|不支持).{0,20}(?:生成|制作|创建).{0,10}(?:视频|图片)/s.test(t)&&/提示词|分镜|脚本/.test(t);
 };
 const messageList=()=>document.querySelector('[data-testid="message-list"]');
 const scrollOwner=list=>{
  const scrollable=e=>e.clientHeight>0&&e.scrollHeight>e.clientHeight+1&&(e===document.scrollingElement||/^(auto|scroll|hidden)$/.test(getComputedStyle(e).overflowY));
  const owned=list?messages().filter(m=>list.contains(m.e)):[];
  // Some list implementations expose message-list outside the scrollport.
  // Virtualization may leave only the reply mounted after a long prompt.
  // Walk ancestors of that MESSAGE, never a child code block or sidebar.
  if(owned.length)for(let e=owned[0].e.parentElement;e&&e!==list&&list.contains(e);e=e.parentElement)if(owned.every(m=>e.contains(m.e))&&scrollable(e))return e;
  for(let e=list;e;e=e.parentElement)if(scrollable(e))return e;
  return null;
 };
 const dialogs=[...document.querySelectorAll('[role="dialog"],[role="alertdialog"],[data-slot="dialog-content"]')].filter(visible);
 const text=dialogs.map(e=>e.innerText||'').join('\n');
 // The reference uploader opens an alertdialog BEFORE any conversation exists.
 // Bind it to this exact owned draft, selected mode and ordered filenames.
 // Consent is a separate explicit user action, never an automatic parameter.
 const referenceDraft=()=>{
  const roots=[...document.querySelectorAll('[data-testid="chat_input"]')];
  if(roots.length!==1||!creationRoute()||!['image','video'].includes(arg.kind))return null;
  const root=roots[0],draft=root.querySelector('textarea,[contenteditable="true"]'),tab=root.querySelector('[data-testid="creation-skill-switch-tab-'+arg.kind+'"]'),names=arg.referenceNames||[],images=[...root.querySelectorAll('[data-testid="attachment-image-card"] img[alt]')];
  if(!matchesEditor(draft,arg.prompt)||tab?.getAttribute('data-state')!=='active'||!names.length||images.length!==names.length||!images.every((e,i)=>e.alt===names[i]))return null;
  return root;
 };
 const referenceAuthorization=()=>{
  const dialog=dialogs.filter(e=>e.dataset.testid==='safety_authorization_dialog');
  if(dialog.length!==1||!referenceDraft())return null;
  const body=(dialog[0].innerText||'').trim(),confirm=[...dialog[0].querySelectorAll('[data-testid="safety_authorization_confirm_btn"]')].filter(enabled),reject=[...dialog[0].querySelectorAll('[data-testid="safety_authorization_reject_btn"]')].filter(enabled);
  if(!/^安全确认\s+你在本功能中上传、使用的素材，均已获充分授权，无侵权违法风险。/.test(body)||!body.includes('《豆包使用规范》')||!body.includes('相关责任需由你自行承担。')||confirm.length!==1||reject.length!==1||label(confirm[0])!=='确认'||label(reject[0])!=='取消'||!body.replace(/\s+/g,'').endsWith('取消确认'))return null;
  return {details:{kind:'reference_authorization',messageId:'reference-safety-authorization',label:'同意素材声明并继续',summary:body.slice(0,body.lastIndexOf('取消')).trim()},button:confirm[0]};
 };
 if(op==='authorize-reference'){
  const owned=referenceAuthorization();if(!owned||arg.userConfirmed!==true||JSON.stringify(owned.details)!==JSON.stringify(arg.expected))return {error:'素材声明、原提示词或参考顺序已变化，未确认',code:'DOUBAO_REFERENCE_AUTHORIZATION_CHANGED'};
  const b=owned.button,r=b.getBoundingClientRect(),x=Math.round(r.left+r.width/2),y=Math.round(r.top+r.height/2),hit=document.elementFromPoint(x,y);
  if(x<0||y<0||x>=innerWidth||y>=innerHeight||!hit||hit!==b&&!b.contains(hit))return {error:'素材声明确认按钮被遮挡，未确认'};
  return {sendPoint:{x,y}};
 }
 if(op==='observe'||op==='observe-readonly'){
  const owned=referenceAuthorization();if(owned)return {gate:'reference_authorization_required',ack:false,url:location.href,generationState:'waiting_parameters',referenceAuthorization:owned.details};
 }
 const verification=[...document.querySelectorAll('[class*="captcha"],[id*="captcha"],[data-testid*="captcha"]')].some(visible);
 const gate=verification||/验证码|安全验证|人机验证|滑块/.test(text)?'human_verification_required':find(/^(登录|立即登录|手机号登录|扫码登录)$/,'to_login_button')?'login_required':dialogs.length?'page_blocked':null;
 if(op==='reference-authorization-state'){
  const owned=referenceAuthorization();
  return {ready:!!owned||!gate&&!!referenceDraft()&&messages().length===0,present:!!owned,...owned?{referenceAuthorization:owned.details}:{}};
 }
 if((op==='observe'||op==='observe-readonly')&&!gate&&referenceDraft()&&messages().length===0)return {ack:false,url:location.href,referenceAuthorizationDraftReady:true};
 if(op==='dismiss-desktop-promotion'){
  if(gate!=='page_blocked'||dialogs.length!==1||!text.includes('下载电脑版'))return {dismissed:false};
  const trial=/下载电脑版\s*新用户\s*领\s*30\s*天免费体验套餐/.test(text)&&text.includes('下载豆包电脑版')&&[...dialogs[0].querySelectorAll('button,a,[role="button"]')].some(e=>enabled(e)&&label(e)==='立即下载');
  const desktop=/^下载电脑版\s*使用完整功能/.test((dialogs[0].innerText||'').trim())&&text.includes('随时帮忙的 AI 桌面助手')&&[...dialogs[0].querySelectorAll('button,a,[role="button"]')].some(e=>enabled(e)&&label(e)==='下载电脑版');
  if(!text.includes('下载豆包工作')&&!trial&&!desktop)return {dismissed:false};
  const options=[...dialogs[0].querySelectorAll('button,[role="button"],a,span,div')].filter(e=>{if(!enabled(e))return false;const value=label(e);if(value==='下次提醒我')return true;if(!trial||!e.matches('button,[role="button"]'))return false;const r=e.getBoundingClientRect();return /^(?:关闭|Close|×)$/i.test(value)||!value&&!!e.querySelector('svg')&&r.width<=48&&r.height<=48;}),leaf=options.filter(e=>!options.some(other=>other!==e&&e.contains(other)));
  if(leaf.length!==1)return {dismissed:false};leaf[0].click();return {dismissed:true};
 }
 if(op==='diagnostics'){
  // Only structural signals and the explicitly owned prompt's match status.
  // Never return unrelated messages, browser storage, cookies or page HTML.
  const shape=e=>({tag:e.tagName,testid:e.getAttribute('data-testid')||'',role:e.getAttribute('data-role')||e.getAttribute('data-message-role')||e.getAttribute('role')||'',className:String(e.className||'').slice(0,240),...(e.getAttribute('role')==='tab'?{selected:e.getAttribute('aria-selected')==='true',active:e.getAttribute('data-state')==='active',disabled:e.hasAttribute('data-disabled')||!enabled(e)}:{})});
  const candidates=[...document.querySelectorAll('[data-testid*="message"],[data-message-id],[data-msg-id],[data-role],[class*="message"],[class*="chat-item"]')].filter(visible);
  const promptMatches=[...document.querySelectorAll('div,p,span')].filter(e=>visible(e)&&(e.innerText||'').trim()===arg.prompt).filter(e=>![...e.children].some(c=>(c.innerText||'').trim()===arg.prompt));
  const list=messageList(),owner=scrollOwner(list),scrollAncestors=[];for(let e=list;e&&scrollAncestors.length<14;e=e.parentElement)scrollAncestors.push({...shape(e),clientHeight:e.clientHeight,scrollHeight:e.scrollHeight,scrollTop:e.scrollTop,overflowY:getComputedStyle(e).overflowY,documentRoot:e===document.scrollingElement});
  const nestedScroll=list?[...list.querySelectorAll('div')].filter(e=>e.clientHeight>0&&e.scrollHeight>e.clientHeight+1).slice(0,20).map(e=>({...shape(e),clientHeight:e.clientHeight,scrollHeight:e.scrollHeight,scrollTop:e.scrollTop,overflowY:getComputedStyle(e).overflowY,containsAllMessages:messages().filter(m=>list.contains(m.e)).every(m=>e.contains(m.e))})):[];
  // Inspect excluded chrome structurally, without leaking history titles,
  // message text, URLs, input values or credentials into the diagnostic log.
  const controlStructures=[...document.querySelectorAll('button,[role="button"],[data-testid]')].filter(e=>visible(e)&&!e.closest('[data-testid="message-list"],[data-testid="send_message"],[data-testid="receive_message"],[data-message-id],input,textarea,[contenteditable="true"]')).slice(0,100).map(e=>({...shape(e),enabled:enabled(e),navigation:!!e.closest('nav,[role="navigation"]'),hasLabel:!!label(e),newChatWording:/^(?:新对话|新建对话|开启新对话|New chat)(?:\s|$|Ctrl|Alt|Shift|[（(])/i.test(label(e)),hasSvg:!!e.querySelector('svg')}));
  // Only fixed capability words, never arbitrary button labels/history names.
  // New Doubao builds move the old capability bar behind skills navigation.
  const capabilityWords=/^(?:对话|技能|使用技能|全部技能|图像生成|图片生成|生成图片|视频生成|生成视频)$/;
  const capabilityControls=controls().filter(e=>!e.closest('[data-testid="message-list"],[data-testid="send_message"],[data-testid="receive_message"],[data-message-id],input,textarea,[contenteditable="true"]')&&capabilityWords.test(label(e))).map(e=>({...shape(e),label:label(e),navigation:!!e.closest('nav,[role="navigation"]'),menu:!!e.closest('[role="menu"],[role="listbox"]')})).slice(0,30);
  const replyTools=messages().filter(m=>m.assistant===true).slice(-2).map(m=>({index:m.index,completed:m.completed,characters:m.text.length,nodes:[...m.e.querySelectorAll('*')].filter(e=>/code|artifact|tool|render|canvas|pending|load|progress|video|generat/i.test(e.tagName+' '+(e.getAttribute('class')||'')+' '+(e.getAttribute('data-testid')||''))||e.getAttribute('role')==='progressbar'||label(e)==='生成代码').slice(0,80).map(e=>({...shape(e),visible:visible(e),characters:(e.textContent||'').length,busy:e.getAttribute('aria-busy')==='true',state:(e.getAttribute('data-state')||'').slice(0,30),.../^(?:生成代码|生成中|正在生成|运行|预览|下载)$/.test(label(e))?{label:label(e)}:{}}))}));
  return {gate,url:location.href,composer:!!editor(),controlStructures,capabilityControls,replyTools,newConversation:{ready:!!newConversationEntry(),candidates:newConversationEntries().map(e=>({...shape(e),label:label(e),navigation:!!e.closest('nav,[role="navigation"]')}))},mode:modeState(),scroll:{listFound:!!list,owner:owner?shape(owner):null,ancestors:scrollAncestors,nested:nestedScroll},messageCount:messages().length,messageSignals:messages().map(m=>({assistant:m.assistant,characters:m.text.length,exact:m.text===arg.prompt,contains:m.text.includes(arg.prompt),prefix:m.text.startsWith(arg.prompt)})),structures:[...new Map(candidates.map(e=>{const v=shape(e);return [JSON.stringify(v),v];})).values()].slice(0,70),promptMatches:promptMatches.slice(0,3).map(e=>{const ancestors=[];for(let p=e,i=0;p&&i<7;p=p.parentElement,i++)ancestors.push({...shape(p),exact:(p.innerText||'').trim()===arg.prompt});return ancestors;})};
 }
 const unavailable=()=>!!creationRoute()&&!gate&&!editor()&&!hasUploads()&&messages().length===0&&/^该页面暂时不可用\s*我们正在努力解决，请尝试刷新此页面。\s*刷新页面\s*返回首页$/.test((document.body?.innerText||'').trim());
 if(op==='inspect')return {gate,composer:!!editor(),unavailable:unavailable()};
 if(op==='refresh-ready'||op==='pending-ack-refresh-ready'){
  const e=editor(),empty=e&&(e.tagName==='TEXTAREA'?e.value==='':e.textContent===''&&!e.querySelector('img,video,audio,input,[contenteditable="false"]'));
  const pendingSafe=op!=='pending-ack-refresh-ready'||arg.renderedPromptUrl===location.href&&/^https:\/\/(www\.)?doubao\.com\/chat\/\d+\/?$/.test(location.href)&&messages().every(m=>m.assistant===true)&&!document.querySelector('video,[role="progressbar"],[class*="video-player-wrapper"]');
  return {gate,ready:pendingSafe&&!gate&&!!empty&&!hasUploads()&&!find(/^(停止|停止生成|停止回答)$/)};
 }
 if(gate&&!['observe','observe-readonly'].includes(op))return {gate};
 if(op==='draft-ready'){
  const e=editor(),uploads=hasUploads(),hasDraft=!!String(e?.value??e?.innerText??'').trim();
  return {ready:(/^https:\/\/(www\.)?doubao\.com\/chat\/?$/.test(location.href)||!!creationRoute())&&messages().length===0&&!uploads&&modeState().ready&&matchesEditor(e,arg.prompt),hasDraft,uploads};
 }
 if(op==='new'){
  if(String(editor()?.value??editor()?.innerText??'').trim()||hasUploads())return {error:'输入区已有草稿或附件，未离开原页面、未清空或发送'};
  const b=newConversationEntry();if(!b)return {error:'未找到新对话入口'};const workEntry=!!b.closest('[data-testid="create_office_task_button"]');b.click();return {clicked:true,workEntry};
 }
 if(op==='new-ready'){
  const composer=!!editor(),empty=messages().length===0&&!String(editor()?.value??editor()?.innerText??'').trim()&&!hasUploads();
  // This signal is only for a newly owned, never-submitted page: the sidebar
  // mounted, but the creation editor never did. Hidden drafts/media disqualify it.
  const emptyBootstrap=!!creationRoute()&&document.readyState==='complete'&&!gate&&!composer&&empty&&!!newConversationEntry()&&!document.querySelector('textarea,[contenteditable="true"],video,audio,[role="dialog"],[role="alertdialog"],[role="progressbar"]');
  // Live guidance input hydrates a hidden mirror before its interactive editor.
  // Report only this exact empty placeholder; never make it visible or writable.
  const mirrors=[...document.querySelectorAll('.guidance-input-editor-viewport .tiptap.ProseMirror[contenteditable="true"]')];
  const pendingComposer=!!creationRoute()&&!gate&&!composer&&empty&&mirrors.length===1&&!visible(mirrors[0])&&mirrors[0].getClientRects().length>0&&!mirrors[0].textContent.trim()&&!mirrors[0].querySelector('img,video,audio,input,button,[contenteditable="false"]')&&[...mirrors[0].querySelectorAll('[data-placeholder]')].some(e=>/^描述你想要的(?:图片|视频)$/.test(e.getAttribute('data-placeholder')||''));
  return {ready:!!newConversationEntry(),empty,composer,unavailable:unavailable(),emptyBootstrap,pendingComposer:!!pendingComposer};
 }
 if(op==='fresh')return {gate,empty:messages().length===0&&!String(editor()?.value??editor()?.innerText??'').trim()&&!hasUploads(),composer:!!editor()};
 if(op==='mode-ready')return modeState();
 if(op==='mode-entry-ready'){
  if(creationRoute()&&['image','video'].includes(arg.kind))return {ready:!!creationTab(arg.kind)};
  const re=arg.kind==='text'?/^对话$/:arg.kind==='image'?/^(图像生成|图片生成)$/:/^视频生成$/;
  const b=find(re,arg.kind==='text'?'chat_input_action_mode':arg.kind==='image'?'skill_bar_button_3':'skill_bar_button_17');
  return {ready:!!b&&re.test(label(b))};
 }
 if(op==='mode-reset'){
  const chips=controls().filter(e=>e.dataset.testid==='skill_input_exit_button'),chip=chips.find(e=>e.getAttribute('data-input-engine-action-source')==='actionbar')||(chips.length===1?chips[0]:null);
  if(!chips.length)return {reset:true};if(!chip)return {error:'无法唯一定位原生成模式的退出控件'};chip.click();return {reset:true};
 }
 if(op==='mode'){
  if(creationRoute()&&['image','video'].includes(arg.kind)){
   const tab=creationTab(arg.kind);if(!tab)return {error:'未找到唯一的生成类型选项，未切换或发送'};
   if(messages().length||String(editor()?.value??editor()?.innerText??'').trim()||hasUploads())return {error:'生成入口已有内容，未切换或丢弃原内容'};
   // This observed tab uses mousedown (click() alone does nothing). Keep
   // ordinary click compatibility; neither event submits a generation.
   tab.dispatchEvent(new MouseEvent('mousedown',{button:0,bubbles:true,cancelable:true}));tab.click();return {selected:true};
  }
  if(arg.kind==='text'){const b=find(/^对话$/,'chat_input_action_mode');if(!b)return {error:'未找到唯一的对话能力入口，未假定新对话就是文本模式'};b.click();return {selected:true};}
  const b=arg.kind==='image'?find(/^(图像生成|图片生成)$/,'skill_bar_button_3'):find(/^视频生成$/,'skill_bar_button_17');
  if(!b||!new RegExp(arg.kind==='image'?'^(图像生成|图片生成)$':'^视频生成$').test(label(b)))return {error:'未找到对应的生成能力入口'};b.click();return {selected:true};
 }
 if(op==='video-duration'){
  if(!modeState().ready||arg.kind!=='video')return {error:'视频输入区未就绪，未设置时长'};
  const params=controls().filter(e=>e.hasAttribute('data-creation-params-panel-id')&&/·\s*\d+\s*s\b/.test(label(e)));
  if(arg.phase==='entry-ready')return {ready:params.length===1};
  if(params.length!==1)return {error:'未找到唯一的视频时长参数入口'};
  if(arg.phase==='read')return {ready:/·\s*15\s*s\b/.test(label(params[0]))};
  if(arg.phase==='open'){
   const p=params[0];if(p.getAttribute('data-state')==='open')return {opened:true};
   // The observed creation-page dropdown opens on pointerdown; legacy
   // controls without this state contract continue using their click handler.
   if(creationRoute()&&p.getAttribute('data-state')==='closed')p.dispatchEvent(new PointerEvent('pointerdown',{button:0,bubbles:true,cancelable:true,pointerType:'mouse',isPrimary:true}));
   else p.click();return {opened:true};
  }
  const menus=[...document.querySelectorAll('[role="menu"]')].filter(e=>visible(e)&&/时长/.test(e.innerText||'')),sliders=menus.length===1?[...menus[0].querySelectorAll('[role="slider"]')].filter(enabled):[];
  if(arg.phase==='focus-ready')return {ready:sliders.length===1&&sliders[0].getAttribute('aria-valuemin')==='0'&&sliders[0].getAttribute('aria-valuemax')==='11'&&/4s/.test(menus[0].innerText)&&/15s/.test(menus[0].innerText)};
  if(arg.phase==='focus'){
   if(sliders.length!==1||sliders[0].getAttribute('aria-valuemin')!=='0'||sliders[0].getAttribute('aria-valuemax')!=='11'||!/4s/.test(menus[0].innerText)||!/15s/.test(menus[0].innerText))return {error:'网页时长控件已变化，未发送视频'};
   sliders[0].focus();return {focused:true};
  }
 }
 if(op==='fill'){
  if(arg.kind&&!modeState().ready)return {error:'生成模式尚未切换完成，未写入提示词'};
  const e=editor();if(!e)return {error:'未找到可编辑输入区'};e.focus();
  if(openSourceCore){const result=openSourceCore('fill',{scope:e,text:arg.prompt});if(result.error)return result;return {matches:matchesEditor(e,arg.prompt)};}
  if(e.tagName==='TEXTAREA'){Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,arg.prompt);e.dispatchEvent(new Event('input',{bubbles:true}));}
  else {const r=document.createRange();r.selectNodeContents(e);const s=getSelection();s.removeAllRanges();s.addRange(r);document.execCommand('delete');document.execCommand('insertText',false,arg.prompt);}
  return {matches:matchesEditor(e,arg.prompt)};
 }
 if(op==='send-ready'){
  const e=editor();return {ready:(!arg.kind||modeState().ready)&&matchesEditor(e,arg.prompt)&&!!find(/^(发送|发送消息|Send)$/i,'chat_input_send_button')};
 }
 if(op==='send'){
  if(arg.kind&&!modeState().ready)return {error:'发送前生成模式校验失败，未提交'};
  if(arg.kind==='video'&&Number(arg.durationSeconds)===15){const p=controls().filter(e=>e.hasAttribute('data-creation-params-panel-id')&&/·\s*15\s*s\b/.test(label(e)));if(p.length!==1)return {error:'发送前 15 秒参数校验失败，未提交'};}
  const e=editor();if(!matchesEditor(e,arg.prompt))return {error:'发送前提示词校验失败'};
  const b=find(/^(发送|发送消息|Send)$/i,'chat_input_send_button');if(!b)return {error:'未找到唯一可用的发送按钮'};
  if(arg.nativeInput){const r=b.getBoundingClientRect(),x=Math.round(r.left+r.width/2),y=Math.round(r.top+r.height/2),hit=document.elementFromPoint(x,y);if(x<0||y<0||x>=innerWidth||y>=innerHeight||!hit||hit!==b&&!b.contains(hit))return {error:'发送按钮被遮挡或已移出页面，未提交'};return {sendPoint:{x,y}};}
  b.click();return {clicked:true};
 }
 if(op==='reference-input'){
  if(arg.kind&&!modeState().ready)return {error:'参考附件上传前生成模式未就绪',code:'DOUBAO_REFERENCE_MODE_NOT_READY'};
  const files=arg.files||[],inputs=[...document.querySelectorAll('input[type="file"]')].filter(n=>!n.disabled),e=editor(),root=e?.closest('[data-testid="chat_input"]')||e?.closest('form');
  const mime={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',apng:'image/apng',gif:'image/gif',wav:'audio/wav',mp3:'audio/mpeg',m4a:'audio/mp4',mp4:'video/mp4',webm:'video/webm'};
  const accepts=(input,file)=>{const extension='.'+String(file.name||'').split('.').at(-1).toLowerCase(),type=mime[extension.slice(1)]||'';return !input.accept||input.accept.split(',').map(s=>s.trim().toLowerCase()).filter(Boolean).some(s=>s===extension||s===type||s.endsWith('/*')&&type.startsWith(s.slice(0,-1)));};
  if(!inputs.length)return {error:'未找到可用的参考附件上传入口',code:'DOUBAO_REFERENCE_UPLOADER_MISSING'};
  const scoped=inputs.filter(n=>root?.contains(n)),pool=scoped.length?scoped:inputs,unsupported=files.filter(f=>!pool.some(n=>accepts(n,f)));
  if(unsupported.length)return {error:'当前豆包'+({image:'图片',video:'视频',text:'对话'}[arg.kind]||'')+'入口不支持参考文件：'+unsupported.map(f=>f.name).join('、')+'；网页允许类型：'+[...new Set(pool.map(n=>n.accept||'网页未限定'))].join('；'),code:'DOUBAO_REFERENCE_TYPE_UNSUPPORTED'};
  const candidates=pool.filter(n=>(arg.sequential||files.length<=1||n.multiple)&&files.every(f=>accepts(n,f)));
  if(candidates.length!==1)return {error:candidates.length?'存在多个参考上传入口，无法唯一定位，未上传':'此入口不能一次接收这些参考附件，未上传',code:'DOUBAO_REFERENCE_UPLOADER_AMBIGUOUS'};
  const token=crypto.randomUUID();candidates[0].setAttribute('data-shensi-reference-uploader',token);return {selector:'input[data-shensi-reference-uploader="'+token+'"]',accept:candidates[0].accept,multiple:candidates[0].multiple};
 }
 if(op==='uploads'){
  const names=arg.names||[],e=editor(),input=document.querySelector('input[type="file"]'),composer=e?.closest('[data-testid="chat_input"]');let area=composer||e?.closest('form')||e?.parentElement?.parentElement;
  // Creation-page previews can be siblings of the form. Widen only to their
  // shared composer; never use filenames from a prior conversation as proof.
  for(let depth=0;!composer&&depth<3&&area?.parentElement&&area.parentElement!==document.body&&!area.parentElement.matches('nav,[role="navigation"]')&&!area.parentElement.querySelector('[data-testid="message-list"],[data-testid="send_message"],[data-testid="receive_message"]');depth++)area=area.parentElement;
  const pending=!!area?.querySelector('[role="progressbar"],[class*="uploading"],[class*="upload-progress"],[aria-busy="true"]');
  const previews=area?[...area.querySelectorAll('[class*="upload-preview"],[class*="attachment"],[data-testid*="upload"],[data-testid*="attachment"],img[alt],[data-file-name]')].filter(visible):[];
  const text=[area?.innerText||'',...previews.flatMap(p=>[p,...p.querySelectorAll('[title],[aria-label],img')]).flatMap(p=>['title','aria-label','alt','data-file-name'].map(a=>p.getAttribute(a)||''))].join('\n');
  const missing=names.filter(n=>!text.split('\n').some(t=>t.trim()===n||t.includes(n))),matched=names.length-missing.length;
  // Website upload rejections can be brief toasts outside the composer.
  // Restrict this to visible notices, never old conversation text.
  const notices=[...document.querySelectorAll('[role="alert"],[data-sonner-toast],[class*="toast"],[class*="Toast"]')].filter(visible).map(n=>(n.innerText||'').trim()).filter(t=>t&&t.length<=300);
  const rejection=[...previews.map(p=>p.innerText||''),...notices].find(t=>/上传失败|不支持.{0,8}(?:格式|文件)|文件过大|upload failed/i.test(t));
  const failure=rejection?rejection.slice(0,300):'';
  const limit=[String(area?.innerText||''),...notices].join('\n').match(/(?:最多|至多|上限(?:为|是)?)[\s：:]*(?:可|支持)?(?:上传|添加|使用)?\s*(\d+)\s*(?:张(?:图片|参考图)?|个(?:图片|参考图))/);
  return {ready:!pending&&!failure&&names.length>0&&matched===names.length,matched,missing,pending,failure,input:!!input,...(limit?{imageLimit:Number(limit[1])}:{})};
 }
 if(op==='observe'||op==='observe-readonly'||op==='confirm'||op==='confirm-ready'){
  let all=messages(),historyRecovery;
  // The live message list virtualizes older turns. Recover this exact owned
  // transcript from overlapping rendered slices; never infer ownership from a
  // URL alone or forget intervening user messages. No chat state/API is read.
  const list=messageList(),scroller=scrollOwner(list);
  if(arg.recoverHistory&&!gate&&(!all.some(m=>m.assistant===false&&m.promptMatches)||scroller&&scroller.scrollTop+scroller.clientHeight<scroller.scrollHeight-2)){
   if(scroller){
    const originalTop=scroller.scrollTop,started=Date.now(),signature=m=>JSON.stringify([m.id,m.assistant,m.text]);
    // Hidden Chromium windows can coalesce scroll events for a full second.
    // Wait for this movement to be delivered before advancing again; sleeping
    // a fixed 120ms skipped virtual slices and lost the original confirmation.
    const move=top=>new Promise(resolve=>{
     const remaining=8500-(Date.now()-started)-150;if(remaining<=0){resolve(false);return;}
     const target=Math.max(0,Math.min(top,scroller.scrollHeight-scroller.clientHeight));
     if(Math.abs(scroller.scrollTop-target)<1){
      // A user scroll may have assigned scrollTop immediately before this
      // observation, while its virtual-list render is still pending.
      // Hidden windows may never receive an animation frame. The later exact
      // transcript/overlap checks establish readiness, not this frame signal.
      const timeout=setTimeout(()=>{cancelAnimationFrame(frame);resolve(Math.abs(scroller.scrollTop-target)<1);},Math.min(1400,remaining));
      const frame=requestAnimationFrame(()=>{clearTimeout(timeout);setTimeout(()=>resolve(true),120);});return;
     }
     let timer;const done=ok=>{clearTimeout(timer);scroller.removeEventListener('scroll',onScroll);setTimeout(()=>resolve(ok),120);};
     const onScroll=()=>{if(Math.abs(scroller.scrollTop-target)<1)done(true);};
     // Hidden pages may apply the offset without dispatching a scroll event.
     // Accept only the measured target; transcript overlap still proves that
     // the virtual rows rendered. Override smooth scrolling for this read.
     scroller.addEventListener('scroll',onScroll);timer=setTimeout(()=>done(Math.abs(scroller.scrollTop-target)<1),Math.min(1400,remaining));scroller.scrollTo({top:target,behavior:'instant'});
    });
    let history=[],valid=true,atBottom=false,steps=0;
    const capture=()=>messages().map(m=>({...m,media:openSourceCore&&arg.kind!=='text'?openSourceCore('media',{scope:m.e,kind:arg.kind,visible}).artifacts.map(a=>({...a,ready:true})):[...m.e.querySelectorAll(arg.kind==='video'?'video':'img')].filter(e=>visible(e)&&!e.closest('[class*="avatar"],[class*="reference"],[class*="upload"]')).map(e=>({url:e.currentSrc||e.src||e.querySelector?.('source')?.src,width:e.naturalWidth||e.videoWidth||0,height:e.naturalHeight||e.videoHeight||0,ready:arg.kind==='video'?Number.isFinite(e.duration)&&e.duration>0:e.complete}))}));
    try{
     valid=await move(0);
     for(let step=0;valid&&step<32&&Date.now()-started<8500;step++){
      steps++;
      const slice=capture();
      if(!history.length)history=slice;
      else if(slice.length){
       const overlaps=[];for(let n=1;n<=Math.min(history.length,slice.length);n++)if(history.slice(-n).every((m,i)=>signature(m)===signature(slice[i])))overlaps.push(n);
       if(!overlaps.length){valid=false;break;}const overlap=Math.max(...overlaps);history.splice(history.length-overlap,overlap,...slice);
      }
      if(scroller.scrollTop+scroller.clientHeight>=scroller.scrollHeight-2){atBottom=true;break;}
      valid=await move(scroller.scrollTop+Math.max(1,scroller.clientHeight*.9));
     }
     if(valid&&atBottom)all=history.map((m,index)=>({...m,index}));
    }finally{historyRecovery={steps,valid,atBottom,messageCount:history.length,userMessageCount:history.filter(m=>m.assistant!==true).length,originalMatches:history.filter(m=>m.assistant===false&&m.promptMatches).length,...(!valid?{scroll:{initialTop:originalTop,top:scroller.scrollTop,height:scroller.scrollHeight,viewport:scroller.clientHeight,behavior:getComputedStyle(scroller).scrollBehavior}}:{})};if(!valid||!atBottom||historyRecovery.originalMatches!==1)scroller.scrollTop=originalTop;}
    if(!valid||!atBottom||historyRecovery.originalMatches!==1)return {gate,ack:false,url:location.href,historyRecovery};
   }else if(!all.some(m=>m.assistant===false&&m.promptMatches))return {gate,ack:false,url:location.href,historyRecovery:{reason:'scroll_container_not_found',steps:0,valid:false,atBottom:false,messageCount:all.length,userMessageCount:all.filter(m=>m.assistant!==true).length,originalMatches:0}};
  }
  const users=all.filter(m=>m.assistant===false),matched=users.filter(m=>m.promptMatches),first=matched.length===1?matched[0]:null;
  if(!first)return {gate,ack:false,url:location.href,...(historyRecovery?{historyRecovery}:{})};
  // User-supplied manual context is observation-only. It never registers a
  // confirmation receipt or relaxes the normal observer/confirm operations.
  const followingUsers=users.filter(m=>m.index>first.index),manualRequested=op==='observe-readonly'&&Array.isArray(arg.manualReplies);
  const manualMatched=manualRequested&&arg.userId===(first.id||String(first.index))&&arg.manualReplies.length===followingUsers.length&&followingUsers.every((m,i)=>m.text===arg.manualReplies[i]);
  const manualTrace=manualRequested?{matched:manualMatched,suppliedCount:arg.manualReplies.length,observedCount:followingUsers.length,originalMessageMatches:arg.userId===(first.id||String(first.index)),observationOnly:true}:null;
  if(manualRequested&&!manualMatched)return {gate:'conversation_changed',ack:true,url:location.href,manualTrace,...(historyRecovery?{historyRecovery}:{})};
  const replies=arg.confirmationReplies||[],used=new Set(),confirmationAcknowledgements=[];
  const unexpected=followingUsers.some(m=>{
   // A repeated short reply is accepted only in its journaled assistant turn.
   const preceding=all.filter(a=>a.assistant&&a.index>first.index&&a.index<m.index).at(-1);
   const candidates=replies.filter(r=>!used.has(r.id)&&r.reply===m.text&&r.messageId===(preceding?.id||String(preceding?.index))&&r.summary===preceding?.text);
   if(candidates.length!==1)return !(replies.length===0&&m.text===arg.confirmation);
   const r=candidates[0];used.add(r.id);if(all.some(a=>a.assistant&&a.index>m.index))confirmationAcknowledgements.push(r.id);return false;
  });
  if(unexpected&&!manualMatched)return {gate:'conversation_changed',ack:true,url:location.href,...(historyRecovery?{historyRecovery}:{})};
  const answers=all.filter(m=>m.assistant&&m.index>first.index),last=answers.at(-1),artifacts=[],mediaActivations=[];let ignoredReferenceReplies=0,activatedPlayers=0;
  for(const m of answers){
   if(arg.kind!=='text'&&referenceOnlyReply(m.text)){ignoredReferenceReplies++;continue;}
   if(m.media&&(!openSourceCore||!m.e?.isConnected)){for(const item of m.media)if(item.url&&item.ready&&item.width>=(arg.kind==='image'?128:1)&&item.height>=(arg.kind==='image'?128:1))artifacts.push({url:item.url,kind:arg.kind,messageId:m.id||String(m.index),width:item.width,height:item.height});continue;}
   const scope=m.e.querySelector('div.grid')||m.e;
   if(openSourceCore&&arg.kind!=='text'){
    const ownedPlayback=op==='observe-readonly'&&arg.recoverVideoPlayback===true&&arg.nativeMediaInput===true&&arg.kind==='video'&&arg.userId===(first.id||String(first.index))&&m===last;
    const read=openSourceCore('media',{scope,kind:arg.kind,visible,activate:(op==='observe'||ownedPlayback)&&!gate&&arg.activateMedia===true,nativeInput:arg.nativeMediaInput===true});
    activatedPlayers+=read.activated||0;
    mediaActivations.push(...(read.activationTargets||[]));
    artifacts.push(...(read.artifacts||[]).map(item=>({...item,messageId:m.id||String(m.index)})));continue;
   }
   for(const e of scope.querySelectorAll(arg.kind==='video'?'video':'img')){
    if(e.closest('[class*="avatar"],[class*="reference"],[class*="upload"]'))continue;
    const url=e.currentSrc||e.src||e.querySelector?.('source')?.src;
    if(!url||!visible(e))continue;
    if(arg.kind==='image'&&(!e.complete||e.naturalWidth<128||e.naturalHeight<128))continue;
    if(arg.kind==='video'&&(!e.videoWidth||!e.videoHeight||!Number.isFinite(e.duration)||e.duration<=0))continue;
    artifacts.push({url,kind:arg.kind,messageId:m.id||String(m.index),width:e.naturalWidth||e.videoWidth,height:e.naturalHeight||e.videoHeight});
   }
  }
  // New creation pages first finish a short acknowledgement, then append the
  // generated media to that message or a following one. This is waiting, not success
  // or a definitive failure; the bounded task observer never re-sends it.
  const creationAcknowledgement=arg.kind!=='text'&&/^(?:(?:好的[，,。]\s*)?我(?:会|将)(?:为你|为您)?(?:(?:生成|制作)(?:一(?:张|段|个))?|把[^。！？\n]{1,180}(?:做成|制成|生成)[^。！？\n]{0,100}(?:图|视频))|(?:好的[，,]\s*)?(?:(?:视频|图片|图像)任务已启动生成(?=[\s：:,，。]|$)|(?:已(?:经)?)?开始生成(?=[\s：:。🎬]|(?:这段|这个|这张|本次|本条)?(?:视频|图片|图像)|$)))/.test(last?.text||'')&&!/无法|不能|不支持|但是|但需|付费|购买|订阅|请前往|其他平台|https?:/i.test(last?.text||'');
  // Native creation replies may expose an action footer while still streaming
  // "我将为…". These incomplete acknowledgements cannot prove rejection.
  // Keep the original observation deadline; do not confirm or resend them.
  const incompleteAcknowledgement=arg.kind!=='text'&&/^我(?:会|将)(?:为(?:你|您)?)?[，,。…\s]*$/.test((last?.text||'').trim());
  const providerThinking=arg.kind!=='text'&&!artifacts.length&&(incompleteAcknowledgement||/^(?:正在思考|找到\s*\d+\s*篇资料)[.。…]*$/.test((last?.text||'').trim())||/^正在(?:读取|查看)\s+doubao[\s_-]+creative[\s_-]+(?:video|image)\s+技能中的\s+SKILL\.md[。.…]*$/i.test((last?.text||'').trim())||/^(?:好的[，,]\s*)?我先(?:读取|查看)(?:图片|图像|视频)创作技能(?:规范|规则)[，,]\s*然后开始生成[。.!！]?\s*$/.test(last?.text||''));
  // A status reply can explicitly retract its earlier prose-only promise.
  // Quoted "排队渲染" in that explanation must not keep the job running.
  const notSubmitted=arg.kind!=='text'&&/^(?:刚才|本次|这次|当前)?(?:这条|这个)?(?:视频|图片)?(?:生成)?任务(?:并)?(?:没有|未)实际提交/.test(last?.text||'')&&/不存在可查询的\s*task_?id|没有真实在跑的渲染任务/.test(last?.text||'')&&!artifacts.length&&!answers.some(m=>m.media?.length||m.e?.querySelector('img,video,[class*="video-player-wrapper"]'));
  const answer=(arg.kind==='text'?answers.filter(m=>m.index>(followingUsers.at(-1)?.index??first.index)):answers).map(m=>m.text).join('\n\n'),waitingText=!notSubmitted&&(providerThinking||creationAcknowledgement&&!artifacts.length||(!creationAcknowledgement||!artifacts.length)&&/正在生成|生成中|预计等待|排队|仍在处理|尚未生成完成|稍后.*发送|生成好后/.test(last?.text||''));
  const ownText=last?.text||'',stopping=!!find(/^(停止|停止生成|停止回答)$/),completed=last?.completed===true;
  // Replies can quote the user's complete no-purchase constraints. Strip only
  // those bounded clauses; positive requests and double negations stay guarded.
  const actionText=ownText.replace(/(^|[（(，,、；;：:\n])(?:不购买|不订阅|不充值)(?=$|[。.!！?？）)，,、；;\n])/g,'$1');
  const humanQuestion=/验证码|安全验证|人机验证|滑块|短信验证/.test(ownText)?'human_verification_required':/请.{0,12}(登录|扫码|输入密码)/.test(ownText)?'login_required':/请.{0,20}(支付|充值|购买|开通会员|授权账号)/.test(actionText)?'generation_action_requires_user':null;
  // Match an owned, finished rejection, not a hypothetical warning or a rate
  // limit. A purchase suggestion after a quota rejection never becomes consent
  // to buy; it can only permit handing this same task to another owned account.
  const quotaKindMatches=!(arg.kind==='video'&&/图片|图像/.test(ownText)&&!/视频/.test(ownText))&&!(arg.kind==='image'&&/视频/.test(ownText)&&!/图片|图像/.test(ownText));
  // Negated quota notices are not refusals even when another sentence says
  // "尚未生成完成。没有失败". Never let broad cross-sentence matches release
  // an unknown task or poison the account's quota state.
  const deniesQuota=/(?:没有|不存在|并非|不是|并不|未出现|未发生|无)(?:任何)?[^。；;\n]{0,12}(?:额度|余额|次数)(?:不足|不够|耗尽|用完|用尽|为\s*0)/.test(ownText);
  const quotaNow=quotaKindMatches&&!deniesQuota&&/(?:次数|额度|余额).{0,20}(?:用完|用尽|耗尽|不足|不够|上限|为\s*0)/.test(ownText)&&
   (/每日|今日|今天|本日|当天|明天|次日/.test(ownText)||/近\s*\d+\s*天免费额度(?:已)?(?:用完|用尽|耗尽)[，,。\s]/.test(ownText)&&/预计.{0,40}恢复/.test(ownText)||/当前|你的|您的|剩余|本账号/.test(ownText)&&/(?:无法|不能|不支持).{0,16}生成|生成.{0,12}(?:失败|拒绝)/.test(ownText))&&
   !/如果|假如|若|可能|操作过于频繁|请求过于频繁|安全验证|人机验证/.test(ownText);
  // The observed Work quota card has a subscription CTA instead of the normal
  // answer footer. Its exact completed notice plus the owned CTA is rejection
  // evidence, never permission to subscribe or an arbitrary prose heuristic.
  const quotaCard=arg.kind==='video'&&ownText==='今日视频生成免费额度已用完。开通订阅畅享更多额度。'&&[...last?.e?.querySelectorAll('button,a,[role="button"]')||[]].some(e=>visible(e)&&label(e).replace(/[→➜↗]\s*$/,'').trim()==='开通豆包订阅');
  const quotaRejection=quotaNow&&(completed||quotaCard)&&!waitingText&&!stopping&&!artifacts.length;
  const generationNotStarted=arg.kind!=='text'&&referenceOnlyReply(ownText)&&completed&&!waitingText&&!stopping&&!artifacts.length&&!humanQuestion;
  // A finished script is a wrong deliverable, not an accepted generation.
  // Correct it in the SAME owned conversation through the normal journaled
  // confirmation flow. Explicit refusals/external-tool handoffs stay blocked.
  const correction=!!generationNotStarted&&promptOnlyReply(ownText)&&!answers.some(m=>m.media?.length||m.e?.querySelector('img,video'))&&!/无法|不能|不支持|不具备|Pika|Runway|可灵|即梦|Sora|Veo|请前往|其他平台/i.test(ownText);
  const explicit=/确认后|请.*确认|生成参数确认/.test(ownText);
  // The current native parameter card has no assistant action footer. Its
  // full field set and explicit closing sentence identify a finished question;
  // the scheduler additionally requires an unchanged stability window.
  const nativeParameterSummary=arg.kind==='video'&&/视频生成参数确认/.test(ownText)&&/模型[：:]\s*\S/.test(ownText)&&/时长[：:]\s*\d+\s*秒/.test(ownText)&&/比例[：:]\s*\d+\s*[:：]\s*\d+/.test(ownText)&&/确认后我再开始生成视频[。.!！]?\s*$/.test(ownText);
  const confirmButtons=last?[...last.e.querySelectorAll('button,[role="button"]')].filter(e=>enabled(e)&&/^(确认生成|开始生成|确认并生成|确认生成视频)$/.test(label(e))):[];
  // Text questions need an explicit request for missing task information;
  // fictional dialogue or a final answer ending in '?' is not a follow-up.
  const directedFollowup=ownText.length<=1500&&!/[“”「」『』"<>]/.test(ownText)&&/(?:为(?:了|继续|便于|完成)|还需要|缺少|请(?:你|您)?(?:先|再|进一步)?(?:补充|提供|告诉我|选择|指定|回复)|你(?:希望|想要)|您(?:希望|想要))/.test(ownText)&&/(?:[？?]\s*$|请(?:你|您)?(?:先|再)?(?:补充|提供|告诉我|选择|指定|回复)[^。！？!?]{1,160}[。！!]?\s*$)/.test(ownText);
  const followup=completed&&(arg.kind==='video'?/[？?]|是否|要不要|请选择|请.{0,8}(告诉|补充|选择|提供|指定|回复)|希望.{0,16}(风格|比例|时长)|需要.{0,16}吗/.test(ownText):directedFollowup);
  // A completed parameter question may promise delivery after confirmation.
  // That wording does not mean generation has already started.
  const activelyGenerating=/正在生成|(?:视频|图片|图像)生成中|(?:已|正在)(?:进入)?排队/.test(ownText);
  const needsConfirmation=(completed||nativeParameterSummary)&&(explicit||confirmButtons.length===1||followup||correction)&&!quotaRejection&&(!generationNotStarted||correction)&&!artifacts.length&&!stopping&&!humanQuestion&&!activelyGenerating&&(!waitingText||completed||nativeParameterSummary);
  // Explicit original-task status inquiry, never a generation retry. Require
  // the complete owned transcript, a finished promise, and no live media/tool.
  const statusOnly=arg.inquireStatus===true&&arg.kind!=='text'&&!gate&&!humanQuestion&&!providerThinking&&waitingText&&completed&&!stopping&&!needsConfirmation&&!artifacts.length&&!answers.some(m=>m.media?.length||m.e?.querySelector('img,video,[role="progressbar"],[class*="video-player-wrapper"]'))&&ownText.length<=6000;
  const waiting=waitingText&&!needsConfirmation&&!statusOnly;
  const statusLines=ownText.split('\n').map(s=>s.trim()).filter(Boolean),remoteQueued=!needsConfirmation&&statusLines.some(s=>/^(?:(?:视频|图片|图像|任务)(?:已|正在)?|已|正在)?(?:进入)?排队(?:中|等待|[，,。.]|$)/.test(s));
  const generating=!remoteQueued&&!needsConfirmation&&!artifacts.length&&statusLines.some(s=>/^(?:(?:视频|图片|图像|任务))?(?:正在生成|生成中|正在渲染)/.test(s)&&!/(?:提示词|剧本|脚本|分镜)/.test(s));
  const generationState=artifacts.length?'complete':needsConfirmation?'waiting_parameters':remoteQueued?'queued':generating?'generating':'unknown';
  const confirmation=statusOnly?{summary:ownText,messageId:last.id||String(last.index),kind:'reply',label:'查询原任务状态',statusOnly:true}:needsConfirmation&&last.text.length<=6000?{summary:last.text,messageId:last.id||String(last.index),kind:confirmButtons.length===1?'button':'reply',label:confirmButtons.length===1?label(confirmButtons[0]):'确认生成',...(!explicit&&followup||correction?{followup:true}:{}),...(correction?{correction:true}:{})}:needsConfirmation;
  if(op==='confirm'||op==='confirm-ready'){
   if(gate||humanQuestion||!confirmation||typeof confirmation!=='object'||JSON.stringify(confirmation)!==JSON.stringify(arg.expected)||arg.userId!==(first.id||String(first.index)))return {error:'生成参数或原消息已变化，请打开原任务核对'};
   const reply=arg.confirmation||'确认生成',button=confirmation.kind==='button'&&!arg.replyOnly;
   if(op==='confirm-ready')return {ready:button||String(editor()?.value??editor()?.innerText??'').trim()===reply&&!!find(/^(发送|发送消息|Send)$/i,'chat_input_send_button')};
   if(button){if(arg.prepareOnly)return {prepared:true};confirmButtons[0].click();return {confirmed:true};}
   const e=editor();if(!e)return {error:'未找到参数确认输入区'};
   if(!arg.commitPrepared){
    if(String(e.value??e.innerText??'').trim())return {error:'账号输入区已有内容，未覆盖或确认'};e.focus();
    if(e.tagName==='TEXTAREA'){Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(e,reply);e.dispatchEvent(new Event('input',{bubbles:true}));}
    else{document.execCommand('insertText',false,reply);}
   }
   if(String(e.value??e.innerText??'').trim()!==reply)return {error:'参数确认文字未完整写入，未发送'};
   if(arg.prepareOnly)return {prepared:true};
   const send=find(/^(发送|发送消息|Send)$/i,'chat_input_send_button');if(!send)return {error:'未找到唯一发送入口，未确认'};send.click();return {confirmed:true};
  }
  // An owned reply saying "没有额度不足" is not a rejection. Quota uses the
  // definitive predicate above; a rate limit must be a finished direct notice,
  // not words mentioned in a streaming acknowledgement or quoted explanation.
  const limited=completed&&!waiting&&!stopping&&!confirmation&&!artifacts.length&&/^(?:抱歉[，,。\s]*)?(?:当前|您的?|你的?)?(?:操作|请求)过于频繁(?:[，,。！!\s]|$)/.test(ownText.trim());
  const rejected=quotaRejection&&!confirmation&&(!humanQuestion||humanQuestion==='generation_action_requires_user');
  const definiteMediaFailure=arg.kind!=='text'&&completed&&!waiting&&!stopping&&!confirmation&&!artifacts.length&&!humanQuestion&&/^(?:抱歉[，,。\s]*)?(?:本次)?(?:(?:图片|图像|视频)?生成(?:失败|未成功|被拒绝)|(?:未通过|无法通过)(?:内容)?审核|参考(?:图片|图像|文件)(?:不可用|无效|无法读取)|会员(?:已)?到期)/.test(ownText.trim());
  const failure=notSubmitted&&completed&&!stopping&&!confirmation&&!humanQuestion?{code:'DOUBAO_GENERATION_NOT_SUBMITTED',message:ownText.slice(0,2000),definitive:true}:definiteMediaFailure?{code:/审核/.test(ownText)?'DOUBAO_CONTENT_REJECTED':/参考/.test(ownText)?'DOUBAO_REFERENCE_UNAVAILABLE':/会员/.test(ownText)?'DOUBAO_MEMBERSHIP_EXPIRED':'DOUBAO_UPSTREAM_FAILED',message:ownText.slice(0,2000),definitive:true}:rejected?{code:'DOUBAO_QUOTA_EXHAUSTED',message:ownText.slice(0,2000),definitive:true}:null;
  const pendingMedia=activatedPlayers>0||answers.some(m=>m.media?.length||m.e?.querySelector(arg.kind==='video'?'video,[class*="video-player-wrapper"]':'img'));
  const notice=arg.kind!=='text'&&completed&&!waiting&&!stopping&&!confirmation&&!artifacts.length&&!pendingMedia&&!failure&&!generationNotStarted&&!humanQuestion&&!gate&&ownText.trim()&&!/生成(?:完成|成功)|(?:已|已经)(?:为[你您])?生成|(?:图片|图像|视频)(?:已|已经)生成/.test(ownText)?ownText.slice(0,2000):'';
  return {gate:gate||(!rejected&&humanQuestion)||(limited||rejected?'quota_or_rate_limit':null),ack:true,generationState,url:location.href,userId:first.id||String(first.index),answer,providerMessage:ownText.slice(0,2000),artifacts,pendingMedia,...(mediaActivations.length?{mediaActivations}:{}),confirmation,confirmationAcknowledgements:manualMatched?[]:confirmationAcknowledgements,waiting,stopping,completed,...(notice?{notice}:{}),...(failure?{failure}:{}),...(manualTrace?{manualTrace}:{}),...(historyRecovery?{historyRecovery}:{}),...(ignoredReferenceReplies?{ignoredReferenceReplies}:{}),...(generationNotStarted?{generationNotStarted:{reason:'reference_or_prompt_only'}}:{}),...(rejected&&!gate?{quota:{exhausted:true,rejected:true,kind:arg.kind}}:{})};
 }
 return {error:'未知网页操作'};
}
