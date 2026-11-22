/* ==========================================================================
   ORION — GSAP Animations, Interactions & PWA Handler
   Style: Claude Code — vivantes, fluides, dynamiques
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  initSpaceCanvas();
  initPWA();
  initNavigation();
  initRoadmapFilters();
  initBackToTop();

  // GSAP doit être chargé à ce stade
  if (typeof gsap !== 'undefined') {
    gsap.registerPlugin(ScrollTrigger);
    runEntryAnimations();
    runScrollAnimations();
    runAmbientAnimations();
    initMagneticButtons();
    initTiltCards();
    initTextSplitReveals();
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   1.  CANVAS — Champ d'étoiles interactif avec cursor parallax
   ═══════════════════════════════════════════════════════════════════════════*/
function initSpaceCanvas() {
  const canvas = document.getElementById('space-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let W, H;
  let mouseX = 0.5, mouseY = 0.5;

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX / W;
    mouseY = e.clientY / H;
  });

  const COUNT = Math.min(Math.floor((innerWidth * innerHeight) / 6000), 300);
  const stars = Array.from({ length: COUNT }, () => ({
    x: Math.random(), y: Math.random(),
    r: Math.random() * 1.6 + 0.4,
    a: Math.random() * 0.7 + 0.15,
    speed: Math.random() * 0.0003 + 0.00005,
    phase: Math.random() * Math.PI * 2,
    depth: Math.random() * 0.6 + 0.4
  }));

  // Shooting star
  let shootingStar = null;
  function maybeShoot() {
    if (Math.random() < 0.003 && !shootingStar) {
      shootingStar = {
        x: Math.random() * 0.5, y: Math.random() * 0.3,
        angle: Math.PI * 0.2 + Math.random() * 0.2,
        speed: 0.012 + Math.random() * 0.008,
        life: 1.0, len: 60 + Math.random() * 60
      };
    }
  }

  let t = 0;
  (function loop() {
    t += 0.016;
    ctx.clearRect(0, 0, W, H);
    const mx = (mouseX - 0.5) * 15;
    const my = (mouseY - 0.5) * 15;

    for (const s of stars) {
      const flicker = Math.sin(t * 2 + s.phase) * 0.25;
      const px = (s.x * W + mx * s.depth) % W;
      const py = ((s.y + s.speed * t * 100) * H + my * s.depth) % H;
      ctx.beginPath();
      ctx.arc(px < 0 ? px + W : px, py < 0 ? py + H : py, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(190, 170, 240, ${Math.max(0, s.a + flicker)})`;
      ctx.fill();
    }

    // Shooting star
    maybeShoot();
    if (shootingStar) {
      const ss = shootingStar;
      ss.x += Math.cos(ss.angle) * ss.speed;
      ss.y += Math.sin(ss.angle) * ss.speed;
      ss.life -= 0.025;
      const sx = ss.x * W, sy = ss.y * H;
      const ex = sx - Math.cos(ss.angle) * ss.len;
      const ey = sy - Math.sin(ss.angle) * ss.len;
      const grad = ctx.createLinearGradient(sx, sy, ex, ey);
      grad.addColorStop(0, `rgba(177, 92, 240, ${ss.life})`);
      grad.addColorStop(1, 'rgba(177, 92, 240, 0)');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
      if (ss.life <= 0 || ss.x > 1.2 || ss.y > 1.2) shootingStar = null;
    }

    requestAnimationFrame(loop);
  })();
}

/* ═══════════════════════════════════════════════════════════════════════════
   2.  ENTRY ANIMATIONS — Hero cinématique
   ═══════════════════════════════════════════════════════════════════════════*/
function runEntryAnimations() {
  gsap.set('body', { overflow: 'hidden' });

  const master = gsap.timeline({
    defaults: { ease: 'expo.out' },
    onComplete: () => gsap.set('body', { overflow: 'auto' })
  });

  // Navbar slide-down
  master.from('.navbar', { y: -80, opacity: 0, duration: 0.8 });

  // Badge spring in
  master.from('.hero-pill-badge', {
    scale: 0.4, opacity: 0, duration: 0.9,
    ease: 'elastic.out(1.2, 0.5)'
  }, '-=0.5');

  // Title — word-by-word reveal
  const h1 = document.querySelector('.hero h1');
  if (h1) {
    const html = h1.innerHTML;
    // Wrap each word
    h1.innerHTML = html.replace(/([\wÀ-ÿ'&;:—\-]+)/g, '<span class="word-wrap"><span class="word">$1</span></span>');
    const style = document.createElement('style');
    style.textContent = `.word-wrap{display:inline-block;overflow:hidden;vertical-align:bottom;padding-bottom:4px} .word{display:inline-block}`;
    document.head.appendChild(style);
    const words = h1.querySelectorAll('.word');
    master.from(words, {
      yPercent: 110, rotationX: -40, opacity: 0,
      stagger: 0.045, duration: 0.9, ease: 'back.out(1.7)'
    }, '-=0.5');
  }

  // Subtitle typing effect feel
  master.from('.hero-subtitle', {
    clipPath: 'inset(0 100% 0 0)', opacity: 0,
    duration: 1.0, ease: 'power4.inOut'
  }, '-=0.4');

  // CTA buttons — spring up with stagger
  master.from('.hero-ctas .btn', {
    y: 40, opacity: 0, scale: 0.85,
    stagger: 0.12, duration: 0.7,
    ease: 'back.out(2.5)'
  }, '-=0.5');

  // Architecture visual — dramatic scale-up
  master.from('.device-network-visual', {
    scale: 0.75, opacity: 0, y: 50,
    duration: 1.2, ease: 'expo.out'
  }, '-=0.4');

  // Node cards fly in from sides
  master.from('.node-card:first-child', {
    x: -60, opacity: 0, rotateY: 15, duration: 0.8, ease: 'back.out(1.6)'
  }, '-=0.8');
  master.from('.node-card:last-child', {
    x: 60, opacity: 0, rotateY: -15, duration: 0.8, ease: 'back.out(1.6)'
  }, '-=0.7');

  // Hub core appears
  master.from('.hub-core', {
    scale: 0, opacity: 0, rotation: -180,
    duration: 1.0, ease: 'elastic.out(1, 0.4)'
  }, '-=0.6');

  // Connection lines
  master.from('.connection-lines span', {
    opacity: 0, x: -20, stagger: 0.1, duration: 0.5
  }, '-=0.3');
}

/* ═══════════════════════════════════════════════════════════════════════════
   3.  SCROLL ANIMATIONS — Reveal au défilement (style Claude Code)
   ═══════════════════════════════════════════════════════════════════════════*/
function runScrollAnimations() {

  // ── Section headers: cinematic text reveal ──
  gsap.utils.toArray('.section-header').forEach((header) => {
    const tl = gsap.timeline({
      scrollTrigger: { trigger: header, start: 'top 82%' }
    });
    tl.from(header.querySelector('.section-tag'), {
      xPercent: -30, opacity: 0, duration: 0.6, ease: 'power3.out'
    });
    tl.from(header.querySelector('.section-title'), {
      yPercent: 60, opacity: 0, duration: 0.8, ease: 'expo.out'
    }, '-=0.3');
    tl.from(header.querySelector('.section-description'), {
      y: 20, opacity: 0, duration: 0.7, ease: 'power2.out'
    }, '-=0.4');
  });

  // ── Pillar cards: staggered 3D tilt reveal ──
  gsap.utils.toArray('.pillars-grid').forEach((grid) => {
    const cards = grid.querySelectorAll('.pillar-card');
    gsap.from(cards, {
      scrollTrigger: { trigger: grid, start: 'top 80%' },
      y: 80, opacity: 0, scale: 0.88, rotateX: 8,
      stagger: { amount: 0.4, from: 'center' },
      duration: 0.9,
      ease: 'back.out(1.4)'
    });
    // Icon bounce separately
    gsap.from(grid.querySelectorAll('.pillar-icon'), {
      scrollTrigger: { trigger: grid, start: 'top 75%' },
      scale: 0, rotation: -90, opacity: 0,
      stagger: { amount: 0.3, from: 'center' },
      duration: 0.8,
      delay: 0.3,
      ease: 'elastic.out(1.2, 0.5)'
    });
  });

  // ── Timeline cards: cinematic left-slide with marker animation ──
  gsap.utils.toArray('.version-card').forEach((card, i) => {
    const inner = card.querySelector('.version-card-inner');
    const marker = card.querySelector('.version-marker');
    const badge = card.querySelector('.version-badge');
    const pills = card.querySelectorAll('.tech-pill');
    const features = card.querySelectorAll('.version-features-list li');

    const tl = gsap.timeline({
      scrollTrigger: { trigger: card, start: 'top 82%' }
    });

    // Marker pops in
    tl.from(marker, {
      scale: 0, rotation: -360, opacity: 0,
      duration: 0.6, ease: 'back.out(2)'
    });

    // Card slides in from left with rotation
    tl.from(inner, {
      x: -50, opacity: 0, rotateY: 6,
      duration: 0.8, ease: 'expo.out'
    }, '-=0.3');

    // Badge elastic bounce
    if (badge) {
      tl.from(badge, {
        scale: 0.3, opacity: 0, duration: 0.5,
        ease: 'elastic.out(1.2, 0.6)'
      }, '-=0.5');
    }

    // Status tag flies in
    const status = card.querySelector('.status-tag');
    if (status) {
      tl.from(status, {
        x: 30, opacity: 0, duration: 0.4, ease: 'power3.out'
      }, '-=0.3');
    }

    // Tech pills cascade in
    if (pills.length) {
      tl.from(pills, {
        scale: 0.5, opacity: 0,
        stagger: 0.04, duration: 0.35,
        ease: 'back.out(2)'
      }, '-=0.2');
    }

    // Feature items slide right
    if (features.length) {
      tl.from(features, {
        x: -20, opacity: 0,
        stagger: 0.06, duration: 0.35,
        ease: 'power2.out'
      }, '-=0.1');
    }
  });

  // ── Timeline line draws itself progressively ──
  const line = document.querySelector('.timeline-line');
  if (line) {
    gsap.from(line, {
      scrollTrigger: {
        trigger: '.timeline-container',
        start: 'top 80%',
        end: 'bottom 30%',
        scrub: 1.5
      },
      scaleY: 0,
      transformOrigin: 'top center'
    });
  }

  // ── Bot spotlight: dramatic entrance ──
  const spotlight = document.querySelector('.bot-spotlight');
  if (spotlight) {
    const tl = gsap.timeline({
      scrollTrigger: { trigger: spotlight, start: 'top 78%' }
    });
    tl.from(spotlight, {
      scale: 0.9, opacity: 0, y: 60, duration: 1.0,
      ease: 'expo.out'
    });
    tl.from('.bot-info > *', {
      x: -40, opacity: 0, stagger: 0.1, duration: 0.6,
      ease: 'power3.out'
    }, '-=0.6');

    // Terminal typing effect
    const termLines = document.querySelectorAll('.terminal-line');
    tl.from(termLines, {
      clipPath: 'inset(0 100% 0 0)', opacity: 0,
      stagger: 0.12, duration: 0.5,
      ease: 'power4.inOut'
    }, '-=0.3');
  }

  // ── PWA banner: bounce in from bottom ──
  const pwa = document.querySelector('.pwa-banner');
  if (pwa) {
    gsap.from(pwa, {
      scrollTrigger: { trigger: pwa, start: 'top 88%' },
      y: 60, opacity: 0, scale: 0.92,
      duration: 0.9, ease: 'back.out(1.5)'
    });
  }

  // ── Footer: stagger reveal ──
  const footerGrid = document.querySelector('.footer-grid');
  if (footerGrid) {
    gsap.from(footerGrid.children, {
      scrollTrigger: { trigger: footerGrid, start: 'top 90%' },
      y: 30, opacity: 0, stagger: 0.15, duration: 0.6,
      ease: 'power2.out'
    });
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   4.  AMBIENT — Animations perpétuelles vivantes (respirations, orbites)
   ═══════════════════════════════════════════════════════════════════════════*/
function runAmbientAnimations() {

  // Hub Core orbital glow pulsation
  gsap.to('.hub-core', {
    boxShadow: '0 0 55px rgba(177, 92, 240, 0.8), 0 0 90px rgba(152, 16, 230, 0.4)',
    repeat: -1, yoyo: true, duration: 2.5, ease: 'sine.inOut'
  });

  // Hub logo symbol slow spin
  gsap.to('.hub-symbol', {
    rotation: 360, duration: 20, repeat: -1, ease: 'none'
  });

  // Status dot super-pulse
  gsap.to('.status-dot', {
    scale: 1.6, boxShadow: '0 0 15px rgba(16, 185, 129, 0.9)',
    repeat: -1, yoyo: true, duration: 1.2, ease: 'sine.inOut'
  });

  // Active version marker orbital glow
  gsap.to('.version-card.active-now .version-marker', {
    boxShadow: '0 0 25px rgba(177, 92, 240, 0.9), 0 0 50px rgba(152, 16, 230, 0.4)',
    repeat: -1, yoyo: true, duration: 1.8, ease: 'sine.inOut'
  });

  // Traffic pulse text animate
  gsap.to('.traffic-pulse', {
    textShadow: '0 0 15px rgba(0, 229, 255, 0.9)',
    repeat: -1, yoyo: true, duration: 1.0, ease: 'sine.inOut'
  });

  // Ambient glow follows scroll position very subtly
  const glow = document.querySelector('.ambient-glow');
  if (glow) {
    gsap.to(glow, {
      scrollTrigger: {
        scrub: 2, start: 'top top', end: 'bottom bottom'
      },
      y: '50vh', scale: 1.3, opacity: 0.4, ease: 'none'
    });
  }

  // Pillar cards subtle floating
  gsap.utils.toArray('.pillar-card').forEach((card, i) => {
    gsap.to(card, {
      y: `${-4 - i * 2}`, duration: 2.5 + i * 0.3,
      repeat: -1, yoyo: true, ease: 'sine.inOut',
      delay: i * 0.4
    });
  });

  // Terminal cursor blink
  const lastLine = document.querySelector('.terminal-line:last-child');
  if (lastLine) {
    const cursor = document.createElement('span');
    cursor.textContent = '▌';
    cursor.style.cssText = 'color: var(--accent-cyan); margin-left: 4px;';
    lastLine.appendChild(cursor);
    gsap.to(cursor, {
      opacity: 0, repeat: -1, yoyo: true, duration: 0.6, ease: 'steps(1)'
    });
  }

  // Node cards gentle hover-float
  gsap.utils.toArray('.node-card').forEach((card, i) => {
    gsap.to(card, {
      y: -6, duration: 2.8 + i * 0.5,
      repeat: -1, yoyo: true, ease: 'sine.inOut',
      delay: i * 0.6
    });
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   5.  MAGNETIC BUTTONS — Boutons qui suivent le curseur
   ═══════════════════════════════════════════════════════════════════════════*/
function initMagneticButtons() {
  const strength = 0.3;
  document.querySelectorAll('.btn').forEach((btn) => {
    btn.addEventListener('mousemove', (e) => {
      const rect = btn.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = (e.clientX - cx) * strength;
      const dy = (e.clientY - cy) * strength;
      gsap.to(btn, { x: dx, y: dy, duration: 0.3, ease: 'power2.out' });
    });
    btn.addEventListener('mouseleave', () => {
      gsap.to(btn, { x: 0, y: 0, duration: 0.5, ease: 'elastic.out(1, 0.4)' });
    });
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   6.  3D TILT on cards (perspective follow cursor)
   ═══════════════════════════════════════════════════════════════════════════*/
function initTiltCards() {
  const tiltEls = document.querySelectorAll('.pillar-card, .version-card-inner');
  tiltEls.forEach((el) => {
    el.style.transformStyle = 'preserve-3d';
    el.style.willChange = 'transform';
    el.addEventListener('mousemove', (e) => {
      const rect = el.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width - 0.5;
      const y = (e.clientY - rect.top) / rect.height - 0.5;
      gsap.to(el, {
        rotateY: x * 8, rotateX: -y * 6,
        duration: 0.4, ease: 'power2.out'
      });
    });
    el.addEventListener('mouseleave', () => {
      gsap.to(el, {
        rotateY: 0, rotateX: 0,
        duration: 0.6, ease: 'elastic.out(1, 0.5)'
      });
    });
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   7.  TEXT SPLIT REVEALS — Titles that reveal letter-by-letter on scroll
   ═══════════════════════════════════════════════════════════════════════════*/
function initTextSplitReveals() {
  document.querySelectorAll('.section-title').forEach((title) => {
    if (title.dataset.splitDone) return;
    title.dataset.splitDone = '1';
    const text = title.textContent;
    title.innerHTML = '';
    const frag = document.createDocumentFragment();
    for (const char of text) {
      const span = document.createElement('span');
      span.textContent = char === ' ' ? '\u00A0' : char;
      span.style.display = 'inline-block';
      span.className = 'split-char';
      frag.appendChild(span);
    }
    title.appendChild(frag);

    gsap.from(title.querySelectorAll('.split-char'), {
      scrollTrigger: { trigger: title, start: 'top 85%' },
      opacity: 0, y: 20, rotateX: -90,
      stagger: 0.015, duration: 0.5,
      ease: 'back.out(1.7)'
    });
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   8.  FILTER ROADMAP — Animated filtering (versions V0 → V9)
   ═══════════════════════════════════════════════════════════════════════════*/
function initRoadmapFilters() {
  const filterBtns = document.querySelectorAll('.filter-btn');
  const versionCards = document.querySelectorAll('.version-card');

  filterBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      filterBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      const filter = btn.getAttribute('data-filter');
      let visibleIndex = 0;

      versionCards.forEach((card) => {
        const category = card.getAttribute('data-category');
        if (filter === 'all' || category === filter) {
          card.style.display = 'block';
          gsap.fromTo(card,
            { opacity: 0, x: -30, scale: 0.95 },
            { opacity: 1, x: 0, scale: 1, duration: 0.5, delay: visibleIndex * 0.07, ease: 'back.out(1.5)' }
          );
          visibleIndex++;
        } else {
          gsap.to(card, {
            opacity: 0, x: 20, scale: 0.95, duration: 0.3,
            ease: 'power2.in',
            onComplete: () => { card.style.display = 'none'; }
          });
        }
      });
    });
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   9.  NAV — Active section tracking + mobile menu
   ═══════════════════════════════════════════════════════════════════════════*/
function initNavigation() {
  const menuToggle = document.querySelector('.menu-toggle');
  const navLinks = document.querySelector('.nav-links');
  const navItems = document.querySelectorAll('.nav-link');

  if (menuToggle && navLinks) {
    menuToggle.addEventListener('click', () => {
      const isOpen = navLinks.classList.toggle('open');
      if (typeof gsap !== 'undefined' && isOpen) {
        gsap.from(navLinks.querySelectorAll('li'), {
          y: -15, opacity: 0, stagger: 0.05, duration: 0.3, ease: 'power2.out'
        });
      }
    });
    navItems.forEach((link) => {
      link.addEventListener('click', () => navLinks.classList.remove('open'));
    });
  }

  // Scroll-based active link with GSAP ScrollTrigger
  if (typeof gsap !== 'undefined' && typeof ScrollTrigger !== 'undefined') {
    document.querySelectorAll('section[id]').forEach((sec) => {
      ScrollTrigger.create({
        trigger: sec,
        start: 'top center',
        end: 'bottom center',
        onEnter: () => setActiveNav(sec.id),
        onEnterBack: () => setActiveNav(sec.id),
      });
    });
  }

  function setActiveNav(id) {
    navItems.forEach((link) => {
      link.classList.toggle('active', link.getAttribute('href') === `#${id}`);
    });
  }

  // Navbar scroll shrink
  if (typeof gsap !== 'undefined') {
    ScrollTrigger.create({
      start: 100, end: 99999,
      onEnter: () => gsap.to('.navbar', { height: 60, backdropFilter: 'blur(28px)', duration: 0.3 }),
      onLeaveBack: () => gsap.to('.navbar', { height: 76, backdropFilter: 'blur(20px)', duration: 0.3 })
    });
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   10.  BACK TO TOP — Smooth scroll-triggered appearance
   ═══════════════════════════════════════════════════════════════════════════*/
function initBackToTop() {
  const btn = document.querySelector('.back-to-top');
  if (!btn || typeof gsap === 'undefined') return;

  ScrollTrigger.create({
    start: 500, end: 99999,
    onEnter: () => gsap.to(btn, { opacity: 1, scale: 1, pointerEvents: 'auto', duration: 0.3, ease: 'back.out(2)' }),
    onLeaveBack: () => gsap.to(btn, { opacity: 0, scale: 0.5, pointerEvents: 'none', duration: 0.2 })
  });

  gsap.set(btn, { opacity: 0, scale: 0.5 });
  btn.addEventListener('click', () => {
    gsap.to(window, { scrollTo: 0, duration: 1.0, ease: 'power3.inOut' });
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   11.  PWA — Service Worker & install prompt
   ═══════════════════════════════════════════════════════════════════════════*/
let deferredPrompt = null;

function initPWA() {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then((r) => console.log('[PWA] SW registered:', r.scope))
        .catch((e) => console.warn('[PWA] SW failed:', e));
    });
  }

  const pwaButtons = document.querySelectorAll('.btn-install-pwa');

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    pwaButtons.forEach((btn) => {
      btn.style.display = 'inline-flex';
      if (typeof gsap !== 'undefined') {
        gsap.from(btn, { scale: 0, duration: 0.5, ease: 'elastic.out(1, 0.5)' });
      }
    });
  });

  pwaButtons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!deferredPrompt) {
        alert('L\'application ORION est déjà installée ou votre navigateur ne supporte pas l\'installation.');
        return;
      }
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log('[PWA] Install:', outcome);
      deferredPrompt = null;
      pwaButtons.forEach((b) => (b.style.display = 'none'));
    });
  });

  window.addEventListener('appinstalled', () => {
    pwaButtons.forEach((b) => (b.style.display = 'none'));
  });
}
