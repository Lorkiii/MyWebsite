// adminportal/admin-user-management.js
import { apiFetch } from "../api-fetch.js"; // <-- centralized helper; put api-fetch.js at project root or adjust path


// helper
const $ = (s) => document.querySelector(s);

// Super admin gate (populated on init)
let IS_SUPER_ADMIN = false;

// User Management Modal Helper Functions
const userMgmtModals = {
  showOverlay() {
    const overlay = $('#user-mgmt-modal-overlay');
    if (overlay) overlay.style.display = 'block';
  },
  
  hideOverlay() {
    const overlay = $('#user-mgmt-modal-overlay');
    if (overlay) overlay.style.display = 'none';
  },
  
  showModal(modalId) {
    this.showOverlay();
    const modal = $(modalId);
    if (modal) modal.style.display = 'block';
  },
  
  hideModal(modalId) {
    const modal = $(modalId);
    if (modal) modal.style.display = 'none';
    this.hideOverlay();
  },
  
  hideAllModals() {
    ['#user-mgmt-view-modal', '#user-mgmt-edit-modal', '#user-mgmt-confirm-modal', '#user-mgmt-notify-modal', '#um-admin-create-modal', '#um-admin-otp-modal', '#um-admin-success-modal']
      .forEach(id => {
        const modal = $(id);
        if (modal) modal.style.display = 'none';
      });
    this.hideOverlay();
  },
  
  showNotification(title, message) {
    const titleEl = $('#user-mgmt-notify-title');
    const messageEl = $('#user-mgmt-notify-message');
    if (titleEl) titleEl.textContent = title;
    if (messageEl) messageEl.textContent = message;
    this.showModal('#user-mgmt-notify-modal');
  },
  
  showConfirmation(title, message, onConfirm) {
    const titleEl = $('#user-mgmt-confirm-title');
    const messageEl = $('#user-mgmt-confirm-message');
    const confirmBtn = $('#user-mgmt-confirm-modal .user-mgmt-btn-confirm');
    
    if (titleEl) titleEl.textContent = title;
    if (messageEl) messageEl.textContent = message;
    
    // Store the confirm callback
    if (confirmBtn) {
      confirmBtn.onclick = () => {
        this.hideModal('#user-mgmt-confirm-modal');
        if (onConfirm) onConfirm();
      };
    }
    this.showModal('#user-mgmt-confirm-modal');
  }
};

//  Admin creation flow state 
const adminFlow = {
  formData: null,
  lastOtpRequest: 0,
  resendCooldown: 30,
  reset() {
    this.formData = null;
    this.lastOtpRequest = 0;
    const form = $('#um-admin-create-form');
    if (form) form.reset();
    const errorBox = $('#um-admin-create-error');
    if (errorBox) errorBox.textContent = '';
    const otpError = $('#um-admin-otp-error');
    if (otpError) otpError.textContent = '';
    const otpMeta = $('#um-admin-otp-meta');
    if (otpMeta) otpMeta.textContent = '';
    const otpInput = $('#um-admin-otp');
    if (otpInput) otpInput.value = '';
  }
};
// open admin create modal

function openAdminCreate() {
  adminFlow.reset();
  userMgmtModals.hideAllModals();
  userMgmtModals.showModal('#um-admin-create-modal');
}

// Sync all teacher applicant names from user displayNames
async function syncAllTeacherNames() {
  const btn = document.getElementById('sync-teacher-names-btn');
  if (!btn) return;
  
  // Disable button and show loading
  const originalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Syncing...';
  
  try {
    const response = await apiFetch('/admin/users/sync-all-teacher-names', {
      method: 'POST'
    });
    
    if (response.success) {
      userMgmtModals.showNotification('Success', 
        `Sync complete! Updated ${response.synced} records, skipped ${response.skipped} out of ${response.total} total.`);
    } else {
      throw new Error('Sync failed');
    }
  } catch (error) {
    console.error('Sync error:', error);
    userMgmtModals.showNotification('Error', 'Failed to sync teacher names: ' + error.message);
  } finally {
    // Restore button
    btn.disabled = false;
    btn.innerHTML = originalText;
  }
}

// validate phone number
function validatePhilippinePhone(digits) {
  // Must be empty (optional) OR valid PH mobile
  if (!digits) return { valid: true, phone: null }; // Optional - empty is OK
  
  // Check: only digits, starts with 9, exactly 10 digits
  if (!/^9\d{9}$/.test(digits)) {
    return { valid: false, phone: null, error: 'Phone must be 10 digits starting with 9 (e.g., 9123456789)' };
  }
  
  // Return E.164 formatted phone
  return { valid: true, phone: `+63${digits}` };
}

// capture admin form
function captureAdminForm() {
  const name = $('#um-admin-name')?.value.trim();
  const email = $('#um-admin-email')?.value.trim();
  const phoneDigits = $('#um-admin-phone')?.value.trim();
  const grantSuperAdmin = !!document.getElementById('um-admin-make-super')?.checked;
  
  // Validate and format phone
  const phoneValidation = validatePhilippinePhone(phoneDigits);
  return { name, email, phone: phoneValidation.phone, phoneValidation, grantSuperAdmin };
}

// show admin error
function showAdminError(targetId, message) {
  const node = $(targetId);
  if (node) node.textContent = message || '';
}

// lock resend button
function lockResendButton(lock) {
  const resendBtn = $('#um-admin-resend');
  if (resendBtn) resendBtn.disabled = lock;
}

// update otp meta
function updateOtpMeta(text) {
  const meta = $('#um-admin-otp-meta');
  if (meta) meta.textContent = text || '';
}

// handle admin send otp
async function handleAdminSendOtp() {
  const { name, email, phone, phoneValidation, grantSuperAdmin } = captureAdminForm();
  // If granting super admin, require explicit confirmation
  if (grantSuperAdmin) {
    const proceed = confirm('Grant Super Admin privileges? This user will be able to add users, reset passwords, archive and delete accounts.');
    if (!proceed) return;
  }
  if (!name || !email) {
    showAdminError('#um-admin-create-error', 'Name and email are required.');
    return;
  }

  // Validate email must be @gmail.com
  if (!email.endsWith('@gmail.com')) {
    showAdminError('#um-admin-create-error', 'Email must be a Gmail address (@gmail.com)');
    return;
  }

  // Validate phone number format if provided
  if (!phoneValidation.valid) {
    showAdminError('#um-admin-create-error', phoneValidation.error);
    return;
  }
  // send otp
  try {
    showAdminError('#um-admin-create-error', '');
    
    // Check if email is available
    await apiFetch('/admin/create-admin/check-email', {
      method: 'POST',
      body: JSON.stringify({ email })
    });
    
    // Check if phone number is available (only if provided)
    if (phone) {
      await apiFetch('/admin/create-admin/check-phone', {
        method: 'POST',
        body: JSON.stringify({ phoneNumber: phone })
      });
    }
    
    // Send OTP if both checks pass
    const payload = { displayName: name, email, phoneNumber: phone || undefined };
    const res = await apiFetch('/admin/create-admin/send-otp', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    adminFlow.formData = { ...payload, otpRequestId: res.requestId, grantSuperAdmin };
    adminFlow.lastOtpRequest = Date.now();

    $('#um-admin-summary-name').textContent = name;
    $('#um-admin-summary-email').textContent = email;

    updateOtpMeta('OTP sent to the provided email. Code expires in 5 minutes.');
    lockResendButton(true);
    setTimeout(() => lockResendButton(false), adminFlow.resendCooldown * 1000);

    userMgmtModals.hideAllModals();
    userMgmtModals.showModal('#um-admin-otp-modal');
  } catch (err) {
    console.error(err);
    const message = err?.body?.error
      || err?.body?.message
      || err?.message
      || 'Failed to send OTP.';
    showAdminError('#um-admin-create-error', message);
  }
}

// handle admin resend otp
async function handleAdminResendOtp() {
  if (!adminFlow.formData) return;
  const now = Date.now();
  if (now - adminFlow.lastOtpRequest < adminFlow.resendCooldown * 1000) {
    const remaining = Math.ceil((adminFlow.resendCooldown * 1000 - (now - adminFlow.lastOtpRequest)) / 1000);
    updateOtpMeta(`Please wait ${remaining}s before resending.`);
    return;
  }
  // resend otp
  try {
    lockResendButton(true);
    updateOtpMeta('Sending new OTP...');
    const { displayName, email, phoneNumber } = adminFlow.formData;
    const res = await apiFetch('/admin/create-admin/send-otp', {
      method: 'POST',
      body: JSON.stringify({ displayName, email, phoneNumber, resend: true })
    });

    adminFlow.formData.otpRequestId = res.requestId;
    adminFlow.lastOtpRequest = Date.now();
    // update otp 
    updateOtpMeta('New OTP sent. Code expires in 5 minutes.');
    showAdminError('#um-admin-otp-error', '');
    setTimeout(() => lockResendButton(false), adminFlow.resendCooldown * 1000);
  } catch (err) {
    console.error(err);
    updateOtpMeta('');
    lockResendButton(false);
    showAdminError('#um-admin-otp-error', err.message || 'Failed to resend OTP.');
  }
}

// handle admin verify otp
async function handleAdminVerifyOtp() {
  if (!adminFlow.formData) {
    showAdminError('#um-admin-otp-error', 'Start the process again.');
    return;
  }

  const otp = $('#um-admin-otp')?.value.trim();
  if (!otp || otp.length !== 6) {
    showAdminError('#um-admin-otp-error', 'Enter the 6-digit OTP sent to the email.');
    return;
  }

  try {
    showAdminError('#um-admin-otp-error', '');
    updateOtpMeta('Verifying OTP...');

    const res = await apiFetch('/admin/create-admin/verify-otp', {
      method: 'POST',
      body: JSON.stringify({
        otp,
        requestId: adminFlow.formData.otpRequestId,
        displayName: adminFlow.formData.displayName,
        email: adminFlow.formData.email,
        phoneNumber: adminFlow.formData.phoneNumber,
        grantSuperAdmin: !!adminFlow.formData.grantSuperAdmin
      })
    });

    updateOtpMeta('');
    // show success modal
    $('#um-admin-success-email').textContent = res.email || adminFlow.formData.email;

    userMgmtModals.hideAllModals();
    userMgmtModals.showModal('#um-admin-success-modal');

    await loadUsers();
  } catch (err) {
    console.error(err);
    updateOtpMeta('');
    showAdminError('#um-admin-otp-error', err.message || 'Failed to verify OTP.');
  }
}
 
// Initialize modal event listeners
function initUserMgmtModals() {
  // Close buttons
  document.querySelectorAll('.user-mgmt-modal-close').forEach(btn => {
    btn.addEventListener('click', () => userMgmtModals.hideAllModals());
  });
  
  // Cancel buttons
  document.querySelectorAll('.user-mgmt-btn-cancel').forEach(btn => {
    btn.addEventListener('click', () => userMgmtModals.hideAllModals());
  });
  
  // OK button
  const okBtn = $('#user-mgmt-notify-modal .user-mgmt-btn-ok');
  if (okBtn) {
    okBtn.addEventListener('click', () => userMgmtModals.hideModal('#user-mgmt-notify-modal'));
  }
  
  // Overlay click to close
  const overlay = $('#user-mgmt-modal-overlay');
  if (overlay) {
    overlay.addEventListener('click', () => userMgmtModals.hideAllModals());
  }
  
  // Save button for edit modal
  const saveBtn = $('#user-mgmt-edit-modal .user-mgmt-btn-save');
  if (saveBtn) {
    saveBtn.addEventListener('click', handleUserEditSave);
  }

  // Admin creation triggers
  const addUserBtn = document.querySelector('.btn-add-user');
  if (addUserBtn) addUserBtn.addEventListener('click', openAdminCreate);
  // otp buttons
  const sendOtpBtn = $('#um-admin-send-otp');
  if (sendOtpBtn) sendOtpBtn.addEventListener('click', handleAdminSendOtp);
  // verify otp button
  const verifyBtn = $('#um-admin-verify');
  if (verifyBtn) verifyBtn.addEventListener('click', handleAdminVerifyOtp);
  // resend otp button
  const resendBtn = $('#um-admin-resend');
  if (resendBtn) resendBtn.addEventListener('click', handleAdminResendOtp);
  // done button
  const doneBtn = $('#um-admin-done');
  if (doneBtn) doneBtn.addEventListener('click', () => {
    adminFlow.reset();
    userMgmtModals.hideAllModals();
  });
}

// Handle edit form save
async function handleUserEditSave() {
  const uid = $('#user-mgmt-edit-id').value;
  const displayName = $('#user-mgmt-edit-name').value;
  // validate display name
  if (!displayName.trim()) {
    userMgmtModals.showNotification('Error', 'Display name is required');
    return;
  }
  // update user
  try {
    await apiFetch(`/admin/users/${encodeURIComponent(uid)}`, {
      method: 'PUT',
      body: JSON.stringify({ displayName: displayName.trim() })
    });
    // show success modal with sync note
    userMgmtModals.hideModal('#user-mgmt-edit-modal');
    userMgmtModals.showNotification('Success', 'User updated successfully. Teacher applicant name synced if applicable.');
    // Reload current tab
    reloadCurrentTab();
  } catch (err) {
    console.error(err);
    userMgmtModals.showNotification('Error', 'Update failed: ' + (err.message || err));
  }
}

// timestamp formatting helper
function safeFormatTimestamp(ts) {
  if (!ts) return "-";
  if (ts instanceof Date) return ts.toLocaleString();
  if (typeof ts === "string") {
    const d = new Date(ts);
    return isNaN(d.getTime()) ? ts : d.toLocaleString();
  }
  const seconds = ts.seconds ?? ts._seconds;
  if (typeof seconds === "number") return new Date(seconds * 1000).toLocaleString();
  return String(ts);
}

// Build table row from HTML template (much simpler!)
// Context can be 'active' or 'archived' to show different action buttons
function buildUserRow(u, context = 'active') {
  // 1. Clone the template (preserves all HTML structure and accessibility)
  const template = document.querySelector('#user-row-template');
  const clone = template.content.cloneNode(true);
  const tr = clone.querySelector('tr');
  
  // 2. Populate user data (safe - uses textContent, no XSS risk)
  tr.dataset.userId = u.uid;
  tr.dataset.userStatus = context === 'archived' ? 'archived' : 'active';
  tr.dataset.phone = u.phoneNumber || '';
  
  clone.querySelector('.user-name').textContent = u.displayName || '-';
  clone.querySelector('.user-meta').textContent = u.customId || '';
  clone.querySelector('.email-cell').textContent = u.email || '-';
  
  // 3. Set role badge
  const badge = clone.querySelector('.badge');
  badge.textContent = u.role || 'applicant';
  badge.className = 'badge ' + (u.role === 'admin' ? 'badge-admin' : 'badge-applicant');
  
  // 4. Set created date
  clone.querySelector('.created-cell').textContent = safeFormatTimestamp(u.createdAt);
  
  // 5. Show/hide buttons based on context
  if (context === 'archived') {
    // ARCHIVED USERS: Show View, Unarchive, Delete
    clone.querySelector('.btn-edit').style.display = 'none';
    clone.querySelector('.btn-reset').style.display = 'none';
    clone.querySelector('.btn-unarchive').style.display = 'inline-block';
    clone.querySelector('.btn-archive').style.display = 'none';
    clone.querySelector('.btn-unarchive-dropdown').style.display = 'block';
    
    // Mobile menu
    clone.querySelector('.mobile-edit').style.display = 'none';
    clone.querySelector('.mobile-reset').style.display = 'none';
    clone.querySelector('.mobile-archive').style.display = 'none';
    clone.querySelector('.mobile-unarchive').style.display = 'block';
    // Delete: only super admins
    const delBtnA = clone.querySelector('.btn-delete');
    if (delBtnA) delBtnA.style.display = IS_SUPER_ADMIN ? 'block' : 'none';
    const delMobA = clone.querySelector('.mobile-delete');
    if (delMobA) delMobA.style.display = IS_SUPER_ADMIN ? 'block' : 'none';
  } else {
    // ACTIVE USERS: Show View, Edit, Reset, Archive, Delete
    clone.querySelector('.btn-edit').style.display = 'inline-block';
    // Hide sensitive actions for non-super admins
    clone.querySelector('.btn-reset').style.display = IS_SUPER_ADMIN ? 'inline-block' : 'none';
    clone.querySelector('.btn-unarchive').style.display = 'none';
    clone.querySelector('.btn-archive').style.display = IS_SUPER_ADMIN ? 'block' : 'none';
    clone.querySelector('.btn-unarchive-dropdown').style.display = 'none';
    
    // Mobile menu
    clone.querySelector('.mobile-edit').style.display = 'block';
    clone.querySelector('.mobile-reset').style.display = IS_SUPER_ADMIN ? 'block' : 'none';
    clone.querySelector('.mobile-archive').style.display = IS_SUPER_ADMIN ? 'block' : 'none';
    clone.querySelector('.mobile-unarchive').style.display = 'none';
    // Delete: only super admins
    const delBtn = clone.querySelector('.btn-delete');
    if (delBtn) delBtn.style.display = IS_SUPER_ADMIN ? 'block' : 'none';
    const delMob = clone.querySelector('.mobile-delete');
    if (delMob) delMob.style.display = IS_SUPER_ADMIN ? 'block' : 'none';
  }

  // Remove desktop "more" dropdown and mobile ellipsis for non–super admins
  if (!IS_SUPER_ADMIN) {
    const dd = clone.querySelector('.action-dropdown');
    if (dd) dd.style.display = 'none';
    const mobileWrap = clone.querySelector('.actions-collapse');
    if (mobileWrap) mobileWrap.style.display = 'none';
  }
  
  return tr;
}

// Helper: Get current active tab and reload its data
function reloadCurrentTab() {
  const activeTab = document.querySelector('.user-management-tabs .tab-btn.active');
  if (!activeTab) {
    loadUsers(); // Default to active users
    return;
  }
  
  const tabName = activeTab.getAttribute('data-tab');
  if (tabName === 'accounts') {
    loadUsers();
  } else if (tabName === 'archived') {
    loadArchivedUsers();
  } else if (tabName === 'activity') {
    loadActivityLogs();
  }
}

// Load ACTIVE users only (non-archived) and display in User Accounts tab
async function loadUsers() {
  const tbody = document.querySelector('#users-tbody');
  if (!tbody) return;
  tbody.innerHTML = ''; // clear
  
  // Show loading row
  const loadingRow = document.createElement('tr');
  const loadingTd = document.createElement('td');
  loadingTd.colSpan = 6;
  loadingTd.textContent = 'Loading...';
  loadingRow.appendChild(loadingTd);
  tbody.appendChild(loadingRow);

  try {
    const { users } = await apiFetch('/admin/users');
    tbody.innerHTML = '';
    
    // Filter out archived users - show only active users
    const activeUsers = users.filter(u => !u.archived);
    
    if (!activeUsers || activeUsers.length === 0) {
      const r = document.createElement('tr');
      const c = document.createElement('td');
      c.colSpan = 6;
      c.textContent = 'No active users found.';
      r.appendChild(c);
      tbody.appendChild(r);
      return;
    }
    
    // Build rows with 'active' context
    activeUsers.forEach(u => {
      const tr = buildUserRow(u, 'active');
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error(err);
    tbody.innerHTML = '';
    const r = document.createElement('tr');
    const c = document.createElement('td');
    c.colSpan = 6;
    c.textContent = 'Failed to load users';
    r.appendChild(c);
    tbody.appendChild(r);
    userMgmtModals.showNotification('Error', 'Failed to load users: ' + (err.message || err));
  }
}

// Load ARCHIVED users only and display in Archived tab
async function loadArchivedUsers() {
  // Target the archived users tbody (not the active users tbody!)
  const tbody = document.querySelector('#archived-users-tbody');
  if (!tbody) return;
  tbody.innerHTML = ''; // clear
  
  // Show loading row
  const loadingRow = document.createElement('tr');
  const loadingTd = document.createElement('td');
  loadingTd.colSpan = 6;
  loadingTd.textContent = 'Loading archived users...';
  loadingRow.appendChild(loadingTd);
  tbody.appendChild(loadingRow);

  try {
    const { users } = await apiFetch('/admin/users');
    tbody.innerHTML = '';
    
    // Filter only archived users
    const archivedUsers = users.filter(u => u.archived);
    
    if (!archivedUsers || archivedUsers.length === 0) {
      const r = document.createElement('tr');
      const c = document.createElement('td');
      c.colSpan = 6;
      c.textContent = 'No archived users found.';
      r.appendChild(c);
      tbody.appendChild(r);
      return;
    }
    
    // Build rows with 'archived' context
    archivedUsers.forEach(u => {
      const tr = buildUserRow(u, 'archived');
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error(err);
    tbody.innerHTML = '';
    const r = document.createElement('tr');
    const c = document.createElement('td');
    c.colSpan = 6;
    c.textContent = 'Failed to load archived users';
    r.appendChild(c);
    tbody.appendChild(r);
    userMgmtModals.showNotification('Error', 'Failed to load archived users: ' + (err.message || err));
  }
}

// Open view modal with user details
function openUserViewModal(uid, tr) {
  const userName = tr.querySelector('.user-name')?.textContent || '-';
  const userEmail = tr.querySelector('.email-cell')?.textContent || '-';
  const userRole = tr.querySelector('.role-cell .badge')?.textContent || '-';
  const userCreated = tr.querySelector('.created-cell')?.textContent || '-';
  const userPhone = tr.dataset.phone || '';
  
  $('#user-mgmt-view-name').textContent = userName;
  $('#user-mgmt-view-email').textContent = userEmail;
  $('#user-mgmt-view-phone').textContent = userPhone || 'Not set';
  $('#user-mgmt-view-role').textContent = userRole;
  $('#user-mgmt-view-created').textContent = userCreated;
  $('#user-mgmt-view-id').textContent = uid;
  
  userMgmtModals.showModal('#user-mgmt-view-modal');
}

// Open edit modal with user details
function openUserEditModal(uid, tr) {
  const userName = tr.querySelector('.user-name')?.textContent || '';
  const userRole = tr.querySelector('.role-cell .badge')?.textContent?.trim() || 'applicant';

  $('#user-mgmt-edit-id').value = uid;
  $('#user-mgmt-edit-name').value = userName;
  const roleDisplay = $('#user-mgmt-edit-role-text');
  if (roleDisplay) roleDisplay.textContent = userRole;
  
  userMgmtModals.showModal('#user-mgmt-edit-modal');
}

// event delegation for clicks - uses data-action attributes
async function handleTableClick(e) {
  const btn = e.target.closest('button');
  if (!btn) return;
  
  const action = btn.dataset.action;
  const tr = btn.closest('tr');
  const uid = tr?.dataset?.userId;
  if (!uid) return;

  switch(action) {
    case 'view':
      openUserViewModal(uid, tr);
      break;
      
    case 'edit':
      openUserEditModal(uid, tr);
      break;
      
    case 'reset-password':
      if (!IS_SUPER_ADMIN) {
        userMgmtModals.showNotification('Forbidden', 'Only super admins can perform this action.');
        return;
      }
      userMgmtModals.showConfirmation(
        'Reset Password',
        'Are you sure you want to reset the password for this user?',
        async () => {
          try {
            const res = await apiFetch('/admin/reset-password', {
              method: 'POST',
              body: JSON.stringify({ uid, notifyUser: true })
            });
            if (res.emailed) {
              userMgmtModals.showNotification('Success', 'Password reset link emailed to the user.');
            } else {
              userMgmtModals.showNotification('Success', 'Password reset link generated.');
            }
          } catch (err) {
            console.error(err);
            userMgmtModals.showNotification('Error', 'Reset failed: ' + (err.message || err));
          }
        }
      );
      break;
      
    case 'archive':
      if (!IS_SUPER_ADMIN) {
        userMgmtModals.showNotification('Forbidden', 'Only super admins can perform this action.');
        return;
      }
      userMgmtModals.showConfirmation(
        'Archive User',
        'Are you sure you want to archive this user? You can unarchive them later.',
        async () => {
          try {
            await apiFetch(`/admin/users/${encodeURIComponent(uid)}/archive`, { method: 'POST' });
            userMgmtModals.showNotification('Success', 'User archived successfully');
            // Reload current tab (removes user from active list)
            reloadCurrentTab();
          } catch (err) {
            console.error(err);
            userMgmtModals.showNotification('Error', 'Archive failed: ' + (err.message || err));
          }
        }
      );
      break;
      
    case 'unarchive':
      if (!IS_SUPER_ADMIN) {
        userMgmtModals.showNotification('Forbidden', 'Only super admins can perform this action.');
        return;
      }
      // Unarchive user - restore them to active status
      userMgmtModals.showConfirmation(
        'Unarchive User',
        'Are you sure you want to restore this user to active status?',
        async () => {
          try {
            await apiFetch(`/admin/users/${encodeURIComponent(uid)}/unarchive`, { method: 'POST' });
            userMgmtModals.showNotification('Success', 'User unarchived successfully');
            // Reload current tab (removes user from archived list)
            reloadCurrentTab();
          } catch (err) {
            console.error(err);
            userMgmtModals.showNotification('Error', 'Unarchive failed: ' + (err.message || err));
          }
        }
      );
      break;
      
    case 'delete':
      if (!IS_SUPER_ADMIN) {
        userMgmtModals.showNotification('Forbidden', 'Only super admins can perform this action.');
        return;
      }
      userMgmtModals.showConfirmation(
        'Delete User',
        'WARNING: This will PERMANENTLY DELETE this user. This action cannot be undone. Are you sure?',
        async () => {
          try {
            await apiFetch(`/admin/users/${encodeURIComponent(uid)}`, { method: 'DELETE' });
            userMgmtModals.showNotification('Success', 'User deleted successfully');
            // Reload current tab
            reloadCurrentTab();
          } catch (err) {
            console.error(err);
            userMgmtModals.showNotification('Error', 'Delete failed: ' + (err.message || err));
          }
        }
      );
      break;
      
    default:
      // Handle cases with no data-action (e.g., using classes)
      if (!IS_SUPER_ADMIN && (btn.classList.contains('btn-reset') || btn.classList.contains('btn-archive') || btn.classList.contains('btn-unarchive') || btn.classList.contains('btn-delete') || btn.classList.contains('mobile-reset') || btn.classList.contains('mobile-archive') || btn.classList.contains('mobile-unarchive'))) {
        userMgmtModals.showNotification('Forbidden', 'Only super admins can perform this action.');
        return;
      }
      if (btn.classList.contains('btn-reset')) {
        userMgmtModals.showConfirmation(
          'Reset Password',
          'Are you sure you want to reset the password for this user?',
          async () => {
            try {
              const res = await apiFetch('/admin/reset-password', {
                method: 'POST',
                body: JSON.stringify({ uid, notifyUser: true })
              });
              if (res.emailed) {
                userMgmtModals.showNotification('Success', 'Password reset link emailed to the user.');
              } else {
                userMgmtModals.showNotification('Success', 'Password reset link generated.');
              }
            } catch (err) {
              console.error(err);
              userMgmtModals.showNotification('Error', 'Reset failed: ' + (err.message || err));
            }
          }
        );
      } else if (btn.classList.contains('btn-view')) {
        openUserViewModal(uid, tr);
      } else if (btn.classList.contains('btn-edit')) {
        openUserEditModal(uid, tr);
      } 
      else if (btn.classList.contains('btn-archive')) {
        userMgmtModals.showConfirmation(
          'Archive User',
          'Are you sure you want to archive this user? You can unarchive them later.',
          async () => {
            try {
              await apiFetch(`/admin/users/${encodeURIComponent(uid)}/archive`, { method: 'POST' });
              userMgmtModals.showNotification('Success', 'User archived successfully');
              // Reload current tab
              reloadCurrentTab();
            } catch (err) {
              console.error(err);
              userMgmtModals.showNotification('Error', 'Archive failed: ' + (err.message || err));
            }
          }
        );
      } else if (btn.classList.contains('btn-unarchive')) {
        // Unarchive button handler
        userMgmtModals.showConfirmation(
          'Unarchive User',
          'Are you sure you want to restore this user to active status?',
          async () => {
            try {
              await apiFetch(`/admin/users/${encodeURIComponent(uid)}/unarchive`, { method: 'POST' });
              userMgmtModals.showNotification('Success', 'User unarchived successfully');
              // Reload current tab
              reloadCurrentTab();
            } catch (err) {
              console.error(err);
              userMgmtModals.showNotification('Error', 'Unarchive failed: ' + (err.message || err));
            }
          }
        );
      } else if (btn.classList.contains('btn-delete')) {
        userMgmtModals.showConfirmation(
          'Delete User',
          'WARNING: This will PERMANENTLY DELETE this user. This action cannot be undone. Are you sure?',
          async () => {
            try {
              await apiFetch(`/admin/users/${encodeURIComponent(uid)}`, { method: 'DELETE' });
              userMgmtModals.showNotification('Success', 'User deleted successfully');
              // Reload current tab
              reloadCurrentTab();
            } catch (err) {
              console.error(err);
              userMgmtModals.showNotification('Error', 'Delete failed: ' + (err.message || err));
            }
          }
        );
      }
      break;
  }
}

/* ========== ACTIVITY LOG FUNCTIONS ========== */

// Action icon mapping
const ACTION_ICONS = {
  'create-admin': 'fas fa-user-plus',
  'update-user': 'fas fa-user-edit',
  'archive-user': 'fas fa-archive',
  'unarchive-user': 'fas fa-undo',
  'delete-user': 'fas fa-trash-alt',
  'reset-password': 'fas fa-key',
  'send-admin-otp': 'fas fa-envelope',
  'send-message': 'fas fa-paper-plane',
  'clear-force-password': 'fas fa-unlock',
  'default': 'fas fa-info-circle'
};

// Action label mapping
const ACTION_LABELS = {
  'create-admin': 'created admin account',
  'update-user': 'updated user profile',
  'archive-user': 'archived user',
  'unarchive-user': 'restored user',
  'delete-user': 'deleted user',
  'reset-password': 'reset password',
  'send-admin-otp': 'sent admin OTP',
  'send-message': 'sent message',
  'clear-force-password': 'cleared password change requirement',
  'default': 'performed action'
};

// Get icon class for action
function getActionIcon(action) {
  return ACTION_ICONS[action] || ACTION_ICONS.default;
}

// Get icon modifier class for action
function getIconClass(action) {
  if (action.includes('create') || action.includes('admin-otp')) return 'log-icon-create';
  if (action.includes('update') || action.includes('edit')) return 'log-icon-update';
  if (action.includes('delete')) return 'log-icon-delete';
  if (action.includes('archive')) return 'log-icon-archive';
  return '';
}

// Get friendly label for action
function getActionLabel(action) {
  return ACTION_LABELS[action] || ACTION_LABELS.default;
}

// Format Firestore timestamp
function formatActivityTimestamp(ts) {
  if (!ts) return 'Unknown time';
  
  const seconds = ts._seconds || ts.seconds;
  if (!seconds) return 'Unknown time';
  
  const date = new Date(seconds * 1000);
  const now = new Date();
  const diff = now - date;
  
  // Less than 1 minute
  if (diff < 60000) return 'Just now';
  
  // Less than 1 hour
  if (diff < 3600000) {
    const mins = Math.floor(diff / 60000);
    return `${mins} minute${mins > 1 ? 's' : ''} ago`;
  }
  
  // Less than 24 hours (today)
  if (diff < 86400000 && date.getDate() === now.getDate()) {
    return `Today, ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  }
  
  // Yesterday
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.getDate() === yesterday.getDate() && date.getMonth() === yesterday.getMonth()) {
    return `Yesterday, ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  }
  
  // Older
  return date.toLocaleString('en-US', { 
    month: 'short', 
    day: 'numeric', 
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    hour: 'numeric', 
    minute: '2-digit' 
  });
}

// Fetch activity logs from server
async function fetchActivityLogs(limit = 50) {
  try {
    const response = await apiFetch(`/admin/activity-logs?limit=${limit}`);
    return response.items || [];
  } catch (error) {
    console.error('Failed to fetch activity logs:', error);
    throw error;
  }
}

// Render activity logs to UI
function renderActivityLogs(logs) {
  const container = $('#activity-log-container');
  const loadingState = container.querySelector('.activity-log-loading');
  const emptyState = container.querySelector('.activity-log-empty');
  const errorState = container.querySelector('.activity-log-error');
  const logList = container.querySelector('.activity-log-list');
  
  // Hide all states
  loadingState.style.display = 'none';
  emptyState.style.display = 'none';
  errorState.style.display = 'none';
  
  // Check if empty
  if (!logs || logs.length === 0) {
    emptyState.style.display = 'flex';
    logList.innerHTML = '';
    return;
  }
  
  // Render logs
  logList.innerHTML = '';
  logs.forEach(log => {
    const entry = document.createElement('div');
    entry.className = 'log-entry';
    
    // Icon
    const iconDiv = document.createElement('div');
    iconDiv.className = `log-icon ${getIconClass(log.action)}`;
    const icon = document.createElement('i');
    icon.className = getActionIcon(log.action);
    iconDiv.appendChild(icon);
    
    // Details
    const detailsDiv = document.createElement('div');
    detailsDiv.className = 'log-details';
    
    // Message
    const messageDiv = document.createElement('div');
    messageDiv.className = 'log-message';
    // Use actorName (already stored in log) - Simple and fast!
    const actorName = log.actorName || log.actorEmail || 'System';
    messageDiv.textContent = `${actorName} ${getActionLabel(log.action)}`;
    
    // Meta (time + detail)
    const metaDiv = document.createElement('div');
    metaDiv.className = 'log-meta';
    
    const timeSpan = document.createElement('span');
    timeSpan.className = 'log-time';
    timeSpan.textContent = formatActivityTimestamp(log.timestamp);
    metaDiv.appendChild(timeSpan);
    
    if (log.detail) {
      const detailSpan = document.createElement('span');
      detailSpan.className = 'log-detail';
      detailSpan.textContent = log.detail;
      metaDiv.appendChild(detailSpan);
    }
    
    detailsDiv.appendChild(messageDiv);
    detailsDiv.appendChild(metaDiv);
    
    entry.appendChild(iconDiv);
    entry.appendChild(detailsDiv);
    logList.appendChild(entry);
  });
}

// Show loading state
function showActivityLoading() {
  const container = $('#activity-log-container');
  const loadingState = container.querySelector('.activity-log-loading');
  const emptyState = container.querySelector('.activity-log-empty');
  const errorState = container.querySelector('.activity-log-error');
  const logList = container.querySelector('.activity-log-list');
  
  loadingState.style.display = 'flex';
  emptyState.style.display = 'none';
  errorState.style.display = 'none';
  logList.innerHTML = '';
}

// Show error state
function showActivityError(message = 'Failed to load activity logs.') {
  const container = $('#activity-log-container');
  const loadingState = container.querySelector('.activity-log-loading');
  const emptyState = container.querySelector('.activity-log-empty');
  const errorState = container.querySelector('.activity-log-error');
  const errorMessage = errorState.querySelector('.error-message');
  const logList = container.querySelector('.activity-log-list');
  
  loadingState.style.display = 'none';
  emptyState.style.display = 'none';
  errorState.style.display = 'flex';
  errorMessage.textContent = message;
  logList.innerHTML = '';
}

// Load and display activity logs
async function loadActivityLogs() {
  const limitSelect = $('#activity-limit');
  const limit = limitSelect ? parseInt(limitSelect.value) : 50;
  
  showActivityLoading();
  
  try {
    const logs = await fetchActivityLogs(limit);
    renderActivityLogs(logs);
  } catch (error) {
    showActivityError(error.message || 'Failed to load activity logs.');
  }
}

// Handle refresh button click
async function handleRefreshLogs() {
  await loadActivityLogs();
}

// Handle limit change
async function handleLimitChange() {
  await loadActivityLogs();
}

// Handle toggle change
async function handleToggleChange(event) {
  const isChecked = event.target.checked;
  const manualCleanBtn = $('#btn-manual-clean');
  
  // Update UI immediately
  if (manualCleanBtn) {
    manualCleanBtn.style.display = isChecked ? 'none' : 'flex';
  }
  
  // Save to server
  try {
    await apiFetch('/admin/activity-logs/settings', {
      method: 'PATCH',
      body: JSON.stringify({ autoCleanEnabled: isChecked })
    });
   
  } catch (error) {
    console.error('Failed to save toggle state:', error);
    // Revert toggle on error
    event.target.checked = !isChecked;
    if (manualCleanBtn) {
      manualCleanBtn.style.display = !isChecked ? 'none' : 'flex';
    }
    alert('Failed to save settings: ' + (error.message || 'Unknown error'));
  }
}

// Handle manual clean button click
async function handleManualClean() {
  try {
    // Fetch count of old logs
    const countResponse = await apiFetch('/admin/activity-logs/count-old?days=90');
    const count = countResponse.count || 0;
    
    if (count === 0) {
      alert('No logs older than 90 days found.');
      return;
    }
    
    // Show confirmation with count
    const confirmed = confirm(
      `Delete ${count} activity log${count > 1 ? 's' : ''} older than 90 days?\n\n` +
      'This action cannot be undone.'
    );
    
    if (!confirmed) return;
    
    // Call cleanup endpoint
    const response = await apiFetch('/admin/activity-logs/cleanup', {
      method: 'POST',
      body: JSON.stringify({ retentionDays: 90 })
    });
    
    alert(response.message || `Successfully deleted ${response.deleted} logs.`);
    
    // Reload logs to reflect changes
    await loadActivityLogs();
  } catch (error) {
    console.error('Cleanup failed:', error);
    alert('Failed to clean logs: ' + (error.message || 'Unknown error'));
  }
}

/* ========== TAB SWITCHING ========== */

// Switch between User Accounts, Activity Log, and Archived tabs
function initTabSwitching() {
  const tabButtons = document.querySelectorAll('.user-management-tabs .tab-btn');
  const tabContents = document.querySelectorAll('.user-management-tabs .tab-content');
  
  if (!tabButtons.length || !tabContents.length) return;
  
  tabButtons.forEach(button => {
    button.addEventListener('click', () => {
      const targetTab = button.getAttribute('data-tab');
      
      // Remove active class from all buttons and contents
      tabButtons.forEach(btn => btn.classList.remove('active'));
      tabContents.forEach(content => content.classList.remove('active'));
      
      // Add active class to clicked button
      button.classList.add('active');
      
      // Show corresponding content
      const targetContent = document.getElementById(targetTab);
      if (targetContent) {
        targetContent.classList.add('active');
      }
      
      // Load appropriate data based on tab
      if (targetTab === 'accounts') {
        // Load active users (non-archived)
        loadUsers();
      } else if (targetTab === 'archived') {
        // Load archived users only
        loadArchivedUsers();
      } else if (targetTab === 'activity') {
        // Load activity logs
        loadActivityLogs();
      }
    });
  });
}

// Load toggle state from server
async function loadActivitySettings() {
  try {
    const settings = await apiFetch('/admin/activity-logs/settings');
    const toggleInput = $('#auto-clean-toggle');
    const manualCleanBtn = $('#btn-manual-clean');
    
    if (toggleInput && settings) {
      toggleInput.checked = settings.autoCleanEnabled || false;
      
      // Update button visibility
      if (manualCleanBtn) {
        manualCleanBtn.style.display = settings.autoCleanEnabled ? 'none' : 'flex';
      }
    }
  } catch (error) {
    console.error('Failed to load activity log settings:', error);
    // Keep default state (toggle OFF, button visible)
  }
}

// Initialize activity log UI
function initActivityLog() {
  // Toggle switch
  const toggleInput = $('#auto-clean-toggle');
  if (toggleInput) {
    toggleInput.addEventListener('change', handleToggleChange);
  }
  
  // Manual clean button
  const manualCleanBtn = $('#btn-manual-clean');
  if (manualCleanBtn) {
    manualCleanBtn.addEventListener('click', handleManualClean);
  }
  
  // Refresh button
  const refreshBtn = $('#btn-refresh-logs');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', handleRefreshLogs);
  }
  
  // Limit selector
  const limitSelect = $('#activity-limit');
  if (limitSelect) {
    limitSelect.addEventListener('change', handleLimitChange);
  }
  
  // Retry button
  const retryBtn = document.querySelector('.btn-retry');
  if (retryBtn) {
    retryBtn.addEventListener('click', handleRefreshLogs);
  }
  
  // Load settings and logs on init
  loadActivitySettings();
  loadActivityLogs();
}

/* ========== DROPDOWN AUTO-CLOSE ========== */

// Close dropdowns and mobile menus when clicking outside
function initDropdownAutoClose() {
  document.addEventListener('click', (e) => {
    // Find all open dropdown details elements (desktop and mobile)
    const openDropdowns = document.querySelectorAll('.dropdown-details[open], .mobile-actions[open]');
    
    openDropdowns.forEach(dropdown => {
      // Check if the click was outside this dropdown/menu
      if (!dropdown.contains(e.target)) {
        // Close the dropdown/menu by removing the 'open' attribute
        dropdown.removeAttribute('open');
      }
    });
  });
}

// init
document.addEventListener('DOMContentLoaded', () => {
  // Determine super admin from server
  (async () => {
    try {
      const me = await apiFetch('/auth/validate');
      IS_SUPER_ADMIN = !!(me && me.isSuperAdmin);
    } catch (e) {
      IS_SUPER_ADMIN = false;
    }
    // Gate top-level controls immediately
    const addUserBtn = document.querySelector('.btn-add-user');
    if (addUserBtn) addUserBtn.style.display = IS_SUPER_ADMIN ? 'inline-flex' : 'none';
    // Hide Archived tab for non-super
    const archivedTabBtn = document.querySelector('.user-management-tabs .tab-btn[data-tab="archived"]');
    if (archivedTabBtn && !IS_SUPER_ADMIN) archivedTabBtn.style.display = 'none';
  })();
  // Get both table bodies (active and archived)
  const tbody = document.querySelector('#users-tbody');
  const archivedTbody = document.querySelector('#archived-users-tbody');
  
  if (!tbody) return;
  
  // Initialize modal system
  initUserMgmtModals();
  
  // Add event delegation for BOTH tables (active and archived)
  // This ensures buttons work in both tabs
  tbody.addEventListener('click', handleTableClick);
  if (archivedTbody) {
    archivedTbody.addEventListener('click', handleTableClick);
  }
  
  // Load users on init
  loadUsers();
  
  // Initialize tab switching
  initTabSwitching();
  
  // Initialize activity log
  initActivityLog();
  
  // Add sync button listener
  const syncBtn = document.getElementById('sync-teacher-names-btn');
  if (syncBtn) {
    syncBtn.addEventListener('click', syncAllTeacherNames);
  }
  
  // Initialize dropdown auto-close
  initDropdownAutoClose();
});
