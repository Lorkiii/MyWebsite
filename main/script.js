// Wait for EmailJS library to load with retry mechanism
function initializeEmailJS() {
  if (typeof emailjs !== 'undefined') {
    try {
      emailjs.init("avEBP9pctGARIrLI6");
      setupContactForm(); // Setup form only after emailjs is ready
    } catch (error) {
      console.error('❌ Error initializing EmailJS:', error);
      alert('Email service initialization failed. Please check your EmailJS configuration.');
    }
  } else {
    // Retry after 100ms if not loaded yet
    setTimeout(initializeEmailJS, 100);
  }
}

// Setup contact form - only called after emailjs is initialized
function setupContactForm() {
  const contactForm = document.querySelector('.emailForm');
  if (contactForm) {
    // Email Status Modal
    const statusModal = document.getElementById('emailStatusModal');
    const statusTitle = document.getElementById('emailStatusTitle');
    const statusMessage = document.getElementById('emailStatusMessage');
    const statusOk = document.getElementById('emailStatusOk');

    const closeStatusModal = () => {
      if (!statusModal) {
        return;
      }
      statusModal.classList.remove('is-visible');
      statusModal.setAttribute('aria-hidden', 'true');
    };

    const openStatusModal = (isError, message) => {
      if (!statusModal || !statusTitle || !statusMessage || !statusOk) {
        return;
      }
      statusTitle.textContent = isError ? 'Message Failed' : 'Message Sent';
      statusMessage.textContent = message;
      statusOk.classList.toggle('error', isError);
      statusModal.classList.add('is-visible');
      statusModal.setAttribute('aria-hidden', 'false');
    };

    if (statusOk) {
      statusOk.addEventListener('click', closeStatusModal);
    }

    if (statusModal) {
      statusModal.addEventListener('click', (event) => {
        if (event.target === statusModal) {
          closeStatusModal();
        }
      });
    }

    // Contact Form
    contactForm.addEventListener('submit', function(e) {
      e.preventDefault();
      
      // Get form values
      const name = document.getElementById('name').value;
      const email = document.getElementById('email').value;
      const subject = document.getElementById('subject').value;
      const message = document.getElementById('message').value;
      
      // Validate form
      if (!name || !email || !subject || !message) {
        alert('⚠️ Please fill in all fields!');
        return;
      }
      
      // Show loading state
      const submitBtn = document.querySelector('.submitBtn');
      const originalText = submitBtn.textContent;
      submitBtn.textContent = 'Sending...';
      submitBtn.disabled = true;
      
      // Send email via EmailJS
      
      emailjs.send('service_631804', 'template_ckht00e', {
        name: name,
        email: email,
        subject: subject,
        message: message
      }).then(function(response) {
        // Success message
        openStatusModal(false, 'Your message was sent successfully. I will get back to you soon.');
        contactForm.reset();
        submitBtn.textContent = originalText;
        submitBtn.disabled = false;
      }, function(error) {
      
        console.error('Error details:', {
          status: error.status,
          text: error.text,
          message: error.message
        });
        // More detailed error message
        openStatusModal(true, 'Failed to send your message. Please try again later.');
        submitBtn.textContent = originalText;
        submitBtn.disabled = false;
      });
    });
  }
}

// Smooth scroll with active state management
function initializeSmoothScroll() {
  const navLinks = document.querySelectorAll('.navLinks a');
  const sections = document.querySelectorAll('section');
  
  // Function to update active navigation link
  function updateActiveLink() {
    let current = '';
    sections.forEach(section => {
      const sectionTop = section.offsetTop;
      const sectionHeight = section.clientHeight;
      if (pageYOffset >= sectionTop - 100) {
        current = section.getAttribute('id');
      }
    });
    
    navLinks.forEach(link => {
      link.classList.remove('active');
      if (link.getAttribute('href') === `#${current}`) {
        link.classList.add('active');
      }
    });
  }
  
  // Smooth scroll for navigation links
  navLinks.forEach(link => {
    link.addEventListener('click', function(e) {
      e.preventDefault();
      const targetId = this.getAttribute('href').substring(1);
      const targetSection = document.getElementById(targetId);
      
      if (targetSection) {
        targetSection.scrollIntoView({
          behavior: 'smooth',
          block: 'start'
        });
      }
    });
  });
  
  // Update active link on scroll
  window.addEventListener('scroll', updateActiveLink);
  updateActiveLink(); // Set initial active state
}

// Start initialization when page loads
window.addEventListener('load', function() {

  initializeEmailJS();
  initializeSmoothScroll();
 
  const hamburger = document.getElementById('hamburger');
  const navLinks = document.getElementById('navLinks');
  const navItems = document.querySelectorAll('.navLinks a');

  // Toggle hamburger menu
  hamburger.addEventListener('click', function() {
    hamburger.classList.toggle('active');
    navLinks.classList.toggle('active');
  });

  // Close menu when a link is clicked
  navItems.forEach(item => {
    item.addEventListener('click', function() {
      hamburger.classList.remove('active');
      navLinks.classList.remove('active');
    });
  });

  // Close menu when clicking outside
  document.addEventListener('click', function(event) {
    const isClickInsideNav = navLinks.contains(event.target);
    const isClickOnHamburger = hamburger.contains(event.target);
    
    if (!isClickInsideNav && !isClickOnHamburger && navLinks.classList.contains('active')) {
      hamburger.classList.remove('active');
      navLinks.classList.remove('active');
    }
  });

  // Scroll animation for sections
  const observerOptions = {
    threshold: 0.1,
    rootMargin: '0px 0px -50px 0px'
  };

  const observer = new IntersectionObserver(function(entries) {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.classList.add('scroll-animate');
        observer.unobserve(entry.target);
      }
    });
  }, observerOptions);

  // Observe all sections and cards for scroll animation
  const animatableElements = document.querySelectorAll('.aboutText, .projectCard, .educationCard, .experienceCard');
  animatableElements.forEach(el => {
    observer.observe(el);
  });

  // Animate elements on page load
  const aboutText = document.querySelector('.aboutText');
  if (aboutText) {
    setTimeout(() => {
      aboutText.style.animation = 'slideInRight 0.8s ease-out forwards';
    }, 100);
  }
});
