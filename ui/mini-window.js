(() => {
  const api = window.mtAigis;
  if (!api) return;
  const eye = document.getElementById('mini-reveal');
  const slider = document.getElementById('mini-opacity');
  const output = document.getElementById('mini-opacity-value');
  let opacityFrame = 0;
  let draggingOpacity = false;
  let miniState = null;
  let receivedMode = false;

  const image = api.getRevealIcon();
  if (image) {
    const symbol = eye.querySelector('.titlebar-symbol');
    symbol.textContent = '';
    symbol.style.maskImage = `url("${image}")`;
    symbol.classList.add('has-image');
  }

  const update = (changes) => api.invoke('window:mini:controls', changes).catch(() => null);
  function applyMode(state) {
    miniState = state;
    document.body.classList.toggle('mini-window-page', !!state);
    if (opacityFrame) cancelAnimationFrame(opacityFrame);
    opacityFrame = 0;
    draggingOpacity = false;
    eye.disabled = !state;
    if (!state) return;
    slider.value = state.opacity;
    output.value = state.opacity + '%';
    eye.setAttribute('aria-pressed', String(state.revealOnHover));
  }
  api.on('window:mini:state', (state) => {
    receivedMode = true;
    applyMode(state);
  });
  update().then((state) => {
    if (!receivedMode) applyMode(state);
  });
  eye.addEventListener('click', async () => {
    if (!miniState) return;
    const modeAtClick = miniState;
    eye.disabled = true;
    const next = eye.getAttribute('aria-pressed') !== 'true';
    const state = await update({ revealOnHover: next });
    if (miniState !== modeAtClick) return;
    if (state) eye.setAttribute('aria-pressed', String(state.revealOnHover));
    eye.disabled = false;
  });
  slider.addEventListener('input', () => {
    if (!miniState) return;
    output.value = slider.value + '%';
    if (opacityFrame) return;
    opacityFrame = requestAnimationFrame(() => {
      opacityFrame = 0;
      update({ opacity: slider.valueAsNumber });
    });
  });
  slider.addEventListener('pointerdown', (event) => {
    if (!miniState || event.button !== 0) return;
    slider.setPointerCapture(event.pointerId);
    draggingOpacity = true;
    update({ draggingOpacity: true });
  });
  function finishDrag() {
    if (!draggingOpacity) return;
    draggingOpacity = false;
    update({ draggingOpacity: false });
  }
  window.addEventListener('pointerup', finishDrag);
  window.addEventListener('pointercancel', finishDrag);
  window.addEventListener('blur', () => {
    finishDrag();
    eye.blur();
  });
  slider.addEventListener('lostpointercapture', finishDrag);
})();
