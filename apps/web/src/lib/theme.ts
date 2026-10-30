// Light or dark (the owner's design, 30 October 2026): the look picked in this browser is kept under THEME_KEY;
// THEME_SCRIPT, run before the page paints (app/layout.tsx), puts it on <html data-theme>. Without one the computer's
// setting decides (globals.css, prefers-color-scheme). The switch: components/theme-switch.tsx.

export const THEME_KEY = 'ps-theme';

export const THEME_SCRIPT = `try{var t=localStorage.getItem('${THEME_KEY}');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}`;
