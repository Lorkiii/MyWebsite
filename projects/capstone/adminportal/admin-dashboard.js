// Import Firebase auth and API helper
import { auth } from '../firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { apiFetch } from '../api-fetch.js';

(function(){
  // DASHBOARD DATA FETCHER
  // Fetches real-time data from server endpoint

  let dashboardData = null;
  let isLoading = false;

  // Fetch dashboard data from server using centralized apiFetch
  async function fetchDashboardData() {
    if (isLoading) return;
    
    isLoading = true;
    showLoadingState();

    try {
      console.log('[Dashboard] Fetching dashboard data...');
      
      // Use apiFetch - handles auth automatically
      dashboardData = await apiFetch('/api/admin/dashboard-stats');
      
      console.log('[Dashboard] Data fetched successfully:', dashboardData);
      
      renderDashboard();
      hideLoadingState();
      hideErrorState();
      
    } catch (error) {
      console.error('[Dashboard] Fetch error:', error);
      showErrorState(error.message);
      hideLoadingState();
      renderFallbackData();
    } finally {
      isLoading = false;
    }
  }

  // UI STATE MANAGEMENT
  function showLoadingState() {
    // Update quick stats to show loading
    const statStudent = document.getElementById('stat-total-students');
    const statTeacher = document.getElementById('stat-teacher-apps');
    const statEnroll = document.getElementById('stat-enroll-percent');
    
    if (statStudent) statStudent.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    if (statTeacher) statTeacher.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    if (statEnroll) statEnroll.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
  }

  function hideLoadingState() {
    // Loading indicators will be replaced by actual data
  }

  function showErrorState(message) {
    console.warn('[Dashboard] Error state:', message);
    
    // Show error in the dashboard header
    const dashboardHeader = document.querySelector('.dashboard-header');
    if (!dashboardHeader) return;
    
    // Remove existing error if present
    const existingError = document.getElementById('dashboard-error');
    if (existingError) existingError.remove();
    
    // Create error banner
    const errorBanner = document.createElement('div');
    errorBanner.id = 'dashboard-error';
    errorBanner.style.cssText = 'background: #fee; border: 1px solid #fcc; color: #c33; padding: 10px; border-radius: 6px; margin-bottom: 10px; font-size: 0.9rem;';
    errorBanner.innerHTML = `<strong>⚠️ Error loading dashboard:</strong> ${message}. <a href="#" onclick="location.reload()" style="color: #c33; text-decoration: underline;">Reload page</a>`;
    
    dashboardHeader.insertAdjacentElement('afterend', errorBanner);
  }

  function hideErrorState() {
    // Hide any error messages if they exist
  }

  // ============================================
  // RENDER DASHBOARD WITH REAL DATA
  // ============================================

  function renderDashboard() {
    if (!dashboardData) return;

    renderQuickStats();
    renderEnrollmentStatus();
    renderRecentSubmissions();
    renderRecentActivity();
  }

  // Render Quick Stats Cards (only Total Students and Teacher Applicants)
  function renderQuickStats() {
    const stats = dashboardData.quickStats || {};
    
    // Total Students
    const statStudent = document.getElementById('stat-total-students');
    if (statStudent) {
      statStudent.textContent = (stats.totalStudents || 0).toLocaleString();
    }

    // Teacher Applicants
    const statTeacher = document.getElementById('stat-teacher-apps');
    if (statTeacher) {
      statTeacher.textContent = (stats.teacherApplicants || 0).toLocaleString();
    }

    // Note: Enrollment card removed as per user request
  }

  // Render Enrollment Status (Completed, Pending)
  function renderEnrollmentStatus() {
    const enrollment = dashboardData.enrollmentStatus || {};
    const total = enrollment.total || 0;
    const completed = enrollment.completed || 0;
    const pending = enrollment.pending || 0;

    // Update counts
    const completedEl = document.getElementById('enroll-completed');
    if (completedEl) completedEl.textContent = completed;

    const pendingEl = document.getElementById('enroll-pending');
    if (pendingEl) pendingEl.textContent = pending;

    // Update progress bars
    const denom = Math.max(1, total);
    
    const completedBar = document.getElementById('bar-completed');
    if (completedBar) {
      completedBar.style.width = `${Math.round((completed / denom) * 100)}%`;
    }

    const pendingBar = document.getElementById('bar-pending');
    if (pendingBar) {
      pendingBar.style.width = `${Math.round((pending / denom) * 100)}%`;
    }
  }

  // Render Recent Submissions
  function renderRecentSubmissions() {
    const submissions = dashboardData.recentSubmissions || [];
    const listEl = document.getElementById('recent-submissions-list');
    
    if (!listEl) return;

    if (submissions.length === 0) {
      listEl.innerHTML = '<li class="submission-item empty"><p>No recent submissions</p></li>';
      return;
    }

    listEl.innerHTML = submissions.map(sub => {
      const date = new Date(sub.submittedAt);
      const formattedDate = date.toLocaleDateString();
      const formattedTime = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      
      return `
        <li class="submission-item">
          <div class="submission-left">
            <div class="submission-info">
              <strong>${sub.name}</strong>
              <small>${sub.email}</small>
            </div>
          </div>
          <div class="submission-right">
            <span class="badge badge-${sub.formType.toLowerCase()}">${sub.formType}</span>
            <small class="submission-date">${formattedDate} ${formattedTime}</small>
          </div>
        </li>
      `;
    }).join('');
  }

  // Render Recent Activity (with user column)
  function renderRecentActivity() {
    const activities = dashboardData.recentActivity || [];
    const tbody = document.getElementById('recent-activity-body');
    
    if (!tbody) return;

    if (activities.length === 0) {
      tbody.innerHTML = '<tr><td colspan="3">No recent activity</td></tr>';
      return;
    }

    tbody.innerHTML = activities.map(activity => {
      const date = new Date(activity.date);
      const formattedDate = date.toLocaleDateString();
      const formattedTime = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      
      return `
        <tr>
          <td>${formattedDate} ${formattedTime}</td>
          <td>${activity.activity}</td>
          <td>${activity.user}</td>
        </tr>
      `;
    }).join('');
  }


  // FALLBACK DATA (when fetch fails)

  function renderFallbackData() {
    const statStudent = document.getElementById('stat-total-students');
    if (statStudent) statStudent.textContent = '0';

    const statTeacher = document.getElementById('stat-teacher-apps');
    if (statTeacher) statTeacher.textContent = '0';

    const statEnroll = document.getElementById('stat-enroll-percent');
    if (statEnroll) statEnroll.textContent = '0%';

    const enrollCount = document.getElementById('enroll-count');
    if (enrollCount) enrollCount.textContent = '0 / 200';
  }

  // REFRESH FUNCTIONALITY
  function setupRefreshButton() {
    // Check if refresh button already exists
    let refreshBtn = document.getElementById('dashboard-refresh-btn');
    if (refreshBtn) return; // Already created

    // Create refresh button container above quick stats
    const quickStats = document.querySelector('.quick-stats');
    if (!quickStats) return;

    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = 'display: flex; justify-content: flex-end; margin-bottom: 12px;';
    
    refreshBtn = document.createElement('button');
    refreshBtn.id = 'dashboard-refresh-btn';
    refreshBtn.className = 'refresh-btn';
    refreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Refresh Data';
    refreshBtn.title = 'Refresh dashboard data';
    
    buttonContainer.appendChild(refreshBtn);
    quickStats.parentNode.insertBefore(buttonContainer, quickStats);

    // Add click handler
    refreshBtn.addEventListener('click', async () => {
      refreshBtn.disabled = true;
      refreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Refreshing...';
      
      await fetchDashboardData();
      
      refreshBtn.disabled = false;
      refreshBtn.innerHTML = '<i class="fas fa-sync-alt"></i> Refresh';
    });
  }

//init

  // Wait for Firebase auth to be ready before fetching data
  function initDashboard() {
    // Setup refresh button
    setupRefreshButton();

    // Wait for auth to be ready
    if (auth.currentUser) {
      console.log('[Dashboard] Initializing...');
      fetchDashboardData();
    } else {
      // Wait for auth state to be determined
      const unsubscribe = onAuthStateChanged(auth, (user) => {
        unsubscribe(); // Unsubscribe after first call
        if (user) {
          fetchDashboardData();
        } else {
          console.error('[Dashboard] Authentication required');
          showErrorState('Please log in to view dashboard');
        }
      });
    }
  }

  // Start initialization
  initDashboard();


})();