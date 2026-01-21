import { logoutAndRedirect } from "../logout-auth.js";
import { apiFetch } from "../api-fetch.js";

document.addEventListener("DOMContentLoaded", function () {
  // ================= Sidebar & Navigation =================
  const openSidebar = document.getElementById("open-sidebar");
  const closeSidebar = document.getElementById("close-sidebar");
  const sidebar = document.querySelector(".sidebar");
  const mainContent = document.querySelector(".main-content");
  const navLinks = document.querySelectorAll(
    '.sidebar a[href^="#"]:not([href="#"])'
  );

  // Overlay for mobile
  const overlay = document.createElement("div");
  overlay.className = "overlay";
  document.body.appendChild(overlay);

  function updateLayout() {
    const isDesktop = window.innerWidth >= 992;
    const sidebarVisible = sidebar.classList.contains("show");
    mainContent.classList.toggle("with-sidebar", isDesktop && sidebarVisible);
  }

  function showSidebar() {
    sidebar.classList.add("show");
    overlay.classList.add("active");
    updateLayout();
  }

  function hideSidebar() {
    sidebar.classList.remove("show");
    overlay.classList.remove("active");
    updateLayout();
  }

  window.addEventListener("resize", updateLayout);
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".sidebar") && !openSidebar.contains(e.target)) {
      hideSidebar();
    }
  });

  openSidebar.addEventListener("click", showSidebar);
  closeSidebar.addEventListener("click", hideSidebar);
  overlay.addEventListener("click", hideSidebar);

  // Dropdowns in sidebar
  const dropdowns = document.querySelectorAll(".dropdown-toggle");
  dropdowns.forEach((dropdown) => {
    dropdown.addEventListener("click", function (e) {
      e.preventDefault();
      dropdowns.forEach((other) => {
        if (other !== this) other.parentElement.classList.remove("active");
      });
      this.parentElement.classList.toggle("active");
    });
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".dropdown")) {
      dropdowns.forEach((d) => d.parentElement.classList.remove("active"));
    }
  });

  // Navigation (hash-based)
  function checkHash() {
    const hash = window.location.hash || "#dashboard";
    const targetSection = document.querySelector(hash);

    document
      .querySelectorAll("section")
      .forEach((sec) => (sec.style.display = "none"));
    if (targetSection) targetSection.style.display = "block";
    else document.querySelector("#dashboard").style.display = "block";

    navLinks.forEach((link) => {
      link.classList.remove("active");
      if (link.getAttribute("href") === hash) {
        link.classList.add("active");
        const dropdown = link.closest(".dropdown");
        if (dropdown) dropdown.classList.add("active");
      }
    });

    // Load profile data when navigating to profile settings
    if (hash === "#profile-settings") {
      loadProfileData();
    }
  }

  navLinks.forEach((link) => {
    link.addEventListener("click", function (e) {
      if (this.hash && this.hash !== "#") {
        e.preventDefault();
        history.pushState(null, null, this.hash);
        checkHash();
        if (window.innerWidth < 992) hideSidebar();
      }
    });
  });
    window.addEventListener("hashchange", checkHash);
  checkHash();
  
  // Load and display admin's name in sidebar
  updateSidebarDisplayName();
  
  // date widget
  (function () {
    // Node selectors (matches your HTML classes)
    const dateEl = document.querySelector(".datetime-widget .current-date");
    const timeEl = document.querySelector(".datetime-widget .current-time");

    // Use Manila timezone explicitly
    const TIMEZONE = "Asia/Manila";

    // Formatting options
    const dateOptions = {
      timeZone: TIMEZONE,
      year: "numeric",
      month: "long",
      day: "numeric",
    };

    const timeOptions = {
      timeZone: TIMEZONE,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    };

    function updateDateTime() {
      const now = new Date();

      if (dateEl) {
        dateEl.textContent = now.toLocaleDateString(
          navigator.language || "en-US",
          dateOptions
        );
      }

      if (timeEl) {
        timeEl.textContent = now.toLocaleTimeString(
          navigator.language || "en-US",
          timeOptions
        );
      }
    }
    // Initialize and schedule updates
    updateDateTime();
    // Update every 1 second so the minute flips exactly on time.
    setInterval(updateDateTime, 1000);
  })();
  // Logout
  document.getElementById("logout-btn").addEventListener("click", () => {
    logoutAndRedirect("../login/login.html");
  });

  // ========== Profile Settings Logic ==========
  
  const profileDisplayName = document.getElementById('profile-displayname');
  const profilePhone = document.getElementById('profile-phone');
  const saveProfileBtn = document.getElementById('save-profile-btn');
  const changePasswordBtn = document.getElementById('change-password-btn');
  const currentPasswordInput = document.getElementById('current-password');
  const newPasswordInput = document.getElementById('new-password');
  const confirmPasswordInput = document.getElementById('confirm-password');
  const profileMessage = document.getElementById('profile-message');

  // Phone input validation (numeric only)
  if (profilePhone) {
    profilePhone.addEventListener('input', function(e) {
      this.value = this.value.replace(/[^0-9]/g, '');
      if (this.value.length > 10) {
        this.value = this.value.slice(0, 10);
      }
    });
  }

  // Load and update sidebar display name
  async function updateSidebarDisplayName() {
    try {
      const data = await apiFetch('/api/admin/profile', {
        method: 'GET'
      });
      
      const sidebarNameEl = document.querySelector('.admin-name');
      if (sidebarNameEl && data.displayName) {
        sidebarNameEl.textContent = data.displayName;
      }
    } catch (error) {
      console.error('Failed to load sidebar name:', error);
      // Fail silently - don't disrupt user experience
    }
  }

  // Load current user profile data
  async function loadProfileData() {
    try {
      const data = await apiFetch('/api/admin/profile', {
        method: 'GET'
      });
      
      // Populate display text fields (read-only)
      const displayNameText = document.getElementById('display-name-text');
      const emailText = document.getElementById('email-text');
      const currentPhoneText = document.getElementById('current-phone-text');
      
      if (displayNameText) displayNameText.textContent = data.displayName || 'Not set';
      if (emailText) emailText.textContent = data.email || 'Not set';
      
      // Show current phone or "Not set"
      if (currentPhoneText) {
        if (data.phone) {
          currentPhoneText.textContent = data.phone;
          currentPhoneText.classList.remove('profile-not-set');
        } else {
          currentPhoneText.textContent = 'Not set';
          currentPhoneText.classList.add('profile-not-set');
        }
      }
      
      // Pre-fill edit fields (admin can edit display name)
      if (profileDisplayName) profileDisplayName.value = data.displayName || '';
      if (profilePhone) {
        const phoneNum = (data.phone || '').replace(/^\+63/, '');
        profilePhone.value = phoneNum;
      }

      // Also update sidebar name when loading profile
      const sidebarNameEl = document.querySelector('.admin-name');
      if (sidebarNameEl && data.displayName) {
        sidebarNameEl.textContent = data.displayName;
      }

    } catch (error) {
      console.error('Load profile error:', error);
      showProfileMessage('Failed to load profile data', 'error');
    }
  }

  // Save profile changes (display name + phone for admin)
  if (saveProfileBtn) {
    saveProfileBtn.addEventListener('click', async function() {
      const displayName = profileDisplayName ? profileDisplayName.value.trim() : '';
      const phone = profilePhone ? profilePhone.value.trim() : '';

      // Validate display name
      if (!displayName || displayName.length < 2) {
        showProfileMessage('Display name must be at least 2 characters', 'error');
        if (profileDisplayName) profileDisplayName.focus();
        return;
      }

      // Validate phone number
      if (phone && !/^9\d{9}$/.test(phone)) {
        showProfileMessage('Please enter a valid 10-digit mobile number starting with 9', 'error');
        if (profilePhone) profilePhone.focus();
        return;
      }

      // Disable button and show loading
      saveProfileBtn.disabled = true;
      const originalText = saveProfileBtn.innerHTML;
      saveProfileBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

      try {
        const data = await apiFetch('/api/admin/profile', {
          method: 'PUT',
          body: JSON.stringify({
            displayName: displayName,
            phone: phone ? `+63${phone}` : null
          })
        });

        if (!data.ok) {
          throw new Error(data.error || 'Failed to update profile');
        }

        showProfileMessage('Profile updated successfully!', 'success');
        
        // Reload to update displayed values
        setTimeout(() => loadProfileData(), 500);

      } catch (error) {
        console.error('Save profile error:', error);
        showProfileMessage(error.message || 'Failed to update profile', 'error');
      } finally {
        saveProfileBtn.disabled = false;
        saveProfileBtn.innerHTML = originalText;
      }
    });
  }

  // Change password
  if (changePasswordBtn) {
    changePasswordBtn.addEventListener('click', async function() {
      const currentPassword = currentPasswordInput ? currentPasswordInput.value.trim() : '';
      const newPassword = newPasswordInput ? newPasswordInput.value.trim() : '';
      const confirmPassword = confirmPasswordInput ? confirmPasswordInput.value.trim() : '';

      // Validate inputs
      if (!currentPassword) {
        showProfileMessage('Please enter your current password', 'error');
        if (currentPasswordInput) currentPasswordInput.focus();
        return;
      }

      if (!newPassword) {
        showProfileMessage('Please enter a new password', 'error');
        if (newPasswordInput) newPasswordInput.focus();
        return;
      }

      if (newPassword.length < 8) {
        showProfileMessage('New password must be at least 8 characters long', 'error');
        if (newPasswordInput) newPasswordInput.focus();
        return;
      }

      if (!/(?=.*[a-zA-Z])(?=.*[0-9])/.test(newPassword)) {
        showProfileMessage('Password must contain both letters and numbers', 'error');
        if (newPasswordInput) newPasswordInput.focus();
        return;
      }

      if (newPassword !== confirmPassword) {
        showProfileMessage('New passwords do not match', 'error');
        if (confirmPasswordInput) confirmPasswordInput.focus();
        return;
      }

      if (currentPassword === newPassword) {
        showProfileMessage('New password must be different from current password', 'error');
        if (newPasswordInput) newPasswordInput.focus();
        return;
      }

      // Disable button and show loading
      changePasswordBtn.disabled = true;
      const originalText = changePasswordBtn.innerHTML;
      changePasswordBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Updating...';

      try {
        const data = await apiFetch('/api/admin/change-password', {
          method: 'POST',
          body: JSON.stringify({
            currentPassword: currentPassword,
            newPassword: newPassword
          })
        });

        if (!data.ok) {
          throw new Error(data.error || 'Failed to change password');
        }

        showProfileMessage('Password changed successfully!', 'success');
        
        // Clear password fields
        if (currentPasswordInput) currentPasswordInput.value = '';
        if (newPasswordInput) newPasswordInput.value = '';
        if (confirmPasswordInput) confirmPasswordInput.value = '';

      } catch (error) {
        console.error('Change password error:', error);
        showProfileMessage(error.message || 'Failed to change password', 'error');
      } finally {
        changePasswordBtn.disabled = false;
        changePasswordBtn.innerHTML = originalText;
      }
    });
  }

  // Show profile message (success/error toast)
  function showProfileMessage(message, type) {
    if (!profileMessage) return;
    
    profileMessage.textContent = message;
    profileMessage.className = 'message-container ' + type;
    profileMessage.style.display = 'flex';

    // Auto-hide after 5 seconds
    setTimeout(function() {
      profileMessage.style.display = 'none';
    }, 5000);
  }
});
