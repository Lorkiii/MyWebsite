
// ── Initialize AOS ──
AOS.init({
  duration: 800,
  easing: 'ease-out-cubic',
  once: true,
  offset: 80,
  disable: 'mobile' // better performance on mobile
});

// ── Typing Animation ──
(function initTypingAnimation() {
  const typingEl = document.getElementById('typingText');
  if (!typingEl) return;

  const phrases = [
    'Full-Stack Developer',
    'Laravel Developer',
    'Backend Developer',
    'UI/UX Design',
    'Problem Solver'
  ];

  let phraseIndex = 0;
  let charIndex = 0;
  let isDeleting = false;
  let timeout;

  function type() {
    const currentPhrase = phrases[phraseIndex];

    if (isDeleting) {
      charIndex--;
      typingEl.textContent = currentPhrase.substring(0, charIndex);
    } else {
      charIndex++;
      typingEl.textContent = currentPhrase.substring(0, charIndex);
    }

    let speed = isDeleting ? 40 : 80;

    if (!isDeleting && charIndex === currentPhrase.length) {
      speed = 2000; // pause at end
      isDeleting = true;
    } else if (isDeleting && charIndex === 0) {
      isDeleting = false;
      phraseIndex = (phraseIndex + 1) % phrases.length;
      speed = 400; // pause before next word
    }

    timeout = setTimeout(type, speed);
  }

  // Start after a short delay
  setTimeout(type, 600);
})();

// ── Scroll Progress Bar ──
(function initScrollProgress() {
  const progressBar = document.getElementById('scrollProgress');
  if (!progressBar) return;

  function updateProgress() {
    const scrollTop = window.scrollY;
    const docHeight = document.documentElement.scrollHeight - window.innerHeight;
    const progress = docHeight > 0 ? (scrollTop / docHeight) * 100 : 0;
    progressBar.style.width = progress + '%';
  }

  window.addEventListener('scroll', updateProgress, { passive: true });
  updateProgress();
})();

// ── Header Scroll Effect ──
(function initHeaderScroll() {
  const header = document.getElementById('navHeader');
  if (!header) return;

  function onScroll() {
    if (window.scrollY > 50) {
      header.classList.add('scrolled');
    } else {
      header.classList.remove('scrolled');
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();

// ── Active Navigation Link ──
(function initActiveNav() {
  const navLinks = document.querySelectorAll('.navLinks a');
  const sections = document.querySelectorAll('section[id]');

  function updateActiveLink() {
    const scrollPos = window.scrollY + 100;
    let current = '';

    sections.forEach(section => {
      const top = section.offsetTop;
      const height = section.clientHeight;
      if (scrollPos >= top && scrollPos < top + height) {
        current = section.getAttribute('id');
      }
    });

    navLinks.forEach(link => {
      link.classList.remove('active');
      const href = link.getAttribute('href');
      if (href === '#' + current) {
        link.classList.add('active');
      }
    });
  }

  window.addEventListener('scroll', updateActiveLink, { passive: true });
  updateActiveLink();
})();

// ── Smooth Scroll for Nav Links ──
(function initSmoothScroll() {
  const navLinks = document.querySelectorAll('.navLinks a');

  navLinks.forEach(link => {
    link.addEventListener('click', function (e) {
      e.preventDefault();
      const targetId = this.getAttribute('href').substring(1);
      const target = document.getElementById(targetId);

      if (target) {
        const headerOffset = 70;
        const targetPosition = target.offsetTop - headerOffset;

        window.scrollTo({
          top: targetPosition,
          behavior: 'smooth'
        });
      }

      // Close mobile menu if open
      const hamburger = document.getElementById('hamburger');
      const navLinksEl = document.getElementById('navLinks');
      if (hamburger && navLinksEl) {
        hamburger.classList.remove('active');
        navLinksEl.classList.remove('active');
      }
    });
  });
})();

// ── Hamburger Menu ──
(function initHamburgerMenu() {
  const hamburger = document.getElementById('hamburger');
  const navLinks = document.getElementById('navLinks');
  if (!hamburger || !navLinks) return;

  hamburger.addEventListener('click', function () {
    hamburger.classList.toggle('active');
    navLinks.classList.toggle('active');
  });

  // Close menu when clicking outside
  document.addEventListener('click', function (e) {
    if (!navLinks.contains(e.target) && !hamburger.contains(e.target) && navLinks.classList.contains('active')) {
      hamburger.classList.remove('active');
      navLinks.classList.remove('active');
    }
  });
})();

// ── Back to Top Button ──
(function initBackToTop() {
  const btn = document.getElementById('backToTop');
  if (!btn) return;

  function toggleVisibility() {
    if (window.scrollY > 400) {
      btn.classList.add('visible');
    } else {
      btn.classList.remove('visible');
    }
  }

  window.addEventListener('scroll', toggleVisibility, { passive: true });
  toggleVisibility();

  btn.addEventListener('click', function (e) {
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
})();

// ── Skill Bars Animation ──
(function initSkillBars() {
  const skillBars = document.querySelectorAll('.skillBarFill');
  if (!skillBars.length) return;

  const observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('animate');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.3 }
  );

  skillBars.forEach(bar => observer.observe(bar));
})();

// ── EmailJS Integration ──
(function initEmailJS() {
  const defaultEmailJSConfig = {
    serviceId: 'service_631804',
    notificationTemplateId: 'template_ac988tv',
    autoReplyTemplateId: 'template_lorxuml',
    publicKey: 'jPX-GaGlYe2vsfaY9'
  };

  const emailjsConfig = {
    ...defaultEmailJSConfig,
    ...(window.EMAILJS_CONFIG || {})
  };

  function setupContactForm() {
    const form = document.querySelector('.emailForm');
    if (!form) return;

    if (typeof emailjs === 'undefined') {
      console.error('EmailJS SDK did not load. Check the CDN script in index.html.');
      return;
    }

    try {
      emailjs.init(emailjsConfig.publicKey);
    } catch (error) {
      console.error('EmailJS initialization failed:', error);
      return;
    }

    const modal = document.getElementById('emailStatusModal');
    const modalIcon = document.getElementById('statusModalIcon');
    const modalTitle = document.getElementById('emailStatusTitle');
    const modalMessage = document.getElementById('emailStatusMessage');
    const modalOk = document.getElementById('emailStatusOk');

    function openModal(isError, message) {
      if (!modal || !modalTitle || !modalMessage) return;

      modalTitle.textContent = isError ? 'Message Failed' : 'Message Sent!';
      modalMessage.textContent = message;

      if (modalIcon) {
        modalIcon.className = 'statusModalIcon' + (isError ? ' error' : '');
        modalIcon.innerHTML = isError
          ? '<i class="fas fa-times-circle"></i>'
          : '<i class="fas fa-check-circle"></i>';
      }

      if (modalOk) {
        modalOk.className = 'btn btnPrimary statusModalButton' + (isError ? ' error' : '');
      }

      modal.classList.add('is-visible');
      modal.setAttribute('aria-hidden', 'false');
    }

    function closeModal() {
      if (!modal) return;
      modal.classList.remove('is-visible');
      modal.setAttribute('aria-hidden', 'true');
    }

    if (modalOk) modalOk.addEventListener('click', closeModal);
    if (modal) {
      modal.addEventListener('click', function (e) {
        if (e.target === modal) closeModal();
      });
    }

    form.addEventListener('submit', async function (e) {
      e.preventDefault();

      if (window.location.protocol === 'file:') {
        openModal(true, 'EmailJS cannot send from a file:// URL. Open the site through localhost or a deployed domain, then whitelist that domain in EmailJS.');
        return;
      }

      const name = document.getElementById('name').value;
      const email = document.getElementById('email').value;
      const subject = document.getElementById('subject').value;
      const message = document.getElementById('message').value;

      if (!name || !email || !subject || !message) {
        openModal(true, 'Please fill in all fields.');
        return;
      }

      const submitBtn = form.querySelector('.submitBtn');
      const originalHTML = submitBtn.innerHTML;
      submitBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Sending...';
      submitBtn.disabled = true;

      const templateData = {
        from_name: name,
        reply_to: email,
        to_name: name,
        to_email: email,
        user_name: name,
        user_email: email,
        subject: subject,
        message: message,
        name: name,
        email: email
      };

      const autoReplyData = {
        from_name: 'JR Nieto',
        from_email: 'nietojohnraymond0918@gmail.com',
        to_name: name,
        to_email: email,
        user_name: name,
        user_email: email,
        subject: `Re: ${subject}`,
        message: message,
        name: name,
        email: email
      };

      const notificationTemplateId = emailjsConfig.notificationTemplateId || emailjsConfig.templateId;

      if (!notificationTemplateId) {
        openModal(true, 'Email setup is missing the notification template ID.');
        submitBtn.innerHTML = originalHTML;
        submitBtn.disabled = false;
        return;
      }

      try {
        await emailjs.send(emailjsConfig.serviceId, notificationTemplateId, templateData);

        let autoReplyFailed = false;
        if (emailjsConfig.autoReplyTemplateId) {
          try {
            await emailjs.send(emailjsConfig.serviceId, emailjsConfig.autoReplyTemplateId, autoReplyData);
          } catch (autoReplyError) {
            autoReplyFailed = true;
            console.error('EmailJS auto-reply error:', autoReplyError);
          }
        }

        openModal(
          false,
          autoReplyFailed
            ? 'Your message was sent. The confirmation email could not be delivered.'
            : 'Your message was sent successfully. I\'ll get back to you soon!'
        );
        form.reset();
      } catch (error) {
        console.error('EmailJS error:', error);
        openModal(true, 'Failed to send your message. Please try again later or email me directly.');
      } finally {
        submitBtn.innerHTML = originalHTML;
        submitBtn.disabled = false;
      }
    });
  }

  setupContactForm();
})();
