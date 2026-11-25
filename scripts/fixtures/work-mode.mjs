export const bookUrl='https://quanben-xiaoshuo.com/n/shensi-synthetic/';
export const chapterTexts=['合成章节甲，晨光照进空无一人的车站。'.repeat(12),'合成章节乙，旅人沿着河流寻找归途。'.repeat(12)];
export function bookNetwork({failChapter=false}={}){return {
 lookupImpl:async()=>[{address:'93.184.216.34',family:4}],dispatcherFactory:()=>({}),
 fetchImpl:async input=>{const url=new URL(input);let html,contentType='text/html; charset=utf-8';
  if(url.searchParams.get('a')==='search.json'){contentType='application/javascript';html='search('+JSON.stringify({content:'<div class="book"><a href="'+bookUrl+'">合成小说</a><span itemprop="author">合成作者</span><div class="description">专用于离线验收</div></div>'})+');';}
  else if(url.pathname.endsWith('xiaoshuo.html'))html='<h1>合成小说</h1><p>作者：合成作者</p>'+chapterTexts.map((_,i)=>'<a href="'+bookUrl+(i+1)+'.html">第'+(i+1)+'章 合成章节</a>').join('');
  else if(/\/[12]\.html$/.test(url.pathname)){if(failChapter&&url.pathname.endsWith('2.html'))return new Response('offline fixture failed',{status:503});const index=Number(url.pathname.match(/([12])\.html$/)[1])-1;html='<h1>第'+(index+1)+'章 合成章节</h1><div id="content">'+chapterTexts[index]+'</div>';}
  else html='<h1>合成小说搜索</h1>';return new Response(html,{headers:{'Content-Type':contentType}});
 }
};}
