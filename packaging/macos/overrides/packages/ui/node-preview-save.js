import {captureNodeVersion} from './canvas-model.js';

export async function savePreviewDraft(context,nodeId,draftKey){
 const draft=context.drafts()[draftKey];if(!draft)return;
 const node=()=>context.document().canvas.nodes.find(n=>n.id===nodeId);
 const expected=draft.appliedContent||{text:draft.baseText,name:draft.baseName};
 const unchanged=()=>{const current=node();return current&&(current.text||'')===expected.text&&(current.name||'')===expected.name;};
 if(!unchanged())throw Error('卡片已有其他修改，编辑草稿已保留');
 const target=node();context.undo();if(target.text!==draft.text)captureNodeVersion(context.document().canvas,nodeId,{source:'preview-edit'});target.text=draft.text;target.name=draft.name;delete target.coreSelectedVersionId;
 // Preserve the exact content we applied so a failed save/history can be retried.
 context.drafts()[draftKey]={...draft,appliedContent:{text:target.text,name:target.name}};
 context.changed();if(!(await context.flush()))throw Error('保存未完成，草稿已保留');
 const retained=context.drafts()[draftKey];
 if(retained?.text!==draft.text||retained?.name!==draft.name)throw Error('保存期间内容已更新，新草稿已保留，请再次保存');
 delete context.drafts()[draftKey];context.changed();
 if(!(await context.flush())){context.drafts()[draftKey]??=retained;context.changed();throw Error('保存未完成，草稿已保留');}
 if(context.drafts()[draftKey])throw Error('保存期间内容已更新，新草稿已保留，请再次保存');
}
