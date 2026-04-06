// Minimal avatar shim to satisfy imports and provide setSpeaking API
(function(){
  try {
    const obj: { setSpeaking: (s: boolean) => void } = {
      setSpeaking: function(s: boolean){
        // noop - could toggle CSS/animation via avatar-ui in future
        try {
          const img = document.getElementById('a11-avatar');
          if (img && img.dataset && img.dataset.anim) {
            if (s) img.classList.add('speaking'); else img.classList.remove('speaking');
          }
        } catch(e){}
      }
    };
    (globalThis as any).A11Avatar = obj;
  } catch(e){}
})();
