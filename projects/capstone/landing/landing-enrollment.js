// landing-enrollment.js - Enrollment status display for landing page
// Simple implementation matching admin-enrollment.js pattern

document.addEventListener('DOMContentLoaded', async () => {
  // Get DOM elements
  const jhsButton = document.getElementById('enroll-jhs');
  const shsButton = document.getElementById('enroll-shs');
  const jhsBadge = document.getElementById('jhs-status-badge');
  const shsBadge = document.getElementById('shs-status-badge');

  // Load enrollment status on page load
  await loadEnrollmentStatus();


  async function loadEnrollmentStatus() {
    try {
      // Fetch public enrollment status (no authentication needed)
      const response = await fetch('/api/enrollment/status');
      
      if (!response.ok) {
        throw new Error('Failed to load enrollment status');
      }  
      const data = await response.json();
      
      // Update JHS enrollment button and badge - Check isOpen field
      updateEnrollmentButton('jhs', data.jhs, jhsButton, jhsBadge);
      
      // Update SHS enrollment button and badge - Check isOpen field
      updateEnrollmentButton('shs', data.shs, shsButton, shsBadge);
      
    } catch (err) {
      console.error('Error loading enrollment status:', err);
      
      // Show error state on badges
      if (jhsBadge) {
        jhsBadge.innerHTML = '<i class="fas fa-exclamation-circle"></i> Status unavailable';
        jhsBadge.className = 'enrollment-status-badge error';
      }
      if (shsBadge) {
        shsBadge.innerHTML = '<i class="fas fa-exclamation-circle"></i> Status unavailable';
        shsBadge.className = 'enrollment-status-badge error';
      }
    }
  }

  // ===== UPDATE BUTTON & BADGE =====
  function updateEnrollmentButton(level, enrollmentData, button, badge) {
    if (!button || !badge) return;
    
    const status = enrollmentData.status;
    const isOpen = enrollmentData.isOpen;
    
    // Update badge
    badge.classList.remove('open', 'closed', 'upcoming');
    
    // Check isOpen field first - if manually closed by admin, override everything
    if (isOpen === false || status === 'closed') {
      badge.classList.add('closed');
      badge.innerHTML = '<i class="fas fa-times-circle"></i> Closed';
      
      // Change button to "Learn More" and link to info page
      button.textContent = 'Learn More';
      button.href = level === 'jhs' ? 'applicationform/jhs-info.html' : 'applicationform/shs-info.html';
      button.classList.remove('disabled');
      // Keep button enabled so users can learn more
      
      return;
    }
    
    // If isOpen is true (or not set), check date-based status
    if (status === 'open') {
      badge.classList.add('open');
      badge.innerHTML = '<i class="fas fa-check-circle"></i> Open Now';
      
      // Change button to "Enroll Now" and link to enrollment form
      button.textContent = 'Enroll Now';
      button.href = level === 'jhs' ? 'applicationform/jhsform.html' : 'applicationform/shsform.html';
      button.classList.remove('disabled');
      
    } else if (status === 'upcoming') {
      badge.classList.add('upcoming');
      const days = enrollmentData.daysRemaining || 0;
      badge.innerHTML = `<i class="fas fa-clock"></i> Opens in ${days} ${days === 1 ? 'day' : 'days'}`;
      
      // Change button to "Learn More" while waiting
      button.textContent = 'Learn More';
      button.href = level === 'jhs' ? 'applicationform/jhs-info.html' : 'applicationform/shs-info.html';
      button.classList.remove('disabled');
    }
  }
});
