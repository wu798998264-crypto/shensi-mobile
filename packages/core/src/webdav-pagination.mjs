// Nutstore's Link pagination is limited to the same collection. Credentials
// must never follow a next link to another host, resource or URL userinfo.
export function nextWebDavPage(header,currentUrl,collectionUrl){
 const links=String(header||'').match(/<[^>]+>[^,]*/g)||[];
 const next=links.filter(link=>/(?:^|;)\s*rel\s*=\s*(?:"[^"]*\bnext\b[^"]*"|next)(?:\s*;|\s*$)/i.test(link));
 if(!next.length)return null;
 const fail=()=>Object.assign(Error('坚果云目录分页地址无效，已停止同步，原资料保留'),{code:'WEBDAV_UNSAFE_PAGINATION'});
 if(next.length!==1)throw fail();
 let url,base;
 try{url=new URL(next[0].match(/^<([^>]+)>/)[1],currentUrl);base=new URL(collectionUrl);}catch{throw fail();}
 if(url.origin!==base.origin||url.protocol!=='https:'||url.username||url.password||url.hash)throw fail();
 const path=value=>decodeURIComponent(value.pathname).normalize('NFC').replace(/\/$/,'');
 try{if(path(url)!==path(base))throw fail();}catch{throw fail();}
 return url;
}
