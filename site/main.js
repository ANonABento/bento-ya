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

  // Background columns - matches CSS exactly
  BG_CARD_HEIGHT: 72,
  BG_CARD_GAP: 8,

  // Download lid
  LID_APPROACH_DISTANCE: 150,
  LID_BOX_PADDING: 20,

  // Timeline
  TIMELINE_SCROLL_DELAY_MS: 500,
};

// Step size = one card slot (height + gap) per tick
CONFIG.BG_STEP_SIZE = CONFIG.BG_CARD_HEIGHT + CONFIG.BG_CARD_GAP;


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
// CARD CONTENT GENERATOR
// Semi-structured random task content
// ===========================================
const CardContent = {
  tasks: [
    { title: 'Update API endpoints', tag: 'backend', hasNum: true },
    { title: 'Fix dark mode toggle', tag: 'bug' },
    { title: 'Add user preferences', tag: 'feature', summary: 'Settings page with theme options' },
    { title: 'Write unit tests', tag: 'testing', hasNum: true },
    { title: 'Optimize database queries', tag: 'perf', summary: 'Index improvements for search' },
    { title: 'Deploy staging build', tag: 'devops' },
    { title: 'Review PR', hasNum: true, hasPoints: true },
    { title: 'Update dependencies', tag: 'maintenance', summary: 'Security patches' },
    { title: 'Design system audit', tag: 'design', summary: 'Check component consistency' },
    { title: 'Mobile responsive fixes', tag: 'ui', hasNum: true },
    { title: 'Add loading skeletons', tag: 'ui', hasPoints: true },
    { title: 'Implement search', tag: 'feature', summary: 'Full-text search with filters' },
    { title: 'Error boundary setup', hasPoints: true },
    { title: 'Analytics integration', tag: 'backend', summary: 'Privacy-focused tracking' },
    { title: 'Keyboard shortcuts', tag: 'ux', hasNum: true },
    { title: 'Cache invalidation', hasPoints: true },
    { title: 'Drag and drop reorder', tag: 'feature', hasNum: true },
    { title: 'Toast notifications', summary: 'Non-blocking user feedback', hasPoints: true },
    { title: 'Rate limiting', tag: 'security' },
    { title: 'Export to CSV', tag: 'feature', summary: 'Data export functionality', hasNum: true },
    { title: 'Fix memory leak', tag: 'bug' },
    { title: 'Add pagination', hasPoints: true },
    { title: 'Webhook integration', tag: 'backend', summary: 'External service callbacks' },
    { title: 'Accessibility audit', tag: 'a11y', hasNum: true },
    { title: 'Setup CI pipeline', tag: 'devops', summary: 'GitHub Actions workflow' },
    { title: 'Input validation', tag: 'security', hasPoints: true },
    { title: 'Add breadcrumbs', tag: 'ux' },
    { title: 'Performance monitoring', summary: 'Add metrics collection', hasNum: true },
    { title: 'Refactor auth flow', tag: 'backend', hasPoints: true },
    { title: 'Fix timezone bugs', tag: 'bug', summary: 'UTC conversion issues', hasNum: true },
    { title: 'Add confirmation dialogs', hasPoints: true },
    { title: 'Image optimization', tag: 'perf', hasNum: true },
    { title: 'Add file uploads', tag: 'feature', summary: 'Drag and drop support' },
    { title: 'Fix scroll jank', tag: 'bug', hasPoints: true },
    { title: 'Add undo/redo', hasPoints: true },
    { title: 'Email notifications', tag: 'backend', summary: 'Digest and alerts' },
    { title: 'Redux migration', tag: 'refactor', hasNum: true },
    { title: 'Add table view', tag: 'feature' },
    { title: 'Lazy load images', summary: 'Intersection observer', hasPoints: true },
    { title: 'Add filters', tag: 'feature', summary: 'Filter by status and tags' },
    { title: 'Fix dropdown z-index', tag: 'bug', hasNum: true },
    { title: 'Add bulk actions', hasPoints: true },
    { title: 'SSO integration', tag: 'security', summary: 'SAML and OAuth support' },
    { title: 'Archive feature', tag: 'feature', hasNum: true },
    { title: 'Mobile app sync', hasPoints: true },
    { title: 'Add comments', tag: 'feature', summary: 'Task discussion threads' },
    { title: 'Optimize bundle', tag: 'perf', hasNum: true },
  ],

  generate() {
    const task = this.tasks[Math.floor(Math.random() * this.tasks.length)];
    return {
      title: task.title,
      tag: task.tag || null,
      num: task.hasNum ? `#${Math.floor(Math.random() * 200 + 50)}` : null,
      points: task.hasPoints ? `${Math.floor(Math.random() * 5 + 1)}pts` : null,
      summary: task.summary || null,
    };
  },
};

// ===========================================
// BACKGROUND COLUMNS
// Infinite scroll with DOM recycling
// ===========================================
const BackgroundColumns = {
  columns: [],
  container: null,
  cardsPerColumn: 12,

  init() {
    this.container = document.querySelector('.bg-columns');
    if (!this.container) return;

    // Clear any existing content
    this.container.innerHTML = '';

    // Create 6 columns with alternating directions
    for (let i = 0; i < 6; i++) {
      const isUp = i % 2 === 1;
      const col = this.createColumn(isUp, i);
      this.container.appendChild(col.element);
      this.columns.push(col);
    }

    // Register for tick events
    TickTimer.onTick(() => this.step());
  },

  createColumn(isUp, index) {
    const el = document.createElement('div');
    el.className = 'bg-col';

    // Apply staggered margin like CSS did
    const margins = [0, -40, -80, -20, -60, -100];
    el.style.marginTop = `${margins[index]}px`;

    // Create card pool
    const cards = [];
    for (let i = 0; i < this.cardsPerColumn; i++) {
      const card = this.createCard(i);
      el.appendChild(card.element);
      cards.push(card);
    }

    return {
      element: el,
      isUp,
      cards,
      offset: 0,
    };
  },

  createCard(position) {
    const content = CardContent.generate();
    const el = document.createElement('div');
    el.className = 'bg-card';

    // Create all elements upfront (hidden if empty) - avoids DOM manipulation later
    const titleEl = document.createElement('span');
    titleEl.className = 'bg-title';
    titleEl.textContent = content.title;

    const summaryEl = document.createElement('span');
    summaryEl.className = 'bg-summary';
    summaryEl.textContent = content.summary || '';
    summaryEl.hidden = !content.summary;

    const metaEl = document.createElement('span');
    metaEl.className = 'bg-meta';

    const tagEl = document.createElement('span');
    tagEl.className = 'bg-tag';
    tagEl.textContent = content.tag || '';
    tagEl.hidden = !content.tag;

    const numEl = document.createElement('span');
    numEl.className = 'bg-num';
    numEl.textContent = content.num || '';
    numEl.hidden = !content.num;

    const pointsEl = document.createElement('span');
    pointsEl.className = 'bg-num';
    pointsEl.textContent = content.points || '';
    pointsEl.hidden = !content.points;

    metaEl.appendChild(tagEl);
    metaEl.appendChild(numEl);
    metaEl.appendChild(pointsEl);
    metaEl.hidden = !content.tag && !content.num && !content.points;

    el.appendChild(titleEl);
    el.appendChild(summaryEl);
    el.appendChild(metaEl);

    // Set initial position (absolute positioning)
    el.style.top = `${position * CONFIG.BG_STEP_SIZE}px`;

    // Cache element references for fast updates (no querySelector needed)
    return {
      element: el,
      position,
      refs: { titleEl, summaryEl, metaEl, tagEl, numEl, pointsEl },
    };
  },

  updateCardContent(card) {
    const content = CardContent.generate();
    const { titleEl, summaryEl, metaEl, tagEl, numEl, pointsEl } = card.refs;

    // Direct property updates - no DOM queries, no innerHTML
    titleEl.textContent = content.title;

    summaryEl.textContent = content.summary || '';
    summaryEl.hidden = !content.summary;

    tagEl.textContent = content.tag || '';
    tagEl.hidden = !content.tag;

    numEl.textContent = content.num || '';
    numEl.hidden = !content.num;

    pointsEl.textContent = content.points || '';
    pointsEl.hidden = !content.points;

    metaEl.hidden = !content.tag && !content.num && !content.points;
  },

  step() {
    const cardHeight = CONFIG.BG_STEP_SIZE;

    this.columns.forEach((col) => {
      // Increment offset continuously (never reset)
      col.offset += cardHeight;

      // Apply transform to column
      // isUp = true: column moves UP (negative Y), cards appear to scroll UP
      // isUp = false: column moves DOWN (positive Y), cards appear to scroll DOWN
      const direction = col.isUp ? -1 : 1;
      col.element.style.transform = `translateY(${col.offset * direction}px)`;

      // Recycle cards that have scrolled out of view
      this.recycleCards(col, cardHeight, direction);
    });
  },

  recycleCards(col, cardHeight, direction) {
    col.cards.forEach((card) => {
      // Calculate card's actual visual position on screen
      // Card base position + column transform offset
      const cardBasePos = card.position * cardHeight;
      const columnShift = col.offset * direction;
      const cardVisualTop = cardBasePos + columnShift;

      if (col.isUp) {
        // Cards scroll UP visually → exit at TOP (negative Y)
        // Recycle to BOTTOM when card goes above viewport
        if (cardVisualTop < -cardHeight) {
          card.position += this.cardsPerColumn;
          card.element.style.top = `${card.position * cardHeight}px`;
          this.updateCardContent(card);
        }
      } else {
        // Cards scroll DOWN visually → exit at BOTTOM (large positive Y)
        // Recycle to TOP when card goes below viewport
        if (cardVisualTop > window.innerHeight + cardHeight) {
          card.position -= this.cardsPerColumn;
          card.element.style.top = `${card.position * cardHeight}px`;
          this.updateCardContent(card);
        }
      }
    });
  },
};

// ===========================================
// DOWNLOAD LID ANIMATION
// ===========================================
const DownloadLid = {
  box: null,
  lid: null,
  ticking: false,

  init() {
    this.box = document.querySelector('.download-box');
    this.lid = document.getElementById('downloadLid');
    if (!this.box || !this.lid) return;

    document.addEventListener('mousemove', (e) => {
      if (!this.ticking) {
        requestAnimationFrame(() => {
          this.handleMouseMove(e);
          this.ticking = false;
        });
        this.ticking = true;
      }
    });
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
        // Use container scrolling instead of scrollIntoView to avoid page scroll
        const ticketRect = currentTicket.getBoundingClientRect();
        const timelineRect = timeline.getBoundingClientRect();
        const scrollLeft = currentTicket.offsetLeft - (timelineRect.width / 2) + (ticketRect.width / 2);
        timeline.scrollTo({
          left: scrollLeft,
          behavior: 'smooth'
        });
      }, CONFIG.TIMELINE_SCROLL_DELAY_MS);
    }
  },
};

// ===========================================
// BENTO LID REVEAL (Scroll-based animation)
// ===========================================
const BentoLidReveal = {
  lid: null,
  box: null,
  section: null,

  // Smoothing state (lerp for fast scroll handling)
  currentProgress: 0,
  targetProgress: 0,
  lerpFactor: 0.12,

  init() {
    this.lid = document.getElementById('bentoLid');
    this.box = document.getElementById('bentoBox');
    this.section = document.querySelector('.bento-reveal-section');

    if (!this.lid || !this.box || !this.section) return;

    // Listen for scroll - update target, animation loop handles smoothing
    window.addEventListener('scroll', () => this.updateTarget(), { passive: true });

    // Start animation loop
    this.animate();
    this.updateTarget();
  },

  updateTarget() {
    const sectionRect = this.section.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const boxHeight = this.box.offsetHeight;
    const sectionTop = sectionRect.top;
    const startPoint = viewportHeight * 0.3;
    const animationRange = boxHeight * 0.8;
    const scrolledPast = startPoint - sectionTop;
    this.targetProgress = Math.max(0, scrolledPast / animationRange);
  },

  animate() {
    const diff = this.targetProgress - this.currentProgress;
    if (Math.abs(diff) > 0.001) {
      this.currentProgress += diff * this.lerpFactor;
    } else {
      this.currentProgress = this.targetProgress;
    }
    this.applyTransform();
    requestAnimationFrame(() => this.animate());
  },

  applyTransform() {
    const progress = this.currentProgress;
    const boxHeight = this.box.offsetHeight;
    const viewportHeight = window.innerHeight;

    // Cubic ease-out for natural motion
    const eased = progress >= 1 ? 1 : 1 - Math.pow(1 - Math.min(progress, 1), 3);

    // Lift up + tilt + drift right
    const maxLift = boxHeight + viewportHeight;
    const lift = Math.min(eased * boxHeight + Math.max(0, progress - 1) * boxHeight, maxLift);
    const slideRight = eased * 20;
    const rotate = eased * 12;
    const scale = 1 + eased * 0.05;

    this.lid.style.transform = `translateX(${slideRight}%) translateY(-${lift}px) rotate(${rotate}deg) scale(${scale})`;
    this.lid.classList.toggle('opening', progress > 0);
    this.lid.classList.toggle('open', progress >= 1);
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
  BentoLidReveal.init();
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
