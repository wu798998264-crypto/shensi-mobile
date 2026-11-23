const h=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function visibleDirectoryFolders(state){
 const folders=state.coreFolders||[];
 if(state.coreWork?.enabled)return folders;
 const automaticRoles=new Set(['manuscript','volume','outline','setting','memory','library']),byId=new Map(folders.map(f=>[f.id,f])),keep=new Set();
 const retain=id=>{const seen=new Set();let folder=byId.get(id);while(folder&&!seen.has(folder.id)){seen.add(folder.id);keep.add(folder.id);folder=byId.get(folder.parentId);}};
 // Empty automatic work sections disappear after leaving work mode. Their
 // identities remain in state so re-enabling the mode preserves the layout.
 for(const folder of folders)if(!automaticRoles.has(folder.workRole))retain(folder.id);
 for(const doc of Object.values(state.documents||{}))retain(doc.coreFolderId);
 return folders.filter(folder=>!automaticRoles.has(folder.workRole)||keep.has(folder.id));
}
export function folderSegments(folders,id){
 const result=[],seen=new Set();let folder=folders.find(f=>f.id===id);
 while(folder&&!seen.has(folder.id)){seen.add(folder.id);result.unshift({id:folder.id,name:folder.name});folder=folders.find(f=>f.id===folder.parentId);}
 return result;
}
export function folderOptions(folders,{selected='',exclude=new Set(),root='笔记本根目录'}={}){
 const rows=folders.filter(f=>!exclude.has(f.id)).map(f=>({folder:f,path:folderSegments(folders,f.id)})).sort((a,b)=>a.path.map(p=>p.name).join('/').localeCompare(b.path.map(p=>p.name).join('/'),'zh-CN'));
 return `<option value="">${h(root)}</option>`+rows.map(({folder,path})=>`<option value="${h(folder.id)}" ${folder.id===selected?'selected':''}>${'　'.repeat(Math.max(0,path.length-1))}${h(path.map(p=>p.name).join(' / '))}</option>`).join('');
}
