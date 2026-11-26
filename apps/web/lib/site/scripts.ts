/** Inline <head> script (server-safe string, not a client module): applies "Pause all motion" before paint. Pair with the theme script. */
export const motionScript = `try{if(localStorage.getItem('bf-motion')==='1')document.documentElement.dataset.motion='reduce'}catch(e){}`;
