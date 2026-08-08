// CSS animation triggers — all animations are defined in styles.css

const Animations = {

  // Correct number placed — pop scale
  cellCorrect(row, col) {
    const cell = UI.getCell(row, col);
    if (!cell) return;
    cell.classList.remove('anim-correct');
    void cell.offsetWidth; // force reflow
    cell.classList.add('anim-correct');
    cell.addEventListener('animationend', () => cell.classList.remove('anim-correct'), { once: true });
  },

  // Mistake — red flash + shake
  cellMistake(row, col) {
    const cell = UI.getCell(row, col);
    if (!cell) return;
    cell.classList.remove('anim-mistake');
    void cell.offsetWidth;
    cell.classList.add('anim-mistake');
    cell.addEventListener('animationend', () => cell.classList.remove('anim-mistake'), { once: true });
  },

  // Hint reveal — fade-in blue
  cellHint(row, col) {
    const cell = UI.getCell(row, col);
    if (!cell) return;
    cell.classList.remove('anim-hint');
    void cell.offsetWidth;
    cell.classList.add('anim-hint');
    cell.addEventListener('animationend', () => cell.classList.remove('anim-hint'), { once: true });
  },

  // Row completion glow sweep
  rowComplete(rowIndex) {
    for (let c = 0; c < 9; c++) {
      const cell = UI.getCell(rowIndex, c);
      if (cell) {
        setTimeout(() => {
          cell.classList.add('anim-row-glow');
          cell.addEventListener('animationend', () => cell.classList.remove('anim-row-glow'), { once: true });
        }, c * 40);
      }
    }
  },

  // Column completion glow sweep
  colComplete(colIndex) {
    for (let r = 0; r < 9; r++) {
      const cell = UI.getCell(r, colIndex);
      if (cell) {
        setTimeout(() => {
          cell.classList.add('anim-col-glow');
          cell.addEventListener('animationend', () => cell.classList.remove('anim-col-glow'), { once: true });
        }, r * 40);
      }
    }
  },

  // Box completion pulse
  boxComplete(boxRow, boxCol) {
    for (let r = boxRow; r < boxRow + 3; r++) {
      for (let c = boxCol; c < boxCol + 3; c++) {
        const cell = UI.getCell(r, c);
        if (cell) {
          cell.classList.add('anim-box-pulse');
          cell.addEventListener('animationend', () => cell.classList.remove('anim-box-pulse'), { once: true });
        }
      }
    }
  },

  // Floating cost text (e.g. "-50") near score display
  floatingText(text, color = '#ef4444') {
    const el = document.createElement('div');
    el.className = 'floating-text';
    el.textContent = text;
    el.style.color = color;

    const scoreEl = document.getElementById('score-display');
    if (!scoreEl) return;
    const rect = scoreEl.getBoundingClientRect();
    el.style.left = `${rect.left + rect.width / 2}px`;
    el.style.top  = `${rect.top}px`;

    document.body.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  },

  // Mistake counter bump
  mistakeCounterBump() {
    const el = document.getElementById('mistake-counter');
    if (!el) return;
    el.classList.remove('anim-counter-bump');
    void el.offsetWidth;
    el.classList.add('anim-counter-bump');
    el.addEventListener('animationend', () => el.classList.remove('anim-counter-bump'), { once: true });
  },

  // Timer pulse when penalty applied
  timerPulse() {
    const el = document.getElementById('timer-display');
    if (!el) return;
    el.classList.remove('anim-timer-pulse');
    void el.offsetWidth;
    el.classList.add('anim-timer-pulse');
    el.addEventListener('animationend', () => el.classList.remove('anim-timer-pulse'), { once: true });
  },

  // Confetti on puzzle complete
  confetti() {
    const canvas = document.getElementById('confetti-canvas');
    if (!canvas) return;
    canvas.style.display = 'block';

    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const pieces = Array.from({ length: 120 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * -canvas.height,
      w: 8 + Math.random() * 8,
      h: 4 + Math.random() * 4,
      color: ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6'][Math.floor(Math.random() * 5)],
      vx: (Math.random() - 0.5) * 3,
      vy: 2 + Math.random() * 4,
      rot: Math.random() * 360,
      rotV: (Math.random() - 0.5) * 6,
    }));

    let frame = 0;
    const MAX_FRAMES = 180;

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      pieces.forEach(p => {
        p.x  += p.vx;
        p.y  += p.vy;
        p.rot += p.rotV;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot * Math.PI / 180);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      });
      frame++;
      if (frame < MAX_FRAMES) {
        requestAnimationFrame(draw);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvas.style.display = 'none';
      }
    };
    requestAnimationFrame(draw);
  },
};
