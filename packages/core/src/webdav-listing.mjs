const decodeXml=value=>String(value||'').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
export function parseWebDavMultiStatus(xml,{onEtag}={}){
 const source=String(xml||'');if(/<!DOCTYPE|<!ENTITY/i.test(source))throw Object.assign(Error('WebDAV XML 包含不允许的实体声明'),{code:'WEBDAV_UNSAFE_XML'});
 const responses=[];
 for(const match of source.matchAll(/<(?:[A-Za-z0-9_-]+:)?response\b[^>]*>([\s\S]*?)<\/(?:[A-Za-z0-9_-]+:)?response>/gi)){
  const block=match[1],pick=name=>decodeXml(block.match(new RegExp(`<(?:[A-Za-z0-9_-]+:)?${name}\\b[^>]*>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_-]+:)?${name}>`,'i'))?.[1]?.trim()||'');
  onEtag?.(pick('href'),pick('getetag'));
  responses.push({href:decodeURIComponent(pick('href')),etag:pick('getetag').replace(/^"|"$/g,''),size:Number(pick('getcontentlength')||0),contentType:pick('getcontenttype'),modifiedAt:pick('getlastmodified'),collection:/<(?:[A-Za-z0-9_-]+:)?collection\b/i.test(block),status:pick('status')});
 }return responses;
}
