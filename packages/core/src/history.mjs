import {stampHistoryEntryIntegrity, verifyHistoryEntryIntegrity} from '../legacy/version-integrity.js';
// The same history implementation runs in Node 24 and the native mobile WebView.
// Require secure UUID support; never silently downgrade history identities.
const randomUUID=()=>globalThis.crypto.randomUUID();

// The current document and an explicit historical checkpoint have separate lifetimes.
export function snapshotDocument(document) {
  const copy=structuredClone(document);
  delete copy.contentRef; delete copy.savedAt; delete copy.sourcePath;
  if(typeof copy.html!=='string'&&copy.coreRichText?.html!==undefined)copy.html=copy.coreRichText.html;
  delete copy.coreRichText;
  delete copy.coreFolderId;delete copy.customFolderId;delete copy.customFolderPath;
  if(copy.canvas)delete copy.canvas.viewport;
  return copy;
}
const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export function checkpoint(state,documentId,{source='user',operationType='snapshot',reason='手动保存历史版本',beforeContent}={}) {
  const document=state.documents[documentId];
  if(!document)throw Error('文档不存在');
  const snapshot=snapshotDocument(document),signature=stable(snapshot);
  const entries=state.histories[documentId]??=[];
  // Compare against the latest checkpoint. Returning to an older text is still
  // a new revision when a different version was saved in between.
  const latest=entries[0];
  const existing=latest?.document&&stable(snapshotDocument(latest.document))===signature&&(!latest.integritySchemaVersion||verifyHistoryEntryIntegrity(latest).ok)?latest:null;
  if(existing)return {versionId:existing.id,created:false,promoted:false};
  const time=new Date().toISOString();
  const entry=stampHistoryEntryIntegrity({id:'core-history-'+randomUUID(),title:document.title,name:reason,time,createdAt:time,document:snapshot,scopeType:'document',scopeId:documentId,...(beforeContent===undefined?{}:{beforeContent})},{source,operationType,reason,parentVersionId:entries[0]?.id||''});
  entries.unshift(entry);
  return {versionId:entry.id,created:true,promoted:false};
}
export function assertVersion(entry){if(entry?.integritySchemaVersion&&!verifyHistoryEntryIntegrity(entry).ok)throw Error('历史版本校验失败，已阻止采用');}
