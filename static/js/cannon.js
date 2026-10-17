/* Canon du logo : recul, flash, fumée, boulet en cloche, impact sur la sphère, toast. */

const MESSAGES = [
  'Feu !',
  'Touché.',
  'Pas mal, pour un humain.',
  "Encore ? T'as que ça à faire ?",
  'Doucement, le canon chauffe.',
  'Les Gunners ne comptent pas leurs boulets.',
];

const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createToast(element) {
  let animation = null;
  return (text) => {
    element.textContent = text;
    animation?.cancel();
    animation = element.animate(
      [
        { opacity: 0, transform: 'translate(-50%, -8px)' },
        { opacity: 1, transform: 'translate(-50%, 0)', offset: 0.12 },
        { opacity: 1, transform: 'translate(-50%, 0)', offset: 0.8 },
        { opacity: 0, transform: 'translate(-50%, 0)' },
      ],
      { duration: 2200, fill: 'forwards' },
    );
  };
}

function spawn(layer, className, x, y) {
  const node = document.createElement('div');
  node.className = className;
  node.style.left = `${x}px`;
  node.style.top = `${y}px`;
  layer.append(node);
  return node;
}

export function createCannon({ layer, orb, orbWrap, toast, onFire }) {
  let count = 0;

  return function fire(button) {
    count += 1;
    onFire(count);
    toast(MESSAGES[Math.min(count, MESSAGES.length) - 1]);
    if (prefersReducedMotion()) return;

    button.querySelector('img')?.animate(
      [
        { transform: 'scale(1.3) translateX(0)' },
        { transform: 'scale(1.2) translateX(-4px)', offset: 0.3 },
        { transform: 'scale(1.3) translateX(0)' },
      ],
      { duration: 300, easing: 'ease-out' },
    );

    const b = button.getBoundingClientRect();
    const from = { x: b.left + b.width * 0.95, y: b.top + b.height * 0.38 };
    const o = orb.getBoundingClientRect();
    const to = o.width
      ? { x: o.left + o.width / 2, y: o.top + o.height / 2 }
      : { x: window.innerWidth * 0.7, y: window.innerHeight * 0.45 };
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const duration = Math.max(900, Math.min(1400, 600 + Math.hypot(dx, dy) * 0.6));
    const apex = Math.min(60, Math.max(8, from.y - 16));
    const nodes = [];
    const add = (className, x, y) => { const n = spawn(layer, className, x, y); nodes.push(n); return n; };

    add('fx-flash', from.x - 18, from.y - 18)
      .animate([{ transform: 'scale(.3)', opacity: 1 }, { transform: 'scale(1.8)', opacity: 0 }], { duration: 350, easing: 'ease-out', fill: 'forwards' });
    add('fx-smoke', from.x - 10, from.y - 10)
      .animate([{ transform: 'translate(0,0) scale(.4)', opacity: 0.7 }, { transform: 'translate(14px,-22px) scale(2.2)', opacity: 0 }], { duration: 900, easing: 'ease-out', fill: 'forwards' });
    add('fx-smoke small', from.x - 7, from.y - 7)
      .animate([{ transform: 'translate(0,0) scale(.4)', opacity: 0.6 }, { transform: 'translate(14px,-22px) scale(2.2)', opacity: 0 }], { duration: 900, delay: 80, easing: 'ease-out', fill: 'forwards' });

    const ballX = add('fx-ball-x', from.x - 8, from.y - 8);
    const ball = document.createElement('div');
    ball.className = 'fx-ball';
    ballX.append(ball);
    ballX.animate(
      [
        { transform: 'translateX(0)', opacity: 1 },
        { transform: `translateX(${dx * 0.96}px)`, opacity: 1, offset: 0.96 },
        { transform: `translateX(${dx}px)`, opacity: 0 },
      ],
      { duration, easing: 'linear', fill: 'forwards' },
    );
    ball.animate(
      [
        { transform: 'translateY(0) scale(1)', easing: 'cubic-bezier(.25,.46,.45,.94)' },
        { transform: `translateY(${-apex}px) scale(1.05)`, offset: 0.3, easing: 'cubic-bezier(.55,.085,.68,.53)' },
        { transform: `translateY(${dy}px) scale(.7)` },
      ],
      { duration, fill: 'forwards' },
    );

    add('fx-impact', to.x - 38, to.y - 38)
      .animate([{ transform: 'scale(.3)', opacity: 1 }, { transform: 'scale(1.7)', opacity: 0 }], { duration: 550, delay: duration - 50, easing: 'ease-out', fill: 'forwards' });
    orbWrap.animate(
      [{ transform: 'scale(1)' }, { transform: 'scale(1.04)', offset: 0.3 }, { transform: 'scale(.99)', offset: 0.65 }, { transform: 'scale(1)' }],
      { duration: 450, delay: duration - 50, easing: 'ease-out' },
    );

    setTimeout(() => nodes.forEach((n) => n.remove()), duration + 1200);
  };
}
