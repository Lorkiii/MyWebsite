// admin-enrollment.js - Simple enrollment period management
import { apiFetch } from '../api-fetch.js';

document.addEventListener('DOMContentLoaded', async () => {
  // Dashboard elements
  const jhsStatusBadge = document.getElementById('jhs-status-badge');
  const shsStatusBadge = document.getElementById('shs-status-badge');
  const jhsDaysInfo = document.getElementById('jhs-days-info');
  const shsDaysInfo = document.getElementById('shs-days-info');
  
  // Start/Close buttons
  const jhsStartBtn = document.getElementById('jhs-start-btn');
  const jhsCloseBtn = document.getElementById('jhs-close-btn');
  const shsStartBtn = document.getElementById('shs-start-btn');
  const shsCloseBtn = document.getElementById('shs-close-btn');
  
  // Modal elements
  const manageBtn = document.getElementById('manage-enrollment-btn');
  const enrollmentModal = document.getElementById('enrollment-modal');
  const cancelBtn = document.getElementById('enrollment-cancel-btn');
  const saveBtn = document.getElementById('enrollment-save-btn');
  
  // Start enrollment modal elements
  const startModal = document.getElementById('start-enrollment-modal');
  const startModalTitle = document.getElementById('start-modal-title');
  const startDateInput = document.getElementById('start-enrollment-start-date');
  const startEndDateInput = document.getElementById('start-enrollment-end-date');
  const confirmStartBtn = document.getElementById('confirm-start-btn');
  const cancelStartBtn = document.getElementById('cancel-start-btn');
  
  // Close enrollment modal elements
  const closeModal = document.getElementById('close-enrollment-modal');
  const closeModalTitle = document.getElementById('close-modal-title');
  const closeLevelName = document.getElementById('close-level-name');
  const confirmCloseBtn = document.getElementById('confirm-close-btn');
  const cancelCloseBtn = document.getElementById('cancel-close-btn');
  
  // Track which level is being modified
  let currentLevel = null;
  
  // Notification modal elements
  const notificationModal = document.getElementById('notification-modal');
  const notificationIcon = document.getElementById('notification-icon');
  const notificationTitle = document.getElementById('notification-title');
  const notificationMessage = document.getElementById('notification-message');
  const notificationOkBtn = document.getElementById('notification-ok-btn');
  
  // Date inputs
  const jhsStartInput = document.getElementById('jhs-start-date');
  const jhsEndInput = document.getElementById('jhs-end-date');
  const shsStartInput = document.getElementById('shs-start-date');
  const shsEndInput = document.getElementById('shs-end-date');
  
  // Status previews
  const jhsPreview = document.getElementById('jhs-status-preview');
  const shsPreview = document.getElementById('shs-status-preview');

  // Load enrollment status on page load
  await loadEnrollmentStatus();

  // Open modal
  if (manageBtn) {
    manageBtn.addEventListener('click', openEnrollmentModal);
  }

  // Close modal
  if (cancelBtn) {
    cancelBtn.addEventListener('click', closeEnrollmentModal);
  }

  // Close modal on outside click
  if (enrollmentModal) {
    enrollmentModal.addEventListener('click', (e) => {
      if (e.target === enrollmentModal) {
        closeEnrollmentModal();
      }
    });
  }

  // Save changes
  if (saveBtn) {
    saveBtn.addEventListener('click', saveEnrollmentSettings);
  }

  // Date input listeners for live preview
  [jhsStartInput, jhsEndInput].forEach(input => {
    if (input) {
      input.addEventListener('change', () => updatePreview('jhs'));
    }
  });

  [shsStartInput, shsEndInput].forEach(input => {
    if (input) {
      input.addEventListener('change', () => updatePreview('shs'));
    }
  });

  // Start enrollment button listeners
  if (jhsStartBtn) {
    jhsStartBtn.addEventListener('click', () => openStartModal('jhs'));
  }
  if (shsStartBtn) {
    shsStartBtn.addEventListener('click', () => openStartModal('shs'));
  }

  // Close enrollment button listeners
  if (jhsCloseBtn) {
    jhsCloseBtn.addEventListener('click', () => openCloseModal('jhs'));
  }
  if (shsCloseBtn) {
    shsCloseBtn.addEventListener('click', () => openCloseModal('shs'));
  }

  // Start modal handlers
  if (cancelStartBtn) {
    cancelStartBtn.addEventListener('click', closeStartModal);
  }
  if (confirmStartBtn) {
    confirmStartBtn.addEventListener('click', confirmStartEnrollment);
  }
  if (startModal) {
    startModal.addEventListener('click', (e) => {
      if (e.target === startModal) closeStartModal();
    });
  }

  // Close modal handlers
  if (cancelCloseBtn) {
    cancelCloseBtn.addEventListener('click', closeCloseModal);
  }
  if (confirmCloseBtn) {
    confirmCloseBtn.addEventListener('click', confirmCloseEnrollment);
  }
  if (closeModal) {
    closeModal.addEventListener('click', (e) => {
      if (e.target === closeModal) closeCloseModal();
    });
  }

  // Notification modal handlers
  if (notificationOkBtn) {
    notificationOkBtn.addEventListener('click', closeNotification);
  }
  if (notificationModal) {
    notificationModal.addEventListener('click', (e) => {
      if (e.target === notificationModal) closeNotification();
    });
  }

  // ===== FUNCTIONS =====

  async function loadEnrollmentStatus() {
    try {
      const response = await fetch('/api/enrollment/status');
      if (!response.ok) throw new Error('Failed to load enrollment status');
      
      const data = await response.json();
      
      // Update JHS status and buttons
      updateStatusBadge(jhsStatusBadge, data.jhs.status);
      updateDaysInfo(jhsDaysInfo, data.jhs);
      updateActionButtons('jhs', data.jhs.isOpen, data.jhs.status);
      
      // Update SHS status and buttons
      updateStatusBadge(shsStatusBadge, data.shs.status);
      updateDaysInfo(shsDaysInfo, data.shs);
      updateActionButtons('shs', data.shs.isOpen, data.shs.status);
      
    } catch (err) {
      console.error('Error loading enrollment status:', err);
      if (jhsStatusBadge) jhsStatusBadge.textContent = 'Error';
      if (shsStatusBadge) shsStatusBadge.textContent = 'Error';
    }
  }

  function updateStatusBadge(badge, status) {
    if (!badge) return;
    
    // Remove all status classes
    badge.classList.remove('open', 'closed', 'upcoming');
    
    // Add appropriate class and text
    if (status === 'open') {
      badge.classList.add('open');
      badge.textContent = 'Open';
    } else if (status === 'closed') {
      badge.classList.add('closed');
      badge.textContent = 'Closed';
    } else if (status === 'upcoming') {
      badge.classList.add('upcoming');
      badge.textContent = 'Coming Soon';
    } else {
      badge.textContent = 'Not Set';
    }
  }

  function updateDaysInfo(element, data) {
    if (!element) return;
    
    if (data.status === 'open' && data.daysRemaining) {
      const days = data.daysRemaining;
      element.textContent = days === 1 ? '1 day left' : `${days} days left`;
    } else if (data.status === 'upcoming' && data.daysRemaining) {
      const days = data.daysRemaining;
      element.textContent = days === 1 ? 'Opens in 1 day' : `Opens in ${days} days`;
    } else if (data.status === 'closed') {
      element.textContent = 'Period ended';
    } else {
      element.textContent = '';
    }
  }

  async function openEnrollmentModal() {
    try {
      // Load current settings (apiFetch returns parsed JSON directly)
      const data = await apiFetch('/api/enrollment/settings');
      
      // Populate form
      if (jhsStartInput) jhsStartInput.value = data.jhs?.startDate || '';
      if (jhsEndInput) jhsEndInput.value = data.jhs?.endDate || '';
      if (shsStartInput) shsStartInput.value = data.shs?.startDate || '';
      if (shsEndInput) shsEndInput.value = data.shs?.endDate || '';
      
      // Update previews
      updatePreview('jhs');
      updatePreview('shs');
      
      // Show modal
      if (enrollmentModal) {
        enrollmentModal.style.display = 'flex';
        enrollmentModal.setAttribute('aria-hidden', 'false');
      }
      
    } catch (err) {
      console.error('Error opening enrollment modal:', err);
      showNotification('error', 'Failed to Load', 'Failed to load enrollment settings');
    }
  }

  function closeEnrollmentModal() {
    if (enrollmentModal) {
      enrollmentModal.style.display = 'none';
      enrollmentModal.setAttribute('aria-hidden', 'true');
    }
  }

  function updatePreview(level) {
    const startInput = level === 'jhs' ? jhsStartInput : shsStartInput;
    const endInput = level === 'jhs' ? jhsEndInput : shsEndInput;
    const preview = level === 'jhs' ? jhsPreview : shsPreview;
    
    if (!startInput || !endInput || !preview) return;
    
    const startDate = startInput.value;
    const endDate = endInput.value;
    
    if (!startDate || !endDate) {
      preview.textContent = '';
      preview.className = 'status-preview';
      return;
    }
    
    const start = new Date(startDate);
    const end = new Date(endDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    
    // Validation
    if (start > end) {
      preview.textContent = '⚠️ Start date must be before end date';
      preview.className = 'status-preview closed';
      return;
    }
    
    // Calculate status
    let statusText = '';
    let statusClass = '';
    
    if (today < start) {
      const daysUntil = Math.ceil((start - today) / (1000 * 60 * 60 * 24));
      statusText = `🔵 Opens in ${daysUntil} ${daysUntil === 1 ? 'day' : 'days'}`;
      statusClass = 'upcoming';
    } else if (today > end) {
      statusText = '🔴 Period has ended';
      statusClass = 'closed';
    } else {
      const daysLeft = Math.ceil((end - today) / (1000 * 60 * 60 * 24));
      statusText = `🟢 Currently open (${daysLeft} ${daysLeft === 1 ? 'day' : 'days'} remaining)`;
      statusClass = 'open';
    }
    
    preview.textContent = statusText;
    preview.className = `status-preview ${statusClass}`;
  }

  async function saveEnrollmentSettings() {
    try {
      // Get values
      const jhsStart = jhsStartInput?.value;
      const jhsEnd = jhsEndInput?.value;
      const shsStart = shsStartInput?.value;
      const shsEnd = shsEndInput?.value;
      
      // Validation
      if (!jhsStart || !jhsEnd || !shsStart || !shsEnd) {
        showNotification('error', 'Missing Dates', 'Please fill in all dates');
        return;
      }
      
      // Validate date order
      if (new Date(jhsStart) > new Date(jhsEnd)) {
        showNotification('error', 'Invalid Dates', 'JHS start date must be before end date');
        jhsStartInput?.focus();
        return;
      }
      
      if (new Date(shsStart) > new Date(shsEnd)) {
        showNotification('error', 'Invalid Dates', 'SHS start date must be before end date');
        shsStartInput?.focus();
        return;
      }
      
      // Disable button
      if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
      }
      
      // Save to server (apiFetch already handles errors and returns parsed JSON)
      await apiFetch('/api/enrollment/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jhs: {
            startDate: jhsStart,
            endDate: jhsEnd
          },
          shs: {
            startDate: shsStart,
            endDate: shsEnd
          }
        })
      });
      
      // Success
      showNotification('success', 'Settings Updated', 'Enrollment periods updated successfully!');
      
      // Reload status on dashboard
      await loadEnrollmentStatus();
      
      // Close modal
      closeEnrollmentModal();
      
    } catch (err) {
      console.error('Error saving enrollment settings:', err);
      showNotification('error', 'Failed to Save', 'Failed to save settings: ' + err.message);
    } finally {
      // Re-enable button
      if (saveBtn) {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Changes';
      }
    }
  }

  // Update action buttons based on enrollment status
  function updateActionButtons(level, isOpen, status) {
    const startBtn = level === 'jhs' ? jhsStartBtn : shsStartBtn;
    const closeBtn = level === 'jhs' ? jhsCloseBtn : shsCloseBtn;
    
    if (!startBtn || !closeBtn) return;
    
    // Show Start button if enrollment is closed, hide Close button
    // Show Close button if enrollment is open, hide Start button
    if (isOpen === false || status === 'closed') {
      startBtn.style.display = 'inline-block';
      closeBtn.style.display = 'none';
    } else {
      startBtn.style.display = 'none';
      closeBtn.style.display = 'inline-block';
    }
  }

  // Open Start Enrollment Modal
  function openStartModal(level) {
    currentLevel = level;
    const levelName = level === 'jhs' ? 'Junior High School' : 'Senior High School';
    
    if (startModalTitle) {
      startModalTitle.textContent = `📅 Start ${levelName} Enrollment`;
    }
    
    // Set default dates (today and 30 days from now)
    const today = new Date();
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + 30);
    
    if (startDateInput) startDateInput.value = today.toISOString().split('T')[0];
    if (startEndDateInput) startEndDateInput.value = endDate.toISOString().split('T')[0];
    
    if (startModal) {
      startModal.style.display = 'flex';
      startModal.setAttribute('aria-hidden', 'false');
    }
  }

  // Close Start Enrollment Modal
  function closeStartModal() {
    if (startModal) {
      startModal.style.display = 'none';
      startModal.setAttribute('aria-hidden', 'true');
    }
    currentLevel = null;
  }

  // Confirm Start Enrollment
  async function confirmStartEnrollment() {
    if (!currentLevel) return;
    
    const startDate = startDateInput?.value;
    const endDate = startEndDateInput?.value;
    
    // Validate dates
    if (!startDate || !endDate) {
      showNotification('error', 'Invalid Dates', 'Please select both start and end dates');
      return;
    }
    
    if (new Date(startDate) > new Date(endDate)) {
      showNotification('error', 'Invalid Dates', 'Start date must be before end date');
      return;
    }
    
    try {
      // Disable button
      if (confirmStartBtn) {
        confirmStartBtn.disabled = true;
        confirmStartBtn.textContent = 'Starting...';
      }
      
      // Call API to start enrollment
      const response = await apiFetch('/api/enrollment/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          level: currentLevel,
          startDate: startDate,
          endDate: endDate
        })
      });
      
      // Success
      showNotification('success', 'Enrollment Started', `${currentLevel.toUpperCase()} enrollment has been started successfully!`);
      
      // Reload status
      await loadEnrollmentStatus();
      
      // Close modal
      closeStartModal();
      
    } catch (err) {
      console.error('Error starting enrollment:', err);
      showNotification('error', 'Failed to Start', 'Failed to start enrollment: ' + err.message);
    } finally {
      // Re-enable button
      if (confirmStartBtn) {
        confirmStartBtn.disabled = false;
        confirmStartBtn.textContent = 'Confirm Start';
      }
    }
  }

  // Open Close Enrollment Modal
  function openCloseModal(level) {
    currentLevel = level;
    const levelName = level === 'jhs' ? 'Junior High School' : 'Senior High School';
    
    if (closeLevelName) {
      closeLevelName.textContent = levelName;
    }
    
    if (closeModal) {
      closeModal.style.display = 'flex';
      closeModal.setAttribute('aria-hidden', 'false');
    }
  }

  // Close Close Enrollment Modal
  function closeCloseModal() {
    if (closeModal) {
      closeModal.style.display = 'none';
      closeModal.setAttribute('aria-hidden', 'true');
    }
    currentLevel = null;
  }

  // Confirm Close Enrollment
  async function confirmCloseEnrollment() {
    if (!currentLevel) return;
    
    try {
      // Disable button
      if (confirmCloseBtn) {
        confirmCloseBtn.disabled = true;
        confirmCloseBtn.textContent = 'Closing...';
      }
      
      // Call API to close enrollment
      const response = await apiFetch('/api/enrollment/close', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          level: currentLevel
        })
      });
      
      // Success
      showNotification('success', 'Enrollment Closed', `${currentLevel.toUpperCase()} enrollment has been closed successfully!`);
      
      // Reload status
      await loadEnrollmentStatus();
      
      // Close modal
      closeCloseModal();
      
    } catch (err) {
      console.error('Error closing enrollment:', err);
      showNotification('error', 'Failed to Close', 'Failed to close enrollment: ' + err.message);
    } finally {
      // Re-enable button
      if (confirmCloseBtn) {
        confirmCloseBtn.disabled = false;
        confirmCloseBtn.textContent = 'Confirm Close';
      }
    }
  }

  // Show notification modal (replaces alert)
  function showNotification(type, title, message) {
    if (!notificationModal || !notificationIcon || !notificationTitle || !notificationMessage) return;
    
    // Set icon and color based on type
    if (type === 'success') {
      notificationIcon.textContent = '✅';
      notificationIcon.style.color = '#2e8b57';
      notificationTitle.style.color = '#2e8b57';
    } else if (type === 'error') {
      notificationIcon.textContent = '❌';
      notificationIcon.style.color = '#dc2626';
      notificationTitle.style.color = '#dc2626';
    } else if (type === 'warning') {
      notificationIcon.textContent = '⚠️';
      notificationIcon.style.color = '#f59e0b';
      notificationTitle.style.color = '#f59e0b';
    } else {
      notificationIcon.textContent = 'ℹ️';
      notificationIcon.style.color = '#3b82f6';
      notificationTitle.style.color = '#3b82f6';
    }
    
    // Set title and message
    notificationTitle.textContent = title;
    notificationMessage.textContent = message;
    
    // Show modal
    notificationModal.style.display = 'flex';
    notificationModal.setAttribute('aria-hidden', 'false');
  }

  // Close notification modal
  function closeNotification() {
    if (notificationModal) {
      notificationModal.style.display = 'none';
      notificationModal.setAttribute('aria-hidden', 'true');
    }
  }
});
