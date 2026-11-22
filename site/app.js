/* ==========================================================================
   ORION — Client Logic, GSAP Animations & PWA Handler
   ========================================================================== */

document.addEventListener('DOMContentLoaded', () => {
  initSpaceCanvas();
  initPWA();
  initNavigation();
  initRoadmapFilters();
  initGSAPAnimations();
  initBackToTop();
});

/* 1. Canvas Constellation / Starfield */
function initSpaceCanvas() {
  const canvas = document.getElementById('space-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let width = (canvas.width = window.innerWidth);
  let height = (canvas.height = window.innerHeight);

  window.addEventListener('resize', () => {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  });

  const starsCount = Math.floor((width * height) / 9000);
  const stars = [];

  for (let i = 0; i < starsCount; i++) {
    stars.push({
      x: Math.random() * width,
      y: Math.random() * height,
      radius: Math.random() * 1.5 + 0.5,
      alpha: Math.random() * 0.8 + 0.2,
      speedX: (Math.random() - 0.5) * 0.15,
      speedY: (Math.random() - 0.5) * 0.15,
      pulse: Math.random() * 0.02
    });
  }

  function render() {
    ctx.clearRect(0, 0, width, height);

    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      s.x += s.speedX;
      s.y += s.speedY;

      if (s.x < 0) s.x = width;
      if (s.x > width) s.x = 0;
      if (s.y < 0) s.y = height;
      if (s.y > height) s.y = 0;

      s.alpha += s.pulse;
      if (s.alpha > 0.9 || s.alpha < 0.2) s.pulse = -s.pulse;

      ctx.beginPath();
      ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(200, 180, 255, ${s.alpha})`;
      ctx.fill();
    }

    requestAnimationFrame(render);
  }

  render();
}

/* 2. PWA Registration & Install Prompt */
let deferredPrompt = null;

function initPWA() {
  // Service Worker Registration
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('./sw.js')
        .then((reg) => {
          console.log('[PWA] Service Worker enregistré avec succès:', reg.scope);
        })
        .catch((err) => {
          console.warn('[PWA] Échec de l\'enregistrement du Service Worker:', err);
        });
    });
  }

  const pwaButtons = document.querySelectorAll('.btn-install-pwa');

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    pwaButtons.forEach((btn) => {
      btn.style.display = 'inline-flex';
    });
  });

  pwaButtons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!deferredPrompt) {
        alert('L\'application ORION est déjà installée ou votre navigateur ne supporte pas l\'installation automatique.');
        return;
      }
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      console.log(`[PWA] Résultat du prompt d'installation: ${outcome}`);
      deferredPrompt = null;
      pwaButtons.forEach((b) => (b.style.display = 'none'));
    });
  });

  window.addEventListener('appinstalled', () => {
    console.log('[PWA] Application ORION installée !');
    pwaButtons.forEach((btn) => (btn.style.display = 'none'));
  });
}

/* 3. Navigation & Mobile Menu */
function initNavigation() {
  const menuToggle = document.querySelector('.menu-toggle');
  const navLinks = document.querySelector('.nav-links');
  const navItems = document.querySelectorAll('.nav-link');

  if (menuToggle && navLinks) {
    menuToggle.addEventListener('click', () => {
      navLinks.classList.toggle('open');
    });

    navItems.forEach((link) => {
      link.addEventListener('click', () => {
        navLinks.classList.remove('open');
      });
    });
  }

  // Active section tracking on scroll
  const sections = document.querySelectorAll('section[id]');
  window.addEventListener('scroll', () => {
    const scrollY = window.pageYOffset;
    sections.forEach((current) => {
      const sectionHeight = current.offsetHeight;
      const sectionTop = current.offsetTop - 120;
      const sectionId = current.getAttribute('id');

      if (scrollY > sectionTop && scrollY <= sectionTop + sectionHeight) {
        document.querySelectorAll('.nav-link').forEach((link) => {
          link.classList.remove('active');
          if (link.getAttribute('href') === `#${sectionId}`) {
            link.classList.add('active');
          }
        });
      }
    });
  });
}

/* 4. Roadmap Filtering */
function initRoadmapFilters() {
  const filterBtns = document.querySelectorAll('.filter-btn');
  const versionCards = document.querySelectorAll('.version-card');

  filterBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      filterBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      const filter = btn.getAttribute('data-filter');

      versionCards.forEach((card) => {
        const category = card.getAttribute('data-category');
        if (filter === 'all' || category === filter) {
          card.style.display = 'block';
          if (typeof gsap !== 'undefined') {
            gsap.fromTo(card, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.4 });
          }
        } else {
          card.style.display = 'none';
        }
      });
    });
  });
}

/* 5. GSAP Animations */
function initGSAPAnimations() {
  if (typeof gsap === 'undefined') return;

  // Enregistrement de ScrollTrigger si disponible
  if (typeof ScrollTrigger !== 'undefined') {
    gsap.registerPlugin(ScrollTrigger);
  }

  // Hero Stagger
  const heroTl = gsap.timeline({ defaults: { ease: 'power3.out' } });

  heroTl
    .from('.hero-pill-badge', { y: -20, opacity: 0, duration: 0.6 })
    .from('.hero h1', { y: 30, opacity: 0, duration: 0.8 }, '-=0.3')
    .from('.hero-subtitle', { y: 20, opacity: 0, duration: 0.8 }, '-=0.5')
    .from('.hero-ctas .btn', { y: 20, opacity: 0, stagger: 0.15, duration: 0.6 }, '-=0.5')
    .from('.device-network-visual', { scale: 0.95, opacity: 0, duration: 1 }, '-=0.4');

  // Pulsing animation for devices in network hub
  gsap.to('.hub-core', {
    boxShadow: '0 0 50px rgba(177, 92, 240, 0.7)',
    repeat: -1,
    yoyo: true,
    duration: 2.5,
    ease: 'sine.inOut'
  });

  // ScrollTrigger Animations
  if (typeof ScrollTrigger !== 'undefined') {
    // Section headers reveal
    gsap.utils.toArray('.section-header').forEach((header) => {
      gsap.from(header, {
        scrollTrigger: {
          trigger: header,
          start: 'top 85%'
        },
        y: 40,
        opacity: 0,
        duration: 0.8,
        ease: 'power2.out'
      });
    });

    // Pillars cards
    gsap.utils.toArray('.pillar-card').forEach((card, index) => {
      gsap.from(card, {
        scrollTrigger: {
          trigger: card,
          start: 'top 85%'
        },
        y: 40,
        opacity: 0,
        duration: 0.7,
        delay: index * 0.15,
        ease: 'power2.out'
      });
    });

    // Timeline cards reveal
    gsap.utils.toArray('.version-card').forEach((card, index) => {
      gsap.from(card, {
        scrollTrigger: {
          trigger: card,
          start: 'top 85%'
        },
        x: -30,
        opacity: 0,
        duration: 0.6,
        delay: (index % 3) * 0.1,
        ease: 'power2.out'
      });
    });

    // Spotlight box
    gsap.from('.bot-spotlight', {
      scrollTrigger: {
        trigger: '.bot-spotlight',
        start: 'top 80%'
      },
      scale: 0.96,
      opacity: 0,
      duration: 0.8,
      ease: 'power3.out'
    });
  }
}

/* 6. Back-To-Top button */
function initBackToTop() {
  const btn = document.querySelector('.back-to-top');
  if (!btn) return;

  window.addEventListener('scroll', () => {
    if (window.pageYOffset > 400) {
      btn.classList.add('visible');
    } else {
      btn.classList.remove('visible');
    }
  });

  btn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}
