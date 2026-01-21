// adminportal/admin-announcement.js
// Handles announcement and news CRUD operations with backend API

import { apiFetch } from '../api-fetch.js';
(function () {
  'use strict';

  // Utility: Escape HTML to prevent XSS
  function escapeHtml(s) { 
    return String(s||'').replace(/[&<>"']/g, m=>({ 
      "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" 
    }[m])); 
  }

  // ALERT & CONFIRM MODAL UTILITIES

  // Show simple alert modal (replaces browser alert)
  function showAlert(message, type = 'success') {
    const modal = document.getElementById('alert-modal');
    const icon = document.getElementById('alert-icon');
    const messageEl = document.getElementById('alert-message');
    
    // Set icon based on type
    const icons = {
      success: '✅',
      error: '❌',
      warning: '⚠️',
      info: 'ℹ️'
    };
    icon.textContent = icons[type] || icons.info;
    
    // Set message
    messageEl.textContent = message;
    
    // Show modal
    modal.style.display = 'flex';
    
    // Close on OK button
    const okBtn = document.getElementById('alert-ok-btn');
    okBtn.onclick = () => {
      modal.style.display = 'none';
    };
    
    // Close on outside click
    modal.onclick = (e) => {
      if (e.target === modal) {
        modal.style.display = 'none';
      }
    };
    
    // Close on Escape key
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        modal.style.display = 'none';
        document.removeEventListener('keydown', handleEscape);
      }
    };
    document.addEventListener('keydown', handleEscape);
  }

  // Show confirm modal (replaces browser confirm)
  function showConfirm(message) {
    return new Promise((resolve) => {
      const modal = document.getElementById('confirm-modal');
      const messageEl = document.getElementById('confirm-message');
      
      // Set message
      messageEl.textContent = message;
      
      // Show modal
      modal.style.display = 'flex';
      
      // Cleanup function to remove event listeners
      const cleanup = () => {
        document.removeEventListener('keydown', handleEscape);
      };
      
      // Handle confirm
      const confirmBtn = document.getElementById('confirm-ok-btn');
      confirmBtn.onclick = () => {
        modal.style.display = 'none';
        cleanup();
        resolve(true);
      };
      
      // Handle cancel
      const cancelBtn = document.getElementById('confirm-cancel-btn');
      cancelBtn.onclick = () => {
        modal.style.display = 'none';
        cleanup();
        resolve(false);
      };
      
      // Close on outside click (counts as cancel)
      modal.onclick = (e) => {
        if (e.target === modal) {
          modal.style.display = 'none';
          cleanup();
          resolve(false);
        }
      };
      
      // Close on Escape key (counts as cancel)
      const handleEscape = (e) => {
        if (e.key === 'Escape') {
          modal.style.display = 'none';
          cleanup();
          resolve(false);
        }
      };
      document.addEventListener('keydown', handleEscape);
    });
  }

  // VIEW MODAL UTILITY

  // Format date helper
  function formatDate(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    const options = { year: 'numeric', month: 'short', day: 'numeric' };
    return date.toLocaleDateString('en-US', options);
  }

  // Show post in view modal (read-only preview)
  function showViewModal(post) {
    const modal = document.getElementById('view-modal');
    
    // Set title
    document.getElementById('view-modal-title').textContent = post.title;
    
    // Set type badge
    const typeBadge = document.getElementById('view-type-badge');
    typeBadge.textContent = post.type === 'announcement' ? '📢 ANNOUNCEMENT' : '📰 NEWS';
    typeBadge.className = `view-type-badge type-${post.type}`;
    
    // Set category badge
    document.getElementById('view-category-badge').textContent = post.category;
    
    // Set image (show/hide based on existence)
    const imageContainer = document.getElementById('view-image-container');
    const image = document.getElementById('view-image');
    if (post.imageUrl) {
      image.src = post.imageUrl;
      image.alt = post.title;
      imageContainer.style.display = 'block';
    } else {
      imageContainer.style.display = 'none';
    }
    
    // Set body content
    document.getElementById('view-body').textContent = post.body;
    
    // Set posted date
    document.getElementById('view-date').textContent = formatDate(post.createdAt);
    
    // Show/hide updated date if post was edited
    const updatedItem = document.getElementById('view-updated-item');
    if (post.updatedAt) {
      const createdDate = new Date(post.createdAt).getTime();
      const updatedDate = new Date(post.updatedAt).getTime();
      
      // Only show if actually updated (more than 1 minute difference)
      if (updatedDate - createdDate > 60000) {
        document.getElementById('view-updated-date').textContent = formatDate(post.updatedAt);
        updatedItem.style.display = 'flex';
      } else {
        updatedItem.style.display = 'none';
      }
    } else {
      updatedItem.style.display = 'none';
    }
    
    // Set author
    document.getElementById('view-author').textContent = post.createdByName || 'Unknown';
    
    // Set status
    const status = post.archived ? 'Archived' : 'Active';
    document.getElementById('view-status').textContent = status;
    
    // Show modal
    modal.style.display = 'flex';
    
    // Close modal handler
    const closeBtn = document.getElementById('view-modal-close');
    closeBtn.onclick = () => {
      modal.style.display = 'none';
    };
    
    // Close on outside click
    modal.onclick = (e) => {
      if (e.target === modal) {
        modal.style.display = 'none';
      }
    };
  }

  // STATE MANAGEMENT

  // Cache for all posts (fetched from API)
  let allPosts = [];

  // Edit mode tracking
  let editingPostId = null; // null = create mode, string = edit mode
  let selectedImageFile = null; // Store selected image file for upload
  let shouldRemoveImage = false; // Flag to remove existing image

  // API FUNCTIONS

  // Fetch all posts from backend (including archived for admin view)
  async function fetchAllPosts() {
    try {
      // Fetch from API with includeArchived flag for admin view
      const response = await apiFetch('/api/announcements?includeArchived=true');
      allPosts = response.posts || [];
      return allPosts;
    } catch (error) {
      console.error('Error fetching posts:', error);
      showAlert('Failed to load announcements. Please refresh the page.', 'error');
      return [];
    }
  }

  // Create new post with optional image
  async function createPost(postData, imageFile) {
    try {
      // Prepare form data for multipart upload
      const formData = new FormData();
      formData.append('type', postData.type);
      formData.append('title', postData.title);
      formData.append('body', postData.body);
      formData.append('category', postData.category);
      
      // Add image if selected
      if (imageFile) {
        formData.append('image', imageFile);
      }

      // Send to API
      const response = await apiFetch('/api/announcements', {
        method: 'POST',
        body: formData
      });

      return response;
    } catch (error) {
      console.error('Error creating post:', error);
      throw error;
    }
  }

  // Update existing post
  async function updatePost(postId, postData, imageFile, removeImage) {
    try {
      // Prepare form data
      const formData = new FormData();
      if (postData.type) formData.append('type', postData.type);
      if (postData.title) formData.append('title', postData.title);
      if (postData.body) formData.append('body', postData.body);
      if (postData.category) formData.append('category', postData.category);
      
      // Handle image changes
      if (removeImage) {
        formData.append('removeImage', 'true');
      } else if (imageFile) {
        formData.append('image', imageFile);
      }

      // Send to API
      const response = await apiFetch(`/api/announcements/${postId}`, {
        method: 'PUT',
        body: formData
      });

      return response;
    } catch (error) {
      console.error('Error updating post:', error);
      throw error;
    }
  }

  // Archive post (soft delete)
  async function archivePost(postId) {
    try {
      const response = await apiFetch(`/api/announcements/${postId}/archive`, {
        method: 'PUT'
      });
      return response;
    } catch (error) {
      console.error('Error archiving post:', error);
      throw error;
    }
  }

  // Restore archived post
  async function restorePost(postId) {
    try {
      const response = await apiFetch(`/api/announcements/${postId}/restore`, {
        method: 'PUT'
      });
      return response;
    } catch (error) {
      console.error('Error restoring post:', error);
      throw error;
    }
  }

  // Permanently delete post
  async function deletePost(postId) {
    try {
      const response = await apiFetch(`/api/announcements/${postId}`, {
        method: 'DELETE'
      });
      return response;
    } catch (error) {
      console.error('Error deleting post:', error);
      throw error;
    }
  }

  // UTILITY FUNCTIONS

  // Format relative time
  function getRelativeTime(dateString) {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} ${diffMins === 1 ? 'minute' : 'minutes'} ago`;
    if (diffHours < 24) return `${diffHours} ${diffHours === 1 ? 'hour' : 'hours'} ago`;
    if (diffDays < 7) return `${diffDays} ${diffDays === 1 ? 'day' : 'days'} ago`;
    return date.toLocaleDateString();
  }

  // DASHBOARD PREVIEW RENDER

  // Render dashboard preview (shows recent posts)
  async function renderDashboard() {
    const wrap = document.getElementById("announcements-list");
    if (!wrap) return;
    
    // Fetch latest posts from API
    await fetchAllPosts();
    
    // Filter only active posts (not archived) and take first 5
    const activePosts = allPosts.filter(post => !post.archived).slice(0, 5);
    
    // Clear container first
    wrap.innerHTML = "";
    
    // Show empty state if no posts
    if (!activePosts.length) {
      const emptyState = document.getElementById("ann-empty-state");
      if (emptyState) {
        emptyState.style.display = "flex";
      }
      return;
    }
    
    // Hide empty state
    const emptyState = document.getElementById("ann-empty-state");
    if (emptyState) {
      emptyState.style.display = "none";
    }
    
    // Render preview items
    activePosts.forEach(item => {
      const previewItem = document.createElement("div");
      previewItem.className = "announcement-preview-item";
      previewItem.dataset.id = item.id;
      
      // Determine icon based on type
      const iconClass = item.type === "news" ? "fa-newspaper" : "fa-bullhorn";
      const iconType = item.type === "news" ? "news" : "announcement";
      
      previewItem.innerHTML = `
        <div class="preview-icon ${iconType}">
          <i class="fas ${iconClass}"></i>
        </div>
        <div class="preview-content">
          <h4 class="preview-title">${escapeHtml(item.title)}</h4>
          <p class="preview-body">${escapeHtml(item.body)}</p>
          <div class="preview-meta">
            <span class="preview-date">
              <i class="far fa-clock"></i> ${getRelativeTime(item.createdAt)}
            </span>
            <span class="preview-badge ${iconType}">${item.type}</span>
          </div>
        </div>
      `;
      
      wrap.appendChild(previewItem);
    });
  }

  // FULL SECTION RENDER LOGIC
  // Current filter state
  let currentTab = 'announcement'; // announcement, news, or archived
  let searchQuery = '';
  let categoryFilter = 'all';
  let sortBy = 'newest';

  // Calculate days until auto-deletion for archived items
  function calculateArchiveCountdown(archivedAtString) {
    const archivedDate = new Date(archivedAtString);
    const now = new Date();
    const diffMs = now - archivedDate;
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const daysRemaining = 45 - diffDays; // Auto-delete after 45 days
    
    if (daysRemaining <= 0) return 'Deletes soon';
    if (daysRemaining === 1) return 'Deletes in 1 day';
    return `Deletes in ${daysRemaining} days`;
  }

  // Filter and sort items based on current state (uses cached allPosts)
  function getFilteredItems() {
    let items = [...allPosts]; // Clone array to avoid mutating original
    
    // Filter by tab (type or archived status)
    if (currentTab === 'archived') {
      items = items.filter(item => item.archived === true);
    } else {
      items = items.filter(item => item.archived === false && item.type === currentTab);
    }
    
    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      items = items.filter(item => 
        item.title.toLowerCase().includes(query) || 
        item.body.toLowerCase().includes(query)
      );
    }
    
    // Filter by category
    if (categoryFilter !== 'all') {
      items = items.filter(item => item.category === categoryFilter);
    }
    
    // Sort items
    if (sortBy === 'newest') {
      items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    } else if (sortBy === 'oldest') {
      items.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    } else if (sortBy === 'title') {
      items.sort((a, b) => a.title.localeCompare(b.title));
    }
    
    return items;
  }

  // Render full section cards (async to fetch data)
  async function renderFullSection() {
    const grid = document.getElementById('ann-grid');
    const emptyState = document.getElementById('ann-empty');
    
    // Safety check: if grid doesn't exist, we're not on the announcements section page
    if (!grid) return;
    
    // Ensure we have latest data
    if (allPosts.length === 0) {
      await fetchAllPosts();
    }
    
    // Get filtered items
    const items = getFilteredItems();
    
    // Clear grid
    grid.innerHTML = '';
    
    // Show/hide empty state
    if (items.length === 0) {
      if (emptyState) emptyState.style.display = 'block';
      return;
    } else {
      if (emptyState) emptyState.style.display = 'none';
    }
    
    // Get template
    const template = document.getElementById('ann-card-template');
    if (!template) return;
    
    // Render each item
    items.forEach(item => {
      // Clone template
      const card = template.content.cloneNode(true);
      const cardEl = card.querySelector('.ann-card');
      
      // Set data-id
      cardEl.dataset.id = item.id;
      
      // Handle image
      const imageContainer = card.querySelector('.ann-card-image');
      if (item.imageUrl) {
        imageContainer.classList.add('has-image');
        imageContainer.querySelector('img').src = item.imageUrl;
      } else {
        imageContainer.remove();
      }
      
      // Set badge
      const badge = card.querySelector('.ann-badge');
      badge.textContent = item.type;
      badge.classList.add(item.type);
      
      // Set category badge
      const categoryBadge = card.querySelector('.ann-category-badge');
      categoryBadge.textContent = item.category;
      
      // Set title and body
      card.querySelector('.ann-card-title').textContent = item.title;
      card.querySelector('.ann-card-body').textContent = item.body;
      
      // Set posted by (only show in admin section)
      card.querySelector('.posted-by-name').textContent = item.createdByName;
      
      // Set date
      card.querySelector('.date-text').textContent = getRelativeTime(item.createdAt);
      
      // Handle archive info
      const archiveInfo = card.querySelector('.ann-archive-info');
      if (item.archived && item.archivedAt) {
        archiveInfo.style.display = 'flex';
        archiveInfo.querySelector('.archive-countdown').textContent = calculateArchiveCountdown(item.archivedAt);
      } else {
        archiveInfo.remove();
      }
      
      // Handle action buttons visibility
      const archiveBtn = card.querySelector('.ann-archive-btn');
      const restoreBtn = card.querySelector('.ann-restore-btn');
      
      if (item.archived) {
        // Hide archive button, show restore button
        archiveBtn.style.display = 'none';
        restoreBtn.style.display = 'flex';
      } else {
        // Show archive button, hide restore button
        archiveBtn.style.display = 'flex';
        restoreBtn.style.display = 'none';
      }
      
      // Append to grid
      grid.appendChild(card);
    });

    // Wire up action buttons after rendering
    setupCardActions();
  }

  // EVENT HANDLERS - CARD ACTIONS

  // Setup click handlers for archive, restore, and edit buttons
  function setupCardActions() {
    const grid = document.getElementById('ann-grid');
    if (!grid) return;

    // Use event delegation for better performance
    grid.addEventListener('click', async (e) => {
      const card = e.target.closest('.ann-card');
      if (!card) return;

      const postId = card.dataset.id;
      if (!postId) return;

      // Handle archive button
      if (e.target.closest('.ann-archive-btn')) {
        const confirmed = await showConfirm('Are you sure you want to archive this post?');
        if (confirmed) {
          try {
            await archivePost(postId);
            showAlert('Post archived successfully!', 'success');
            await fetchAllPosts(); // Refresh data
            await renderFullSection(); // Re-render
            await renderDashboard(); // Update dashboard too
          } catch (error) {
            showAlert('Failed to archive post. Please try again.', 'error');
          }
        }
      }
      
      // Handle restore button
      else if (e.target.closest('.ann-restore-btn')) {
        try {
          await restorePost(postId);
          showAlert('Post restored successfully!', 'success');
          await fetchAllPosts(); // Refresh data
          await renderFullSection(); // Re-render
          await renderDashboard(); // Update dashboard too
        } catch (error) {
          showAlert('Failed to restore post. Please try again.', 'error');
        }
      }
      
      // Handle view button
      else if (e.target.closest('.ann-view-btn')) {
        const post = allPosts.find(p => p.id === postId);
        if (post) {
          showViewModal(post);
        }
      }
      
      // Handle edit button
      else if (e.target.closest('.ann-edit-btn')) {
        const post = allPosts.find(p => p.id === postId);
        if (post) {
          openEditModal(post);
        }
      }
      
      // Handle delete button
      else if (e.target.closest('.ann-delete-btn')) {
        const post = allPosts.find(p => p.id === postId);
        if (post) {
          const confirmed = await showConfirm(
            `Are you sure you want to permanently delete "${post.title}"? This action cannot be undone.`
          );
          if (confirmed) {
            try {
              await deletePost(postId);
              showAlert('Post permanently deleted!', 'success');
              await fetchAllPosts(); // Refresh data
              await renderFullSection(); // Re-render
              await renderDashboard(); // Update dashboard too
            } catch (error) {
              showAlert('Failed to delete post. Please try again.', 'error');
            }
          }
        }
      }
    });
  }

  // TAB SWITCHING & FILTERS

  // Setup tab switching
  function setupTabs() {
    const tabBtns = document.querySelectorAll('.ann-tab-btn');
    
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        // Update active class
        tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // Update current tab
        currentTab = btn.dataset.type;
        
        // Re-render
        renderFullSection();
      });
    });
  }

  // Setup search and filters
  function setupFilters() {
    const searchInput = document.getElementById('ann-search');
    const categorySelect = document.getElementById('ann-category-filter');
    const sortSelect = document.getElementById('ann-sort');
    
    // Search input
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        searchQuery = e.target.value.trim();
        renderFullSection();
      });
    }
    
    // Category filter
    if (categorySelect) {
      categorySelect.addEventListener('change', (e) => {
        categoryFilter = e.target.value;
        renderFullSection();
      });
    }
    
    // Sort select
    if (sortSelect) {
      sortSelect.addEventListener('change', (e) => {
        sortBy = e.target.value;
        renderFullSection();
      });
    }
  }

  // MODAL FUNCTIONS

  // Open modal in CREATE mode
  function openCreateModal(modalEl) {
    if (!modalEl) return;
    
    // Reset edit mode
    editingPostId = null;
    selectedImageFile = null;
    shouldRemoveImage = false;
    
    // Reset form
    resetModalForm(modalEl);
    
    // Update button text
    const saveBtn = modalEl.querySelector('#post-save');
    if (saveBtn) saveBtn.textContent = 'Post';
    
    // Open modal
    modalEl.setAttribute("aria-hidden", "false");
  }

  // Open modal in EDIT mode
  function openEditModal(post) {
    const modal = document.getElementById('post-modal');
    if (!modal) return;
    
    // Set edit mode
    editingPostId = post.id;
    selectedImageFile = null;
    shouldRemoveImage = false;
    
    // Populate form with existing data
    const titleEl = modal.querySelector('#ann-title');
    const bodyEl = modal.querySelector('#ann-body');
    const categoryEl = modal.querySelector('#ann-category');
    const typeRadio = modal.querySelector(`input[name="ann-type"][value="${post.type}"]`);
    
    if (titleEl) titleEl.value = post.title;
    if (bodyEl) bodyEl.value = post.body;
    if (categoryEl) categoryEl.value = post.category;
    if (typeRadio) typeRadio.checked = true;
    
    // Show existing image if present
    if (post.imageUrl) {
      showImagePreview(post.imageUrl, false);
    }
    
    // Update button text
    const saveBtn = modal.querySelector('#post-save');
    if (saveBtn) saveBtn.textContent = 'Update Post';
    
    // Open modal
    modal.setAttribute("aria-hidden", "false");
  }

  // Close modal
  function closeModal(modalEl) {
    if (!modalEl) return;
    modalEl.setAttribute("aria-hidden", "true");
    
    // Reset state
    editingPostId = null;
    selectedImageFile = null;
    shouldRemoveImage = false;
    resetModalForm(modalEl);
  }

  // Reset modal form to empty state
  function resetModalForm(modalEl) {
    const titleEl = modalEl.querySelector('#ann-title');
    const bodyEl = modalEl.querySelector('#ann-body');
    const categoryEl = modalEl.querySelector('#ann-category');
    const announcementRadio = modalEl.querySelector('#ann-type-announcement');
    const imageInput = modalEl.querySelector('#ann-image');
    const imagePreview = modalEl.querySelector('#ann-image-preview');
    
    if (titleEl) titleEl.value = '';
    if (bodyEl) bodyEl.value = '';
    if (categoryEl) categoryEl.value = '';
    if (announcementRadio) announcementRadio.checked = true;
    if (imageInput) imageInput.value = '';
    if (imagePreview) imagePreview.style.display = 'none';
  }

  // Show image preview
  function showImagePreview(imageUrl, isNew) {
    const previewContainer = document.getElementById('ann-image-preview');
    if (!previewContainer) return;
    
    const previewImg = previewContainer.querySelector('img');
    const removeBtn = previewContainer.querySelector('.remove-image-btn');
    
    if (previewImg) previewImg.src = imageUrl;
    if (removeBtn) {
      removeBtn.textContent = isNew ? 'Remove' : 'Remove Image';
    }
    
    previewContainer.style.display = 'block';
  }

  // Hide image preview
  function hideImagePreview() {
    const previewContainer = document.getElementById('ann-image-preview');
    if (previewContainer) {
      previewContainer.style.display = 'none';
    }
  }

  // IMAGE UPLOAD HANDLING 

  // Setup image upload input handler
  function setupImageUpload() {
    const imageInput = document.getElementById('ann-image');
    if (!imageInput) return;
    
    imageInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      // Validate file type
      if (!file.type.startsWith('image/')) {
        showAlert('Please select an image file', 'error');
        imageInput.value = '';
        return;
      }
      
      // Validate file size (30MB max)
      if (file.size > 30 * 1024 * 1024) {
        showAlert('Image must be less than 30MB', 'error');
        imageInput.value = '';
        return;
      }
      
      // Store file and show preview
      selectedImageFile = file;
      
      // Create preview URL
      const reader = new FileReader();
      reader.onload = (e) => {
        showImagePreview(e.target.result, true);
      };
      reader.readAsDataURL(file);
    });
  }

  // Setup remove image button
  function setupRemoveImageButton() {
    const modal = document.getElementById('post-modal');
    if (!modal) return;
    
    // Create remove button if it doesn't exist
    let removeBtn = modal.querySelector('.remove-image-btn');
    if (!removeBtn) {
      const previewContainer = document.getElementById('ann-image-preview');
      if (previewContainer) {
        removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'remove-image-btn';
        removeBtn.textContent = 'Remove';
        previewContainer.appendChild(removeBtn);
      }
    }
    
    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        // Clear file input and preview
        const imageInput = document.getElementById('ann-image');
        if (imageInput) imageInput.value = '';
        
        selectedImageFile = null;
        
        // If editing and had existing image, mark for removal
        if (editingPostId) {
          shouldRemoveImage = true;
        }
        
        hideImagePreview();
      });
    }
  }

  function moveViewAll() {
    const viewAll = document.getElementById("view-all-ann") || document.getElementById("view-all-full");
    const header = document.querySelector(".updates-header");
    if (!viewAll || !header) return;
    let headerActions = header.querySelector(".header-actions");
    if (!headerActions) {
      headerActions = document.createElement("div");
      headerActions.className = "header-actions";
      header.appendChild(headerActions);
    }
    headerActions.appendChild(viewAll);
  }

  // INITIALIZATION

  async function init() {
    const postBtn = document.getElementById("post-ann-btn") || document.querySelector(".btn-post");
    const modal = document.getElementById("post-modal");
    const saveBtn = document.getElementById("post-save");
    const cancelBtn = document.getElementById("post-cancel");

    moveViewAll();
    await renderDashboard(); // Render dashboard preview from API

    // Setup image upload handlers
    setupImageUpload();
    setupRemoveImageButton();

    // Open modal in CREATE mode
    if (postBtn && modal) {
      postBtn.addEventListener("click", () => openCreateModal(modal));
    }
    if (cancelBtn && modal) {
      cancelBtn.addEventListener("click", () => closeModal(modal));
    }
    // Handle save button (CREATE or UPDATE mode)
    if (saveBtn && modal) {
      saveBtn.addEventListener("click", async () => {
        // Get form values
        const titleEl = modal.querySelector("#ann-title");
        const bodyEl = modal.querySelector("#ann-body");
        const categoryEl = modal.querySelector("#ann-category");
        const typeEl = modal.querySelector('input[name="ann-type"]:checked');
        
        const title = titleEl ? titleEl.value.trim() : "";
        const body = bodyEl ? bodyEl.value.trim() : "";
        const category = categoryEl ? categoryEl.value : "";
        const type = typeEl ? typeEl.value : "announcement";
        
        // Validation
        if (!title) { 
          showAlert("Please enter a title.", "error"); 
          if (titleEl) titleEl.focus();
          return; 
        }
        if (!body) { 
          showAlert("Please enter the content.", "error"); 
          if (bodyEl) bodyEl.focus();
          return; 
        }
        if (!category) { 
          showAlert("Please select a category.", "error"); 
          if (categoryEl) categoryEl.focus();
          return; 
        }
        
        // Prepare post data
        const postData = {
          type: type,
          title: title,
          body: body,
          category: category
        };
        
        try {
          // Disable button during save
          saveBtn.disabled = true;
          saveBtn.textContent = editingPostId ? 'Updating...' : 'Posting...';
          
          if (editingPostId) {
            // UPDATE mode
            await updatePost(editingPostId, postData, selectedImageFile, shouldRemoveImage);
            showAlert('Post updated successfully!', 'success');
          } else {
            // CREATE mode
            await createPost(postData, selectedImageFile);
            showAlert('Post created successfully!', 'success');
          }
          
          // Close modal and refresh
          closeModal(modal);
          await fetchAllPosts(); // Refresh cache
          await renderDashboard(); // Update dashboard
          await renderFullSection(); // Update full section if present
          
        } catch (error) {
          showAlert('Failed to save post: ' + (error.message || 'Please try again'), 'error');
        } finally {
          // Re-enable button
          saveBtn.disabled = false;
          saveBtn.textContent = editingPostId ? 'Update Post' : 'Post';
        }
      });
    }

    // allow clicking backdrop to close modal
    if (modal) {
      modal.addEventListener("click", (ev) => {
        if (ev.target === modal) closeModal(modal);
      });
    }


    // FULL SECTION INITIALIZATION

    // Check if we're on the announcements section page
    const annGrid = document.getElementById('ann-grid');
    if (annGrid) {
      setupTabs();
      setupFilters();
      renderFullSection();
    }

    // Handle "New Post" button in full section
    const newAnnBtn = document.getElementById('btn-new-announcement');
    if (newAnnBtn && modal) {
      newAnnBtn.addEventListener('click', () => openCreateModal(modal));
    }
  }

  // Start initialization when DOM is ready
  document.addEventListener("DOMContentLoaded", init);
})();