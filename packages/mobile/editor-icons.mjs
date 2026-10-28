// One soft, rounded icon language for the native entry and the approved preview.
const editorPaths={
 undo:'M9 5 4 10l5 5M4 10h10a6 6 0 0 1 0 12',redo:'m15 5 5 5-5 5m5-5H10a6 6 0 0 0 0 12',
 heading:'M5 5v14M19 5v14M5 12h14',bold:'M7 4h6a4 4 0 0 1 0 8H7V4m0 8h7a4 4 0 0 1 0 8H7v-8',
 italic:'M10 4h9M5 20h9M15 4 9 20',strike:'M17 6c-1-3-10-3-10 2 0 2 2 3 5 4m5 3c2 7-10 7-11 3M3 12h18',
 list:'M9 6h12M9 12h12M9 18h12M3 6h.1M3 12h.1M3 18h.1',task:'M9 5h11M9 12h11M9 19h11M2 5l2 2 3-4M2 12h3M2 19h3',
 quote:'M4 6h6v7H5c0 3 2 4 4 4M14 6h6v7h-5c0 3 2 4 4 4',link:'M10 14l4-4M8 16l-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 12a4 4 0 0 0 6 0l5-5a4 4 0 0 0-6-6l-1 1',
 code:'m7 7-5 5 5 5m10-10 5 5-5 5m-4-14-2 22',
 clear:'M4 4h14M11 4 8 15m9-5 5 5-6 6h-5l-3-3 9-8m-5 4 6 6M3 21h5'
};
export const mobileEditorTools=[['undo','撤销'],['redo','重做'],['heading','标题'],['bold','加粗'],['italic','斜体'],['strike','删除线'],['list','列表'],['task','待办'],['quote','引用'],['link','链接'],['code','代码'],['clear','清除格式']];
export function editorIcon(id){return `<svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${editorPaths[id]||editorPaths.clear}"/></svg>`;}
