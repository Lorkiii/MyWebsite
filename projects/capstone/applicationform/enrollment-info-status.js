// enrollment-info-status.js - Display enrollment status on info pages

document.addEventListener('DOMContentLoaded', async () => {
  // Get level from URL (jhs-info.html or shs-info.html)
  const currentPage = window.location.pathname;
  const level = currentPage.includes('jhs-info') ? 'jhs' : 'shs';
  const levelName = level === 'jhs' ? 'Junior High School' : 'Senior High School';

  // Get DOM elements
  const statusBanner = document.getElementById('status-banner');
  const actionSection = document.getElementById('action-section');

  // Load and display status
  await loadEnrollmentStatus();

  // ===== MAIN FUNCTION =====
  async function loadEnrollmentStatus() {
    try {
      // Fetch public enrollment status
      const response = await fetch('/api/enrollment/status');
      
      if (!response.ok) {
        throw new Error('Failed to load enrollment status');
      }
      
      const data = await response.json();
      const statusData = data[level];
      
      // Update status banner
      updateStatusBanner(statusData);
      
      // Update action button if enrollment is open
      updateActionButton(statusData);
      
    } catch (err) {
      console.error('Error loading enrollment status:', err);
      
      // Show error state
      if (statusBanner) {
        statusBanner.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Unable to load enrollment status';
        statusBanner.className = 'status-banner loading';
      }
    }
  }

  // ===== UPDATE STATUS BANNER =====
  function updateStatusBanner(statusData) {
    if (!statusBanner) return;
    
    const status = statusData.status;
    const daysRemaining = statusData.daysRemaining;
    
    if (status === 'open') {
      // Show open status with days remaining
      statusBanner.className = 'status-banner open';
      const daysText = daysRemaining === 1 ? '1 day' : `${daysRemaining} days`;
      statusBanner.innerHTML = `
        <i class="fas fa-check-circle"></i>
        <span>Enrollment for ${levelName} is currently <strong>OPEN</strong> · ${daysText} remaining</span>
      `;
    } else {
      // Show closed status (covers both 'closed' and 'upcoming')
      statusBanner.className = 'status-banner closed';
      statusBanner.innerHTML = `
        <i class="fas fa-times-circle"></i>
        <span>Enrollment for ${levelName} is currently <strong>CLOSED</strong></span>
      `;
    }
  }

  // ===== UPDATE ACTION BUTTON =====
  function updateActionButton(statusData) {
    if (!actionSection) return;
    
    const status = statusData.status;
    
    if (status === 'open') {
      // Add "Enroll Now" button if enrollment is open
      const formLink = level === 'jhs' ? 'jhsform.html' : 'shsform.html';
      
      const enrollButton = document.createElement('a');
      enrollButton.href = formLink;
      enrollButton.className = 'btn-primary';
      enrollButton.innerHTML = '<i class="fas fa-edit"></i> Enroll Now';
      
      // Insert before the back button
      actionSection.insertBefore(enrollButton, actionSection.firstChild);
    }
    // If closed, keep only the "Back to Home" button (already in HTML)
  }
});
