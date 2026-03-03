/**
 * Bento-ya Marketing Site Scripts
 * Modular, organized JavaScript with clear responsibilities
 */

// ===========================================
// CONFIGURATION
// ===========================================
const CONFIG = {
  // Animation timing
  TICK_INTERVAL_MS: 1000,
  SCROLL_FORCE_DURATION_MS: 600,

  // Background columns
  BG_CARD_HEIGHT: 48,
  BG_CARD_GAP: 10,
  BG_PHASES_PER_CYCLE: 8,

  // Download lid
  LID_APPROACH_DISTANCE: 150,
  LID_BOX_PADDING: 20,

  // Timeline
  TIMELINE_SCROLL_DELAY_MS: 500,
};

// Computed values
CONFIG.BG_STEP_SIZE = (CONFIG.BG_CARD_HEIGHT + CONFIG.BG_CARD_GAP) / CONFIG.BG_PHASES_PER_CYCLE;

// ===========================================
// SCROLL RESTORATION FIX
// Must run early to prevent browser scroll restoration
// ===========================================
const ScrollFix = {
  init() {
    if ('scrollRestoration' in history) {
      history.scrollRestoration = 'manual';
    }

    window.addEventListener('load', () => this.forceTopTemporarily());
    window.addEventListener('pageshow', (e) => {
      if (e.persisted) window.scrollTo(0, 0);
    });
  },

  forceTopTemporarily() {
    const html = document.documentElement;
    const body = document.body;
    const start = Date.now();

    html.style.scrollBehavior = 'auto';

    const forceTop = () => {
      html.scrollTop = 0;
      body.scrollTop = 0;
      window.scrollTo(0, 0);

      if (Date.now() - start < CONFIG.SCROLL_FORCE_DURATION_MS) {
        requestAnimationFrame(forceTop);
      } else {
        html.style.scrollBehavior = '';
      }
    };

    forceTop();
  },
};

// Initialize scroll fix immediately
ScrollFix.init();

// ===========================================
// GLOBAL TICK TIMER
// Syncs all animations to a 1-second pulse
// ===========================================
const TickTimer = {
  tick: 0,
  listeners: [],

  init() {
    setInterval(() => {
      this.tick++;
      document.body.setAttribute('data-tick', this.tick);
      this.listeners.forEach((fn) => fn(this.tick));
    }, CONFIG.TICK_INTERVAL_MS);
  },

  onTick(callback) {
    this.listeners.push(callback);
  },
};

// ===========================================
// THEME TOGGLE
// ===========================================
const Theme = {
  init() {
    this.loadSaved();
  },

  loadSaved() {
    const saved = localStorage.getItem('theme');
    if (saved) {
      document.documentElement.setAttribute('data-theme', saved);
    }
  },

  toggle() {
    const html = document.documentElement;
    const current = html.getAttribute('data-theme');

    let newTheme;
    if (current === 'dark') {
      newTheme = 'light';
    } else if (current === 'light') {
      newTheme = 'dark';
    } else {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      newTheme = prefersDark ? 'light' : 'dark';
    }

    html.setAttribute('data-theme', newTheme);
    localStorage.setItem('theme', newTheme);
  },
};

// ===========================================
// BACKGROUND COLUMNS
// Kanban board backdrop with animated columns
// ===========================================
const BackgroundColumns = {
  columns: [],

  init() {
    const columnElements = document.querySelectorAll('.bg-col');
    if (!columnElements.length) return;

    // Initialize each column with phase based on direction
    this.columns = Array.from(columnElements).map((el, index) => {
      const isUp = el.dataset.direction === 'up';
      return {
        element: el,
        isUp,
        phase: index * 2, // Stagger phases: 0, 2, 4, 6, 8
      };
    });

    TickTimer.onTick(() => this.step());
  },

  step() {
    this.columns.forEach((col) => {
      // Advance phase
      col.phase = (col.phase + 1) % CONFIG.BG_PHASES_PER_CYCLE;

      // Calculate offset - moves up or down based on direction
      const direction = col.isUp ? -1 : 1;
      const offset = col.phase * CONFIG.BG_STEP_SIZE * direction;

      // Apply transform to column
      col.element.style.transform = `translateY(${offset}px)`;
    });
  },
};

// ===========================================
// DOWNLOAD LID ANIMATION
// ===========================================
const DownloadLid = {
  box: null,
  lid: null,

  init() {
    this.box = document.querySelector('.download-box');
    this.lid = document.getElementById('downloadLid');
    if (!this.box || !this.lid) return;

    document.addEventListener('mousemove', (e) => this.handleMouseMove(e));
  },

  handleMouseMove(e) {
    const rect = this.box.getBoundingClientRect();
    const padding = CONFIG.LID_BOX_PADDING;

    // Check if mouse is inside the box (with padding)
    const insideX = e.clientX >= rect.left - padding && e.clientX <= rect.right + padding;
    const insideY = e.clientY >= rect.top - padding && e.clientY <= rect.bottom + padding;
    const isInside = insideX && insideY;

    if (isInside) {
      this.openFully();
    } else {
      this.handleApproach(e, rect);
    }
  },

  openFully() {
    this.lid.style.transform = 'translateX(-110%) rotate(-8deg) translateY(-4px)';
    this.lid.classList.add('lifting');
  },

  handleApproach(e, rect) {
    // Calculate distance to closest edge
    const closestX = Math.max(rect.left, Math.min(e.clientX, rect.right));
    const closestY = Math.max(rect.top, Math.min(e.clientY, rect.bottom));
    const distance = Math.sqrt(
      Math.pow(e.clientX - closestX, 2) + Math.pow(e.clientY - closestY, 2)
    );

    if (distance < CONFIG.LID_APPROACH_DISTANCE) {
      const progress = 1 - distance / CONFIG.LID_APPROACH_DISTANCE;
      const translateX = progress * -60;
      const rotate = progress * -4;
      const lift = progress * 2;

      this.lid.style.transform = `translateX(${translateX}%) rotate(${rotate}deg) translateY(${-lift}px)`;
      this.lid.classList.toggle('lifting', progress > 0.5);
    } else {
      this.close();
    }
  },

  close() {
    this.lid.style.transform = '';
    this.lid.classList.remove('lifting');
  },
};

// ===========================================
// TICKET TIMELINE
// ===========================================
const TicketTimeline = {
  init() {
    const timeline = document.querySelector('.ticket-timeline');
    const currentTicket = document.querySelector('.order-ticket.current');

    if (timeline && currentTicket) {
      setTimeout(() => {
        currentTicket.scrollIntoView({
          behavior: 'smooth',
          inline: 'center',
          block: 'nearest',
        });
      }, CONFIG.TIMELINE_SCROLL_DELAY_MS);
    }
  },
};

// ===========================================
// INITIALIZATION
// ===========================================
function init() {
  TickTimer.init();
  Theme.init();
  BackgroundColumns.init();
  DownloadLid.init();
  TicketTimeline.init();
}

// Run when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// ===========================================
// EXPORTS (for global access)
// ===========================================
window.toggleTheme = () => Theme.toggle();
