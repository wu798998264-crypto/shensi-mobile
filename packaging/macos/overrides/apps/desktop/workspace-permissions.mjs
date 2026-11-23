export function installWorkspacePermissions(session,origin){
 const sameOrigin=url=>{try{return new URL(url).origin===origin;}catch{return false;}};
 const trusted=(contents,url)=>!!contents&&!contents.isDestroyed()&&sameOrigin(contents.getURL())&&(!url||sameOrigin(url));
 const regular=permission=>['fullscreen','clipboard-sanitized-write'].includes(permission);
 session.setPermissionCheckHandler((contents,permission,requestingOrigin,details)=>trusted(contents,details?.requestingUrl||requestingOrigin)&&(regular(permission)||permission==='media'&&details?.mediaType==='audio'));
 session.setPermissionRequestHandler((contents,permission,callback,details)=>callback(trusted(contents,details?.requestingUrl)&&(regular(permission)||permission==='media'&&details?.mediaTypes?.length===1&&details.mediaTypes[0]==='audio')));
}
