// Exact soft icon geometry from the approved MOBILE / 07 preview; no demo state.
const softIcons={
 panel:'<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M9 3v18 M14 9l3 3-3 3"/>',
 search:'<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>',
 new:'<path d="M11.35 22H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.706.706l3.588 3.588A2.4 2.4 0 0 1 20 8v5.35 M14 2v5a1 1 0 0 0 1 1h5 M14 19h6 M17 16v6"/>',
 tabs:'<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18 M9 21V9"/>',
 doc:'<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z M14 2v5a1 1 0 0 0 1 1h5 M10 9H8 M16 13H8 M16 17H8"/>',
 edit:'<path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7 M18.375 2.625a1 1 0 0 1 3 3l-9.013 9.014a2 2 0 0 1-.853.505l-2.873.84a.5.5 0 0 1-.62-.62l.84-2.873a2 2 0 0 1 .506-.852z"/>',
 read:'<path d="M12 7v14 M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
 more:'<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
 settings:'<path d="M9.671 4.136a2.34 2.34 0 0 1 4.659 0 2.34 2.34 0 0 0 3.319 1.915 2.34 2.34 0 0 1 2.33 4.033 2.34 2.34 0 0 0 0 3.831 2.34 2.34 0 0 1-2.33 4.033 2.34 2.34 0 0 0-3.319 1.915 2.34 2.34 0 0 1-4.659 0 2.34 2.34 0 0 0-3.32-1.915 2.34 2.34 0 0 1-2.33-4.033 2.34 2.34 0 0 0 0-3.831A2.34 2.34 0 0 1 6.35 6.051a2.34 2.34 0 0 0 3.319-1.915"/><circle cx="12" cy="12" r="3"/>',
 chat:'<path d="M16 10a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 14.286V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z M20 9a2 2 0 0 1 2 2v10.286a.71.71 0 0 1-1.212.502l-2.202-2.202A2 2 0 0 0 17.172 19H10a2 2 0 0 1-2-2v-1"/>',
 cloud:'<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
 folder:'<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
 download:'<path d="M12 15V3 M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 m4-5 5 5 5-5"/>',
 trash:'<path d="M10 11v6 M14 11v6 M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6 M3 6h18 M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
 lock:'<circle cx="12" cy="16" r="1"/><rect x="3" y="10" width="18" height="12" rx="2"/><path d="M7 10V7a5 5 0 0 1 10 0v3"/>',
 unlock:'<circle cx="12" cy="16" r="1"/><rect x="3" y="10" width="18" height="12" rx="2"/><path d="M7 10V7a5 5 0 0 1 9.33-2.5"/>',
 upload:'<path d="M12 3v12 m5-7-5-5-5 5 M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>',
 expand:'<path d="m17 11-5-5-5 5 m10 7-5-5-5 5"/>',collapse:'<path d="m7 6 5 5 5-5 M7 13l5 5 5-5"/>',
 star:'<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>'
};
Object.assign(softIcons,{
 arrow:'<path d="M12 19V5 m-6 6 6-6 6 6"/>',down:'<path d="m6 9 6 6 6-6"/>',right:'<path d="m9 6 6 6-6 6"/>',
 check:'<path d="m9 12 2 2 4-4"/><circle cx="12" cy="12" r="9"/>',tick:'<path d="m5 12 4 4L19 6"/>',
 history:'<path d="M3 12a9 9 0 1 0 2.6-6.4L3 8 M3 3v5h5 M12 7v5l3 2"/>',clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
 link:'<path d="M10 13a5 5 0 0 0 7 .4l3-3a5 5 0 0 0-7-7l-1.7 1.7 M14 11a5 5 0 0 0-7-.4l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
 outline:'<path d="M4 3v14a2 2 0 0 0 2 2h3 M4 5h5 M4 12h5 M13 5h7 M13 12h7 M13 19h7"/>',
 sparkles:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z M3 2v4 M1 4h4 M21 18v4 M19 20h4"/>',
 user:'<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
 language:'<path d="M2 5h12 M7 2v3 M11 5a15 15 0 0 1-8 10 M4 9a15 15 0 0 0 7 6 M14 21l4-10 4 10 M16 17h4"/>',
 sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2 M12 20v2 M2 12h2 M20 12h2 m-3.1-7.1 1.4-1.4 M5.7 18.3l1.4-1.4 M5.7 5.7l1.4 1.4 M16.9 16.9l1.4 1.4"/>',
 moon:'<path d="M20.7 13.1A9 9 0 0 1 10.9 3.3a9 9 0 1 0 9.8 9.8Z"/>',
 monitor:'<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M12 17v4 M8 21h8"/>',
 blocks:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
 puzzle:'<path d="M19 13h-1.5a2.5 2.5 0 1 0 0 5H19v2a1 1 0 0 1-1 1h-5v-1.5a2.5 2.5 0 1 0-5 0V21H4a1 1 0 0 1-1-1v-5h1.5a2.5 2.5 0 1 0 0-5H3V6a1 1 0 0 1 1-1h5V3.5a2.5 2.5 0 1 1 5 0V5h4a1 1 0 0 1 1 1Z"/>',
 sliders:'<path d="M3 6h4 M11 6h10 M3 12h10 M17 12h4 M3 18h2 M9 18h12"/><circle cx="9" cy="6" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="7" cy="18" r="2"/>',
 refresh:'<path d="M3 10a9 9 0 0 1 15-6l3 3 M21 3v4h-4 M21 14a9 9 0 0 1-15 6l-3-3 M3 21v-4h4"/>',
 logout:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M9 12h12 m-4-4 4 4-4 4"/>',
 folderOpen:'<path d="M3 8V5a2 2 0 0 1 2-2h4l2 3h8a2 2 0 0 1 2 2 M4 21h14a2 2 0 0 0 2-1.5l2-8a1 1 0 0 0-1-1.5H6a2 2 0 0 0-2 1.5l-2 7A2 2 0 0 0 4 21Z"/>',
 board:'<rect x="3" y="3" width="18" height="15" rx="2"/><path d="M8 22l4-4 4 4 M8 8h8 M8 12h5"/>',headphones:'<path d="M3 14v-3a9 9 0 0 1 18 0v3"/><rect x="3" y="12" width="4" height="8" rx="2"/><rect x="17" y="12" width="4" height="8" rx="2"/>'
});
// The approved set keeps close in its simple-path fallback map.
softIcons.close='<path d="M6 6l12 12 M18 6 6 18"/>';
softIcons.back='<path d="m14 6-6 6 6 6 M8 12h13"/>';
softIcons.starFilled=softIcons.star.replace('<path ', '<path fill="currentColor" ');
export const mobileShellIcon=key=>`<svg viewBox="0 0 24 24" aria-hidden="true" data-mobile-icon="${key}">${softIcons[key]||softIcons.doc}</svg>`;

