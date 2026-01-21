
// landing-announcements.js
// Displays announcements and news on the public landing page
// Fetches from backend API - no authentication required for public posts

const MAX_POSTS_TO_SHOW = 3; 

// Format timestamp to relative time ("5 minutes ago", "2 hours ago")
function getRelativeTime(date) {
    const now = new Date();
    const diffInSeconds = Math.floor((now - date) / 1000);
    
    // Less than a minute
    if (diffInSeconds < 60) {
        return 'Just now';
    }
    
    // Less than an hour
    const diffInMinutes = Math.floor(diffInSeconds / 60);
    if (diffInMinutes < 60) {
        return `${diffInMinutes} minute${diffInMinutes > 1 ? 's' : ''} ago`;
    }
    
    // Less than a day
    const diffInHours = Math.floor(diffInMinutes / 60);
    if (diffInHours < 24) {
        return `${diffInHours} hour${diffInHours > 1 ? 's' : ''} ago`;
    }
    
    // Less than a week
    const diffInDays = Math.floor(diffInHours / 24);
    if (diffInDays < 7) {
        return `${diffInDays} day${diffInDays > 1 ? 's' : ''} ago`;
    }
    
    // More than a week - show actual date
    return date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric' 
    });
}

// Fetch posts from backend API
// Public endpoint - no authentication needed
async function fetchPostsFromAPI() {
    try {
        // Call public API endpoint (returns only active posts)
        const response = await fetch('/api/announcements');
        
        // Check if request was successful
        if (!response.ok) {
            throw new Error(`Failed to fetch posts: ${response.status}`);
        }
        
        // Parse JSON response
        const data = await response.json();
        
        // Extract posts array from response
        const posts = data.posts || [];
        
        console.log(`Fetched ${posts.length} active posts from API`);
        
        return posts;
        
    } catch (error) {
        console.error('Error fetching posts from API:', error);
        // Return empty array on error - empty state will be shown
        return [];
    }
}

// Filter posts by type and sort by date (newest first)
function filterPostsByType(posts, type) {
    return posts
        .filter(post => post.type === type)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, MAX_POSTS_TO_SHOW);
}

// Create post card element from template
function createPostCard(post) {
    const template = document.getElementById('ann-post-template');
    const postCard = template.content.cloneNode(true);
    const card = postCard.querySelector('.ann-post-card');
    
    // Fill in post data
    
    // Category badge
    const categoryElement = postCard.querySelector('.ann-post-category');
    categoryElement.textContent = post.category || 'General';
    
    // Relative time ("5 minutes ago")
    const dateElement = postCard.querySelector('.ann-post-date');
    const postDate = new Date(post.createdAt);
    dateElement.textContent = getRelativeTime(postDate);
    
    // Title
    const titleElement = postCard.querySelector('.ann-post-title');
    titleElement.textContent = post.title;
    
    // Body text
    const bodyElement = postCard.querySelector('.ann-post-body');
    bodyElement.textContent = post.body;
    
    // Image (optional)
    if (post.imageUrl) {
        card.classList.add('has-image');
        const imageElement = postCard.querySelector('.ann-post-image img');
        imageElement.src = post.imageUrl;
        imageElement.alt = post.title;
    }
    
    // "Read More" button click handler
    const readMoreBtn = postCard.querySelector('.ann-read-more');
    readMoreBtn.addEventListener('click', () => showFullPost(post));
    
    return postCard;
}

// Render posts into container with empty state handling
function renderPosts(posts, containerId, emptyStateId) {
    const container = document.getElementById(containerId);
    const emptyState = document.getElementById(emptyStateId);
    
    // Clear existing cards
    const existingCards = container.querySelectorAll('.ann-post-card');
    existingCards.forEach(card => card.remove());
    
    // Show empty state if no posts, otherwise render cards
    if (posts.length === 0) {
        emptyState.style.display = 'flex';
    } else {
        emptyState.style.display = 'none';
        posts.forEach(post => {
            const postCard = createPostCard(post);
            container.appendChild(postCard);
        });
    }
}

// TASK 3: Format date to "Oct 21, 2025"
function formatDate(dateString) {
    const date = new Date(dateString);
    const options = { year: 'numeric', month: 'short', day: 'numeric' };
    return date.toLocaleDateString('en-US', options);
}

// TASK 3: Show full post in modal (replaces ugly alert)
function showFullPost(post) {
    const modal = document.getElementById('landing-view-modal');
    
    // Set title
    document.getElementById('landing-modal-title').textContent = post.title;
    
    // Set type badge
    const typeBadge = document.getElementById('landing-modal-type-badge');
    typeBadge.textContent = post.type === 'announcement' ? '📢 Announcement' : '📰 News';
    typeBadge.className = `landing-type-badge type-${post.type}`;
    
    // Set category badge
    const categoryBadge = document.getElementById('landing-modal-category-badge');
    categoryBadge.textContent = post.category;
    
    // Set image (show/hide based on existence)
    const imageContainer = document.getElementById('landing-modal-image-container');
    const image = document.getElementById('landing-modal-image');
    if (post.imageUrl) {
        image.src = post.imageUrl;
        image.alt = post.title;
        imageContainer.style.display = 'block';
    } else {
        imageContainer.style.display = 'none';
    }
    
    // Set body content
    document.getElementById('landing-modal-body').textContent = post.body;
    
    // Set formatted date (NO AUTHOR for public view)
    document.getElementById('landing-modal-date').textContent = formatDate(post.createdAt);
    
    // Show "Last updated" if post was edited (updatedAt exists and is different from createdAt)
    const updatedContainer = document.getElementById('landing-modal-updated');
    const updatedDateElement = document.getElementById('landing-modal-updated-date');
    
    if (post.updatedAt) {
        const createdDate = new Date(post.createdAt).getTime();
        const updatedDate = new Date(post.updatedAt).getTime();
        
        // Only show if updated date is different from created date (more than 1 minute difference)
        if (updatedDate - createdDate > 60000) { // 60000ms = 1 minute
            updatedDateElement.textContent = formatDate(post.updatedAt);
            updatedContainer.style.display = 'flex';
        } else {
            updatedContainer.style.display = 'none';
        }
    } else {
        updatedContainer.style.display = 'none';
    }
    
    // Show modal
    modal.style.display = 'flex';
}

// TASK 3: Close modal
function closeLandingModal() {
    const modal = document.getElementById('landing-view-modal');
    modal.style.display = 'none';
}

// Initialize and load announcements & news from API
async function initializeLandingAnnouncements() {
    console.log('Loading announcements and news from API...');
    
    // Show loading states
    const announcementsLoading = document.getElementById('announcements-loading');
    const newsLoading = document.getElementById('news-loading');
    
    if (announcementsLoading) announcementsLoading.classList.add('active');
    if (newsLoading) newsLoading.classList.add('active');
    
    try {
        // Fetch all active posts from API
        const allPosts = await fetchPostsFromAPI();
        
        console.log(`Loaded ${allPosts.length} total posts`);
        
        // Separate announcements and news
        const announcements = filterPostsByType(allPosts, 'announcement');
        const news = filterPostsByType(allPosts, 'news');
        
        console.log(`Found ${announcements.length} announcements, ${news.length} news`);
        
        // Render both types
        renderPosts(announcements, 'announcements-list', 'announcements-empty');
        renderPosts(news, 'news-list', 'news-empty');
        
        console.log('Announcements and news loaded successfully!');
        
    } catch (error) {
        console.error('Failed to load posts:', error);
        // On error, show empty states (renderPosts handles this with empty arrays)
        renderPosts([], 'announcements-list', 'announcements-empty');
        renderPosts([], 'news-list', 'news-empty');
    } finally {
        // Always hide loading states
        if (announcementsLoading) announcementsLoading.classList.remove('active');
        if (newsLoading) newsLoading.classList.remove('active');
    }
}

// TASK 3: Initialize modal event listeners
function initializeModalListeners() {
    // Close button (X)
    const closeBtn = document.getElementById('landing-modal-close');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeLandingModal);
    }
    
    // Close button (footer)
    const closeBtnFooter = document.getElementById('landing-modal-close-btn');
    if (closeBtnFooter) {
        closeBtnFooter.addEventListener('click', closeLandingModal);
    }
    
    // Click outside to close
    const modal = document.getElementById('landing-view-modal');
    if (modal) {
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                closeLandingModal();
            }
        });
    }
    
    // Escape key to close
    document.addEventListener('keydown', function(e) {
        const modal = document.getElementById('landing-view-modal');
        if (e.key === 'Escape' && modal && modal.style.display === 'flex') {
            closeLandingModal();
        }
    });
}

// Auto-run when page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initializeLandingAnnouncements();
        initializeModalListeners();
    });
} else {
    initializeLandingAnnouncements();
    initializeModalListeners();
}

// Optional: Auto-refresh every 30 seconds to show latest posts
// Uncomment the line below to enable
// setInterval(initializeLandingAnnouncements, 30000);
