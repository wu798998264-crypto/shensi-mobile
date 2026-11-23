export function installWorkspacePermissions(session,origin){
 const sameOrigin=url=>{try{return new URL(url).origin===origin;}catch{return false;}};
 const allowed=(contents,permission,requestingUrl)=>['fullscreen','clipboard-sanitized-write'].includes(permission)&&!!contents&&!contents.isDestroyed()&&sameOrigin(contents.getURL())&&(!requestingUrl||sameOrigin(requestingUrl));
 session.setPermissionCheckHandler((contents,permission,requestingOrigin,details)=>allowed(contents,permission,details?.requestingUrl||requestingOrigin));
 session.setPermissionRequestHandler((contents,permission,callback,details)=>callback(allowed(contents,permission,details?.requestingUrl)));
}
