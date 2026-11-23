(() => {
  const api = window.mtAigisMini;
  if (!api) return;
  const eye = document.getElementById('mini-reveal');
  const slider = document.getElementById('mini-opacity');
  const output = document.getElementById('mini-opacity-value');
  let opacityFrame = 0;
  let draggingOpacity = false;

  const image = api.getRevealIcon();
  if (image) {
    const symbol = eye.querySelector('.titlebar-symbol');
    symbol.textContent = '';
    symbol.style.maskImage = `url("${image}")`;
    symbol.classList.add('has-image');
  }

  const update = (changes) => api.controls(changes).catch(() => null);
  function applyInitialState(state) {
    if (!state) return;
    slider.value = state.opacity;
    output.value = state.opacity + '%';
    eye.setAttribute('aria-pressed', String(state.revealOnHover));
    eye.disabled = false;
  }
  api.onState(applyInitialState);
  update().then(applyInitialState);
  eye.addEventListener('click', async () => {
    eye.disabled = true;
    const next = eye.getAttribute('aria-pressed') !== 'true';
    const state = await update({ revealOnHover: next });
    if (state) eye.setAttribute('aria-pressed', String(state.revealOnHover));
    eye.disabled = false;
  });
  slider.addEventListener('input', () => {
    output.value = slider.value + '%';
    if (opacityFrame) return;
    opacityFrame = requestAnimationFrame(() => {
      opacityFrame = 0;
      update({ opacity: slider.valueAsNumber });
    });
  });
  slider.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
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
  window.addEventListener('blur', finishDrag);
  slider.addEventListener('lostpointercapture', finishDrag);
})();
