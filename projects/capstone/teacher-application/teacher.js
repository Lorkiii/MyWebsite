// teacher.js (with Firestore onSnapshot for real-time updates)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getFirestore, doc as fsDoc, onSnapshot as fsOnSnapshot } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import { logoutAndRedirect } from "../logout-auth.js";
import { firebaseConfig } from "../firebase-config.js";

document.addEventListener('DOMContentLoaded', () => {
    // DOM elements
    const openSidebar = document.getElementById('open-sidebar');
    const closeSidebar = document.getElementById('close-sidebar');
    const sidebar = document.querySelector('.sidebar');
    const mainContent = document.querySelector('.main-content');
    const navLinks = document.querySelectorAll('.sidebar a[href^="#"]:not([href="#"])'); // Get all sidebar navigation links with href starting with #

    // Create overlay element for mobile
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    document.body.appendChild(overlay);

    function updateLayout() {
        const isDesktop = window.innerWidth >= 992;
        const sidebarVisible = sidebar.classList.contains('show');
        mainContent.classList.toggle("with-sidebar", isDesktop && sidebarVisible);
    }
    // Function to open sidebar
    function showSidebar() {
        sidebar.classList.add('show');
        overlay.classList.add('active');
        updateLayout();
    }

    // Function to close sidebar
    function hideSidebar() {
        sidebar.classList.remove('show');
        overlay.classList.remove('active');
        updateLayout();
    }
    // Handle window resize
    window.addEventListener('resize', updateLayout);
    // Close sidebar when clicking outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.sidebar') && !openSidebar.contains(e.target)) {
            hideSidebar();
        }
    });
    // Event Listeners
    openSidebar.addEventListener('click', showSidebar);
    closeSidebar.addEventListener('click', hideSidebar);
    overlay.addEventListener('click', hideSidebar);

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

            }
        });

        // Load profile data when navigating to profile settings
        if (hash === "#profile-settings") {
            loadProfileData();
        }
    }
    // Smooth scrolling for sidebar links
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
    // Logout button
    const logoutBtn = document.getElementById("logout-btn");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", () => {
            logoutAndRedirect("../login/login.html");
        });
    }
    // ---------- ADDED TEACHER DASHBOARD BEHAVIOR (minimal & approved) ----------

    // Basic helper: safe HTML escape for inserting text content
    function escapeHtml(raw) {
        if (raw === null || raw === undefined) return '';
        return String(raw).replace(/[&<>"']/g, function (m) {
            return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m];
        });
    }

    // time stamp
    function timestampToIso(val) {
        if (!val) return null;
        // already ISO/string
        if (typeof val === 'string') return val;
        // Firestore Timestamp (has toDate)
        if (typeof val.toDate === 'function') {
            try { return val.toDate().toISOString(); } catch (e) {}
        }
        // Plain object with _seconds/_nanoseconds (common when server serializes)
        if (typeof val === 'object' && (val._seconds !== undefined || val.seconds !== undefined)) {
            const seconds = Number(val._seconds ?? val.seconds ?? 0);
            const nanos = Number(val._nanoseconds ?? val.nanoseconds ?? 0);
            const ms = seconds * 1000 + Math.floor(nanos / 1e6);
            try { return new Date(ms).toISOString(); } catch (e) { return String(val); }
        }
        // Date instance
        if (val instanceof Date) return val.toISOString();
        // Fallback to string conversion
        try { return String(val); } catch (e) { return null; }
    }

    // Helper: convert ISO or timestamp-ish to local friendly string for display
    function formatForDisplay(val) {
        const iso = timestampToIso(val);
        if (!iso) return '—';
        try {
            // show locale string — easier to read than raw ISO
            return new Date(iso).toLocaleString();
        } catch (e) {
            return iso;
        }
    }
    // Minimal applicant state; will be replaced by server data on loadApplicant()
    const applicantState = {
        id: '',
        uid: '',
        createdAt: '',
        submittedAt: '',
        status: 'submitted', // default
        nextStepText: '',
        assignedReviewer: '—',
        interview: null, // or { date: '...', location: '...' }
        attachments: [],
        messages: [],
        notifications: [],
        adminNotes: null,
        progressNotes: null,
        // personal fields placeholders (will be set in loadApplicant)
        firstName: '',
        middleName: '',
        lastName: '',
        displayName: null,
        email: null,
        phone: null,
        address: null,
        birthDate: null,
        preferredLevel: null,
        degree: null,
        major: null,
        institution: null,
        gradYear: null,
        experience: null,
        previousSchools: null,
        subjects: null,
        employment: null
    };
    // ---------- FIRESTORE / AUTH: INIT & onSnapshot ----------
    let firebaseAppInstance = null;
    let firestoreDb = null;
    let firestoreUnsubscribe = null;

    function tryInitFirebaseClient() {
        // avoid double-init
        if (firestoreDb) return firestoreDb;
        try {
            // initialize only if firebaseConfig present
            if (!firebaseConfig || typeof firebaseConfig !== 'object') {
                console.warn('Firebase config missing — skipping client realtime init');
                return null;
            }
            try {
                firebaseAppInstance = initializeApp(firebaseConfig);
            } catch (e) {
                // initializeApp may throw if already initialized in other script; ignore and proceed
                console.warn('initializeApp warning (may already be initialized):', e && e.message ? e.message : e);
            }
            try {
                firestoreDb = getFirestoreSafe();
            } catch (e) {
                // fallback: attempt to getFirestore via dynamic global firebase (older pattern) - not required normally
                console.warn('getFirestore failed', e);
            }
            return firestoreDb;
        } catch (err) {
            console.warn('tryInitFirebaseClient error', err);
            return null;
        }
    }
    function getFirestoreSafe() {
        // `getFirestore` isn't imported by name above to avoid shadowing, so reference by initializing a new instance via the module above:
        // But we imported only getFirestore functions at top; to keep things robust, call getFirestore from the imported module if available.
        try {
            return getFirestore();
        } catch (e) {
            return null;
        }
    }
    try {
        if (!firestoreDb) {
            // Attempt to derive getFirestore (works if other scripts imported modular getFirestore globally)
            // If not, Firestore realtime will be considered unavailable.
            // We'll attempt to call firebase.app() -> firestore() for compatibility with older SDK presence.
            if (typeof window.firebase !== 'undefined' && window.firebase.apps && window.firebase.apps.length > 0) {
                try {
                    // uses compat-style global firebase if available
                    firestoreDb = window.firebase.firestore();
                } catch (e) {
                    // ignore
                }
            }
        }
    } catch (e) {
        // ignore
    }

    // Note: Authentication now handled via JWT cookie automatically
    // No need to get tokens manually - credentials: 'include' sends cookie

    // Start a Firestore onSnapshot listener for the applicant doc id (best-effort)
    function startFirestoreListener(applicantId) {
        // stop existing listener if any
        try {
            if (firestoreUnsubscribe && typeof firestoreUnsubscribe === 'function') {
                try { firestoreUnsubscribe(); } catch (e) { /* ignore */ }
                firestoreUnsubscribe = null;
            }
        } catch (e) {
            // ignore
        }

        if (!applicantId) {
            console.warn('startFirestoreListener: no applicantId provided');
            return;
        }

        // Try to initialize the firebase client (best-effort). If impossible, we bail gracefully.
        tryInitFirebaseClient();

        // If we couldn't get a usable db instance (compat or modular), attempt to still use modular functions with a null db — but that won't work.
        // To keep code clear, only proceed when onSnapshot and fsDoc are present and we can create a reference with a db-like object.
        if (typeof fsOnSnapshot !== 'function' || typeof fsDoc !== 'function') {
            console.warn('Firestore modular helpers not present; skipping realtime listener');
            return;
        }

        // We need a db reference for fsDoc; attempt a minimal modular getFirestore call if available globally under window.__getFirestore
        // If the project already includes modular getFirestore elsewhere, that will be used. Otherwise realtime will not be available.
        let dbRef = null;
        try {
            // Try to get firestore DB the modular way if the environment provided a function
            if (typeof window.getFirestore === 'function') {
                // some environments expose helper
                dbRef = window.getFirestore();
            } else if (typeof firebaseAppInstance !== 'undefined' && firebaseAppInstance) {
                // attempt to call getFirestore from the global modular import if present
                try {
                  
                    if (window.firebase && window.firebase.firestore) {
                        dbRef = window.firebase.firestore();
                    }
                } catch (e) {
                    // ignore
                }
            }
        } catch (e) {
            // ignore
        }

        // If dbRef is still null, skip Firestore listener (not critical for functionality)
        if (!dbRef) {
            console.log('[Realtime] Firestore not available - skipping realtime listener (polling will work)');
            return; // Exit gracefully - notification polling will handle updates
        }

        try {
            // create a doc reference using fsDoc; in modular API the first arg is db ref — if null it'll throw.
            const docRef = fsDoc(dbRef, 'teacherApplicants', applicantId);

            firestoreUnsubscribe = fsOnSnapshot(docRef, (snap) => {
                try {
                    if (!snap || !snap.exists()) {
                        console.warn('Realtime: applicant doc does not exist or snapshot empty', applicantId);
                        return;
                    }
                    const data = snap.data ? snap.data() : (snap._document ? snap._document : null);
                    if (!data) {
                        console.warn('Realtime: snapshot returned no data', snap);
                        return;
                    }

                    // Merge/normalize only safe fields we want to reflect to teacher UI
                    // Do NOT blindly overwrite local-only fields.
                    applicantState.status = data.status || applicantState.status;
                    applicantState.interview = data.interview || null;
                    applicantState.adminNotes = ('adminNotes' in data) ? data.adminNotes : applicantState.adminNotes;
                    applicantState.progressNotes = ('progressNotes' in data) ? data.progressNotes : applicantState.progressNotes;

                    // documents / attachments normalization
                    const docs = Array.isArray(data.documents) ? data.documents : (Array.isArray(data.attachments) ? data.attachments : null);
                    if (docs) {
                        applicantState.attachments = docs.map(d => {
                            if (!d) return null;
                            return {
                                fileName: d.fileName || d.name || (d.path ? d.path.split('/').pop() : 'Attachment'),
                                filePath: d.filePath || d.path || d.filePathNormalized || d.url || '',
                                fileUrl: d.fileUrl || d.url || null,
                            };
                        }).filter(Boolean);
                    }

                    // messages normalization
                    if (Array.isArray(data.messages)) {
                        applicantState.messages = data.messages.slice();
                    }

                    // personal fields (if admin updated them)
                    applicantState.firstName = data.firstName || applicantState.firstName;
                    applicantState.middleName = data.middleName || applicantState.middleName;
                    applicantState.lastName = data.lastName || applicantState.lastName;
                    applicantState.displayName = data.displayName || applicantState.displayName;
                    applicantState.email = data.email || data.contactEmail || applicantState.email;
                    applicantState.phone = data.contactNumber || data.contactNum || data.phone || applicantState.phone;
                    applicantState.address = data.address || applicantState.address;

                    // created/submitted times
                    applicantState.createdAt = data.createdAt || data.created_at || applicantState.createdAt;
                    applicantState.submittedAt = data.submittedAt || data.submitted_at || applicantState.submittedAt;

                    // Update UI pieces now
                    try {
                        renderOverviewCards();
                        renderAttachments();
                        renderNotes();
                        renderNotifications();
                        updateTimeline(applicantState.status, applicantState.interview, applicantState.demoTeaching);
                        updateAttachmentsUploadVisibility();
                        populateApplicationStatus(applicantState);
                        updateApplicationStatusTimeline(applicantState.status, applicantState.interview, applicantState.demoTeaching);
                    } catch (uiErr) {
                        console.warn('Realtime UI update error', uiErr);
                    }

                } catch (errInner) {
                    console.error('Realtime snapshot handler error', errInner);
                }
            }, (err) => {
                console.error('Firestore onSnapshot error', err);
                // show small toast so teacher knows realtime is unavailable
                try { showToast('Realtime updates are currently unavailable.'); } catch (e) {}
            });

            console.log('Realtime: subscribed to teacherApplicants/' + applicantId);
        } catch (err) {
            console.warn('Failed to start Firestore realtime listener', err);
            try { showToast('Realtime unavailable (client-side).'); } catch (e) {}
        }

        // clean up on unload
        window.addEventListener('beforeunload', () => {
            try { if (firestoreUnsubscribe) firestoreUnsubscribe(); } catch (e) {}
        });
    }

    // ---------- Load applicant from server ----------
    // Authentication handled via JWT cookie automatically
    async function loadApplicant(retryCount = 0) {
        try {
            const opts = {
                method: 'GET',
                credentials: 'include', // JWT cookie sent automatically
                headers: { 'Accept': 'application/json' }
            };

            const res = await fetch('/api/applicants/me', opts);

            if (res.status === 401) {
                // token invalid or expired - force logout
                logoutAndRedirect("../login/login.html");
                return null;
            }

            if (res.status === 503) {
                // Temporary error (network, Firestore issue) - retry up to 3 times
                if (retryCount < 3) {
                    // Use shorter delay for first retry (Firestore consistency issue)
                    const delay = retryCount === 0 ? 500 : 2000;
                    console.warn(`Temporary error loading applicant (attempt ${retryCount + 1}/3). Retrying in ${delay}ms...`);
                    showToast('Connection issue. Retrying...', 'info');
                    await new Promise(resolve => setTimeout(resolve, delay));
                    return loadApplicant(retryCount + 1); // Retry with incremented count
                } else {
                    console.error('Failed to load applicant after 3 retries');
                    showToast('Unable to load your data. Please refresh the page.');
                    return null;
                }
            }

            if (res.status === 404) {
                // Check if user is admin trying to access applicant page
                try {
                    const errorData = await res.json().catch(() => ({}));

                    
                    // Try to decode JWT to check role (basic check without importing jwt library)
                    // Cookie format: JWT token in __session cookie
                    const cookies = document.cookie.split(';');
                    let isAdmin = false;
                    
                    for (let cookie of cookies) {
                        const [name, value] = cookie.trim().split('=');
                        if (name === '__session' && value) {
                            try {
                                // JWT format: header.payload.signature
                                const parts = value.split('.');
                                if (parts.length === 3) {
                                    const payload = JSON.parse(atob(parts[1]));
                                    if (payload.role === 'admin') {
                                        isAdmin = true;
                                        break;
                                    }
                                }
                            } catch (e) {
                                // Continue checking
                            }
                        }
                    }
                    
                    if (isAdmin) {
                        // Admin trying to access applicant page - redirect to admin portal
                        console.log('[loadApplicant] Admin detected on applicant page, redirecting...');
                        alert('⚠️ You are logged in as an administrator.\n\nRedirecting to Admin Portal...');
                        window.location.href = '/adminportal/admin.html';
                        return null;
                    }
                } catch (parseErr) {
                    console.warn('[loadApplicant] Could not parse 404 response:', parseErr);
                }
                
                // Account truly not found or deleted (for actual applicants)
                alert('⚠️ Your account has been removed from our system.\n\nThis may be because:\n• Your application was archived\n• The 30-day period has expired\n\nYou may submit a new application if needed.');
                logoutAndRedirect("../login/login.html");
                return null;
            }

            if (!res.ok) {
                const txt = await res.text().catch(() => '');
                console.error('/api/applicants/me failed', res.status, txt);
                showToast('Failed to load applicant data. Please try again.');
                return null;
            }

            const payload = await res.json();
            const app = payload && payload.applicant ? payload.applicant : payload;

            const createdIso = timestampToIso(app.createdAt || app.created_at || null) || timestampToIso(app.submittedAt || app.submitted_at || null) || null;

            if (!app) {
                console.warn('/api/applicants/me returned unexpected payload', payload);
                showToast('Failed to load applicant information.');
                return null;
            }

            // Normalize fields into applicantState
            applicantState.id = app.id || app.applicationId || app.docId || applicantState.id || '';
            applicantState.uid = app.uid || app.userUid || '';
            // use createdAt || submittedAt (server may return Firestore timestamp object)
            applicantState.createdAt = createdIso;
            applicantState.submittedAt = createdIso;
            applicantState.submittedAt = applicantState.createdAt;
            applicantState.status = app.status || app.currentStatus || applicantState.status;
            applicantState.nextStepText = app.nextStepText || app.nextStep || '';
            applicantState.assignedReviewer = app.assignedReviewer || app.reviewer || '—';
            applicantState.interview = app.interview || null;
            applicantState.adminNotes = app.adminNotes || null;
            applicantState.progressNotes = app.progressNotes || null;

            // attachments/documents normalization
            const docs = Array.isArray(app.documents) ? app.documents : (Array.isArray(app.attachments) ? app.attachments : []);
            applicantState.attachments = docs.map(d => {
                if (!d) return null;
                return {
                    fileName: d.fileName || d.name || (d.filePath ? d.filePath.split('/').pop() : 'Attachment'),
                    filePath: d.filePath || d.path || d.filePathNormalized || d.url || '',
                    fileUrl: d.fileUrl || d.url || null,
                };
            }).filter(Boolean);

            // messages normalization
            applicantState.messages = Array.isArray(app.messages) ? app.messages.slice() : [];

            // store other personal fields for status view (if present in app)
            // === IMPORTANT: copy name parts too (this fixes the fullname not showing) ===
            applicantState.firstName = app.firstName || app.first_name || (app.name && typeof app.name === 'string' ? app.name.split(' ')[0] : '') || '';
            applicantState.middleName = app.middleName || app.middle_name || '';
            applicantState.lastName = app.lastName || app.last_name || (app.name && typeof app.name === 'string' ? app.name.split(' ').slice(1).join(' ') : '') || '';
            applicantState.displayName = app.displayName || app.fullName || app.name || applicantState.displayName || null;
            applicantState.email = app.contactEmail || app.email || applicantState.email || null;
            applicantState.phone = app.contactNumber || app.contactNum || app.phone || app.contact || applicantState.phone || null;
            applicantState.address = app.address || null;
            applicantState.birthDate = app.birthdate || app.birthDate || null;
            applicantState.preferredLevel = app.preferredLevel || app.preferred || null;
            applicantState.degree = app.highestDegree || app.highest_degree || app.degree || null;
            applicantState.major = app.major || app.field || null;
            applicantState.institution = app.institution || null;
            applicantState.gradYear = app.gradYear || app.yearGraduated || app.grad_year || null;
            applicantState.experience = app.experienceYears || app.experience || app.teachingExperience || null;
            applicantState.previousSchools = app.previousSchools || null;
            applicantState.subjects = app.qualifiedSubjects || app.subjects || null;
            applicantState.employment = app.employmentType || app.employment || null;

            // If we have a valid applicant id — start realtime listener (best-effort)
            try {
                const idForSubscribe = applicantState.id || window.CURRENT_APPLICANT_ID || null;
                if (idForSubscribe) startFirestoreListener(idForSubscribe);
            } catch (e) {
                // ignore
            }

            return applicantState;
        } catch (err) {
            console.error('loadApplicant error', err);
            showToast('Failed to load applicant data (network).');
            return null;
        }
    }

    // ---------- Load messages for current applicant ----------
    async function loadApplicantMessages() {
        console.log(`[loadApplicantMessages] ========== FRONTEND: LOADING MESSAGES ==========`);
        
        const id = applicantState.id || window.CURRENT_APPLICANT_ID || '';
        console.log(`[loadApplicantMessages] Applicant ID from state: ${applicantState.id}`);
        console.log(`[loadApplicantMessages] Window.CURRENT_APPLICANT_ID: ${window.CURRENT_APPLICANT_ID || 'N/A'}`);
        console.log(`[loadApplicantMessages] Using ID: ${id}`);
        
        if (!id) {
            console.warn('[loadApplicantMessages] ⚠️ No applicant ID available - cannot load messages');
            return [];
        }

        try {
            const res = await fetch('/api/applicant-messages/' + encodeURIComponent(id), {
                method: 'GET',
                credentials: 'include',
                headers: { 'Accept': 'application/json' }
            });
            


            // Helpful handling for index-required Firestore errors surfaced as 503/500 with details
            if (res.status === 503) {
                const json = await res.json().catch(() => ({}));
                const msg = (json && json.message) ? json.message : 'Service temporarily unavailable. Firestore index may be building.';
                showToast(msg);
                return [];
            }

            if (!res.ok) {
                const json = await res.json().catch(() => ({}));
                // If backend returned details about index required, show helpful message
                const details = (json && json.details) ? json.details : null;
                if (details && /index/i.test(details)) {
                    showToast('A Firestore index is required. Please create the missing composite index and wait a moment.');
                } else if (res.status === 403) {
                    showToast('Not authorized to view messages for this applicant.');
                } else {
                    showToast('Failed to load messages. See console for details.');
                }
                console.warn('loadApplicantMessages failed', res.status, json || details);
                return [];
            }

            const data = await res.json().catch(() => ({}));
            console.log(`[loadApplicantMessages] Response data:`, data);
            
            if (!data || !data.ok) {
                console.warn('[loadApplicantMessages] ⚠️ Response not OK or missing data');
                showToast('Failed to load messages.');
                return [];
            }

            // assign messages to state and render
            const messageCount = Array.isArray(data.messages) ? data.messages.length : 0;
            console.log(`[loadApplicantMessages] ✅ Received ${messageCount} messages from API`);
            
            if (messageCount > 0) {
                console.log(`[loadApplicantMessages] Message subjects:`, data.messages.map(m => m.subject || 'No subject'));
            } else {
                console.log(`[loadApplicantMessages] ⚠️ No messages in response`);
            }
            
            applicantState.messages = Array.isArray(data.messages) ? data.messages.slice() : [];
            console.log(`[loadApplicantMessages] Updated applicantState.messages with ${applicantState.messages.length} items`);
            console.log(`[loadApplicantMessages] Calling renderNotes()...`);
            renderNotes();
            console.log(`[loadApplicantMessages] =================================================`);
            return applicantState.messages;
        } catch (err) {
            console.error('[loadApplicantMessages] ❌ Error:', err);
            showToast('Network error while loading messages.');
            return [];
        }
    }

    // --------- Render helpers (use existing DOM ids/classes in teacher.html) ----------
    function renderOverviewCards() {
        const elAppId = document.getElementById('app-id');
        const elSubmitted = document.getElementById('app-submitted-date');
        const elStatus = document.getElementById('app-status');
        const elNextStep = document.getElementById('next-step');
        const elAssigned = document.getElementById('assigned-reviewer');
        const elNextAction = document.getElementById('next-action');
        const elInterviewDate = document.getElementById('interview-date');
        const elInterviewDetails = document.getElementById('interview-details');

        const submittedDisplay = formatForDisplay(applicantState.submittedAt);
        if (elAppId) elAppId.textContent = applicantState.id || '';
        if (elSubmitted) elSubmitted.textContent = submittedDisplay || applicantState.createdAt || '';
        if (elStatus) {
            elStatus.textContent = niceStatus(applicantState.status);
            // keep class for styling (status-<key>)
            elStatus.className = 'status-badge status-' + (applicantState.status || 'submitted');
        }
        if (elNextStep) elNextStep.textContent = 'Next: ' + (applicantState.nextStepText || '—');
        if (elAssigned) elAssigned.textContent = applicantState.assignedReviewer || '—';

        if (applicantState.interview) {
            if (elNextAction) elNextAction.textContent = (applicantState.interview.date || '') + (applicantState.interview.location ? ' — ' + applicantState.interview.location : '');
            if (elInterviewDate) elInterviewDate.textContent = applicantState.interview.date || '—';
            if (elInterviewDetails) elInterviewDetails.textContent = applicantState.interview.location || '';
            // small note for scheduled interview
            let noteEl = document.getElementById('interview-note');
            if (!noteEl) {
                // optional: append small note under next-action
                if (elNextAction && elNextAction.parentNode) {
                    const span = document.createElement('div');
                    span.id = 'interview-note';
                    span.style.fontSize = '12px';
                    span.style.marginTop = '6px';
                    span.textContent = 'Interview scheduled by Admissions. For changes contact admin.';
                    elNextAction.parentNode.appendChild(span);
                }
            }
        } else {
            if (elNextAction) elNextAction.textContent = 'No interview scheduled';
            if (elInterviewDate) elInterviewDate.textContent = '—';
            if (elInterviewDetails) elInterviewDetails.textContent = 'No interview scheduled.';
            const noteExisting = document.getElementById('interview-note');
            if (noteExisting) noteExisting.remove();
        }
    }

    function niceStatus(key) {
        const map = {
            submitted: 'Submitted',
            reviewing: 'Reviewing',
            interview_scheduled: 'Interview scheduled',
            interview_confirmed: 'Interview confirmed',
            demo: 'Demo teaching',
            decision: 'Final decision'
        };
        return map[key] || (key || '');
    }

    // Render attachments into #attachments-list (uses signed-url endpoints)
    function renderAttachments() {
        const container = document.getElementById('attachments-list');
        if (!container) return;
        container.innerHTML = '';

        if (!Array.isArray(applicantState.attachments) || applicantState.attachments.length === 0) {
            const emptyLi = document.createElement('li');
            emptyLi.className = 'empty';
            emptyLi.textContent = 'No attachments yet';
            container.appendChild(emptyLi);
            updateAttachmentsUploadVisibility();
            return;
        }
        applicantState.attachments.forEach(function (f) {
            const li = document.createElement('li');
            li.className = 'attachment-item';
            const name = escapeHtml(f.fileName || (f.filePath ? f.filePath.split('/').pop() : 'Attachment'));
            const left = document.createElement('div');
            left.textContent = name;

            const right = document.createElement('div');
            right.style.display = 'flex';
            right.style.gap = '8px';
            right.style.alignItems = 'center';

            // View/Download button
            const btn = document.createElement('button');
            btn.className = 'btn small';
            btn.type = 'button';
            btn.textContent = 'Download';
            btn.addEventListener('click', async function () {
                btn.disabled = true;
                const old = btn.textContent;
                btn.textContent = 'Preparing…';
                try {
                    const path = String(f.filePath || f.path || f.fileUrl || '');
                    if (!path) throw new Error('No file path stored for this attachment.');

                    // Try owner signed-url first
                    try {
                        const signed = await getSignedUrlOwner(path, 60);
                        window.open(signed, '_blank');
                    } catch (err) {
                        // If forbidden, attempt admin signed-url fallback (useful for admin users)
                        const payload = err && err.payload;
                        let forbidden = false;
                        try {
                            if (payload && payload.error) {
                                const eStr = (typeof payload.error === 'string') ? payload.error.toLowerCase() : JSON.stringify(payload.error).toLowerCase();
                                if (eStr.includes('forbidden')) forbidden = true;
                            }
                            // Also if err.message contains 403
                            if (!forbidden && err && err.message && err.message.indexOf('403') !== -1) forbidden = true;
                        } catch (e) {}
                        if (forbidden) {
                            // try admin route
                            const signedAdmin = await getSignedUrlAdmin(path, 60);
                            window.open(signedAdmin, '_blank');
                        } else {
                            throw err;
                        }
                    }
                } catch (err) {
                    console.error('Download failed', err);
                    showToast('Failed to prepare download. See console for details.');
                } finally {
                    btn.disabled = false;
                    btn.textContent = old;
                }
            });

            right.appendChild(btn);

            li.appendChild(left);
            const spacer = document.createElement('span');
            spacer.style.flex = '1';
            li.appendChild(spacer);
            li.appendChild(right);
            container.appendChild(li);
        });
        // Update upload button visibility based on current status
        updateAttachmentsUploadVisibility();
    }
    // Render notes/messages into #note-list
    function renderNotes() {
        const container = document.getElementById('note-list');
        if (!container) return;
        container.innerHTML = '';
        if (!Array.isArray(applicantState.messages) || applicantState.messages.length === 0) {
            const none = document.createElement('div');
            none.className = 'empty';
            none.textContent = 'No messages yet';
            container.appendChild(none);
            return;
        }
        // newest first
        const copy = applicantState.messages.slice().reverse();
        copy.forEach(function (m) {
            const div = document.createElement('div');
            div.className = 'message';
            div.style.cursor = 'pointer';
            
            // Make message clickable to open modal
            div.addEventListener('click', function() {
                openViewMessageModal(m);
            });
            
            // Determine sender display name
            let senderDisplay = 'You';
            if (m.senderRole === 'admin' || m.sender === 'admin' || (m.senderName && m.senderName.toLowerCase().includes('admin'))) {
                senderDisplay = 'AlpHFAbet Admin';
            } else if (m.senderName) {
                senderDisplay = m.senderName;
            } else if (applicantState.firstName || applicantState.lastName) {
                // Use applicant's name if available
                const parts = [];
                if (applicantState.firstName) parts.push(applicantState.firstName);
                if (applicantState.lastName) parts.push(applicantState.lastName);
                senderDisplay = parts.length ? parts.join(' ') : 'You';
            }
            
            // Format timestamp
            const formattedTime = formatForDisplay(m.createdAt || m.timestamp || m.sentAt);
            
            const header = '<div style="font-weight:600">' + escapeHtml(senderDisplay) + (m.subject ? ' — ' + escapeHtml(m.subject) : '') + '</div>';
            const body = '<div style="margin-top:6px">' + escapeHtml(m.body || m.message || '') + '</div>';
            const time = '<div style="font-size:12px;color:#6b7280;margin-top:6px">' + escapeHtml(formattedTime) + '</div>';
            div.innerHTML = header + body + time;
            container.appendChild(div);
        });
    }

    // ============================================
    // NOTIFICATION SYSTEM (Fetch from API)
    // ============================================
    
    let notificationPollTimer = null;
    
    // Fetch notifications from API
    async function fetchNotifications() {
        const applicantId = applicantState.id || window.CURRENT_APPLICANT_ID || '';
        if (!applicantId) {
            console.warn('[Notifications] No applicant ID available');
            return;
        }

        try {
            const response = await fetch(`/api/teacher-applicants/${applicantId}/notifications?limit=50`, {
                method: 'GET',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            if (data.success && Array.isArray(data.notifications)) {
                renderNotifications(data.notifications);
            }
        } catch (err) {
            console.error('[Notifications] Fetch error:', err);
        }
    }

    // Delete a notification with confirmation
    async function deleteNotification(notificationId) {
        if (!confirm('Delete this notification?')) {
            return;
        }

        try {
            const response = await fetch(`/api/teacher-applicants/notifications/${notificationId}`, {
                method: 'DELETE',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json'
                }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            if (data.success) {
                showToast('Notification deleted');
                fetchNotifications(); // Refresh list
            }
        } catch (err) {
            console.error('[Notifications] Delete error:', err);
            showToast('Failed to delete notification');
        }
    }

    // Render notifications into #notif-list
    function renderNotifications(notifications = []) {
        const container = document.getElementById('notif-list');
        if (!container) return;
        container.innerHTML = '';
        
        // Show empty state
        if (notifications.length === 0) {
            const none = document.createElement('div');
            none.className = 'empty';
            none.textContent = 'No notifications';
            container.appendChild(none);
            return;
        }
        
        // Display newest first
        notifications.forEach(function (notif) {
            const div = document.createElement('div');
            div.className = 'notification-item';
            
            // Create content wrapper
            const content = document.createElement('div');
            content.className = 'notification-content';
            
            // Title
            const title = document.createElement('div');
            title.className = 'notification-title';
            title.textContent = notif.title || 'Notification';
            
            // Message
            const message = document.createElement('div');
            message.className = 'notification-message';
            message.textContent = notif.message || '';
            
            // Time
            const time = document.createElement('div');
            time.className = 'notification-time';
            time.textContent = formatForDisplay(notif.createdAt || notif.timestamp);
            
            // Append content elements
            content.appendChild(title);
            content.appendChild(message);
            content.appendChild(time);
            
            // Delete button
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'notification-delete-btn';
            deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
            deleteBtn.title = 'Delete notification';
            deleteBtn.onclick = function (e) {
                e.stopPropagation();
                deleteNotification(notif.id);
            };
            
            // Add click handler to open modal
            content.style.cursor = 'pointer';
            content.onclick = function () {
                openNotificationModal(notif);
            };
            
            // Append to notification item
            div.appendChild(content);
            div.appendChild(deleteBtn);
            container.appendChild(div);
        });
    }

    // Update timeline 'completed' classes based on status
    function updateTimeline(statusKey, interview, demoTeaching) {
        // Simple mapping for main timeline
        const mapping = {
            submitted: 0,
            reviewing: 1,
            screening: 1,
            interview_scheduled: 2,
            interview_confirmed: 2,
            interview_completed: 2,
            demo_scheduled: 3,
            demo_completed: 3,
            demo: 3,
            result: 4,
            decision: 4,
            approved: 4,
            rejected: 4,
            onboarding: 5,
            archived: 5,
            hired: 5
        };
        const currentIdx = (mapping.hasOwnProperty(statusKey) ? mapping[statusKey] : 0);

        const items = document.querySelectorAll('#status-timeline .timeline-item');
        for (let i = 0; i < items.length; i++) {
            // Remove all status classes first
            items[i].classList.remove('completed', 'current', 'pending');
            
            // Apply appropriate status class
            if (i < currentIdx) {
                items[i].classList.add('completed');
            } else if (i === currentIdx) {
                items[i].classList.add('current');
            } else {
                items[i].classList.add('pending');
            }
            
            // Update descriptions on main timeline too
            const stepType = items[i].dataset.step;
            const descEl = items[i].querySelector('p');
            
            if (stepType === 'interview' && descEl) {
                if (statusKey === 'interview_completed') {
                    descEl.innerHTML = '<strong style="color: green;">✓ Completed</strong>';
                } else if (interview && interview.date) {
                    descEl.innerHTML = `${interview.date} at ${interview.time || 'TBA'}`;
                } else {
                    descEl.textContent = 'No interview scheduled.';
                }
            }
            
            if (stepType === 'demo' && descEl) {
                if (statusKey === 'demo_completed') {
                    descEl.innerHTML = '<strong style="color: green;">✓ Completed</strong>';
                } else if (demoTeaching && demoTeaching.date) {
                    descEl.innerHTML = `${demoTeaching.date} at ${demoTeaching.time || 'TBA'}`;
                } else if (statusKey === 'interview_completed') {
                    descEl.textContent = 'Pending';
                } else {
                    descEl.textContent = 'Pending';
                }
            }
            
            if (stepType === 'result' && descEl) {
                if (statusKey === 'approved' || statusKey === 'onboarding') {
                    descEl.innerHTML = '<strong style="color: green;">APPROVED</strong>';
                } else if (statusKey === 'rejected') {
                    descEl.innerHTML = '<strong style="color: red;">Not approved</strong>';
                } else {
                    descEl.textContent = 'Pending';
                }
            }
            
            if (stepType === 'decision' && descEl) {
                if (statusKey === 'archived') {
                    descEl.innerHTML = '<strong style="color: green;">✓ Complete</strong>';
                } else if (statusKey === 'onboarding') {
                    descEl.textContent = 'In progress';
                } else {
                    descEl.textContent = 'Pending';
                }
            }
        }
    }

    // Open notification detail modal
    function openNotificationModal(notification) {
        const overlay = document.getElementById('notificationModalOverlay');
        const titleEl = document.getElementById('notificationModalTitle');
        const senderEl = document.getElementById('notificationModalSender');
        const messageEl = document.getElementById('notificationModalMessage');
        const dateEl = document.getElementById('notificationModalDate');
        
        if (!overlay) return;
        
        // Populate modal content
        if (titleEl) titleEl.textContent = notification.title || 'Notification';
        if (senderEl) senderEl.textContent = 'From: AlpHFAbet Admin';
        if (messageEl) messageEl.textContent = notification.message || '';
        if (dateEl) dateEl.textContent = formatForDisplay(notification.createdAt || notification.timestamp);
        
        // Show modal
        overlay.style.display = 'flex';
        
        // Set up close handlers
        setupNotificationModalCloseHandlers();
    }

    // Close notification modal
    function closeNotificationModal() {
        const overlay = document.getElementById('notificationModalOverlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
    }

    // Set up close handlers for notification modal
    function setupNotificationModalCloseHandlers() {
        const overlay = document.getElementById('notificationModalOverlay');
        const closeBtn = document.getElementById('notificationModalClose');
        
        // Close button click
        if (closeBtn) {
            closeBtn.onclick = closeNotificationModal;
        }
        
        // Click outside modal (on overlay)
        if (overlay) {
            overlay.onclick = function(e) {
                if (e.target === overlay) {
                    closeNotificationModal();
                }
            };
        }
        
        // ESC key
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                closeNotificationModal();
            }
        });
    }

    // ============================================
    // VIEW MESSAGE DETAIL MODAL (Simple Design)
    // ============================================
    
    // Open message detail modal
    function openViewMessageModal(message) {
        const overlay = document.getElementById('viewMessageModalOverlay');
        const fromEl = document.getElementById('viewMessageModalFrom');
        const subjectEl = document.getElementById('viewMessageModalSubject');
        const bodyEl = document.getElementById('viewMessageModalBody');
        const attachmentEl = document.getElementById('viewMessageModalAttachment');
        const dateEl = document.getElementById('viewMessageModalDate');
        
        if (!overlay) return;
        
        // Determine sender display name
        let senderDisplay = 'AlpHFAbet Admin';
        if (message.senderRole === 'admin' || message.sender === 'admin' || (message.senderName && message.senderName.toLowerCase().includes('admin'))) {
            senderDisplay = 'AlpHFAbet Admin';
        } else if (message.senderName) {
            senderDisplay = message.senderName;
        }
        
        // Populate modal content
        if (fromEl) {
            fromEl.textContent = 'From: ' + senderDisplay;
        }
        
        if (subjectEl) {
            subjectEl.textContent = message.subject || '(No Subject)';
        }
        
        if (bodyEl) {
            bodyEl.textContent = message.body || message.message || '';
        }
        
        // Handle attachment if present
        if (attachmentEl) {
            if (message.attachment && message.attachment.url) {
                const att = message.attachment;
                const fileSize = att.size ? ' (' + (att.size / 1024).toFixed(1) + ' KB)' : '';
                
                attachmentEl.innerHTML = '<strong>Attachment:</strong>' +
                    '<a href="' + escapeHtml(att.url) + '" target="_blank" rel="noopener noreferrer">' +
                    '<i class="fas fa-download"></i> ' + escapeHtml(att.filename || 'Download File') +
                    '</a>' +
                    '<span class="file-size">' + escapeHtml(fileSize) + '</span>';
                
                attachmentEl.classList.add('has-attachment');
            } else {
                attachmentEl.innerHTML = '';
                attachmentEl.classList.remove('has-attachment');
            }
        }
        
        if (dateEl) {
            const formattedDate = formatForDisplay(message.createdAt || message.timestamp || message.sentAt);
            dateEl.textContent = formattedDate;
        }
        
        // Show modal
        overlay.style.display = 'flex';
        
        // Set up close handlers
        setupViewMessageModalCloseHandlers();
    }
    
    // Close message modal
    function closeViewMessageModal() {
        const overlay = document.getElementById('viewMessageModalOverlay');
        if (overlay) {
            overlay.style.display = 'none';
        }
    }
    
    // Setup message modal close handlers
    function setupViewMessageModalCloseHandlers() {
        const overlay = document.getElementById('viewMessageModalOverlay');
        const closeBtn = document.getElementById('viewMessageModalClose');
        
        // Close button click
        if (closeBtn) {
            closeBtn.onclick = closeViewMessageModal;
        }
        
        // Click outside modal (on overlay)
        if (overlay) {
            overlay.onclick = function(e) {
                if (e.target === overlay) {
                    closeViewMessageModal();
                }
            };
        }
        
        // ESC key
        document.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                closeViewMessageModal();
            }
        });
    }

    // Start polling for notifications
    function startNotificationPolling() {
        // Fetch immediately
        fetchNotifications();
        
        // Then poll every 30 seconds
        if (notificationPollTimer) {
            clearInterval(notificationPollTimer);
        }
        
        notificationPollTimer = setInterval(function() {
            fetchNotifications();
        }, 30000); // 30 seconds
        
        console.log('[Notifications] Polling started');
    }

    // Stop polling (cleanup)
    function stopNotificationPolling() {
        if (notificationPollTimer) {
            clearInterval(notificationPollTimer);
        }
    }
    // ----------------- Application Status population helpers -----------------

    // Populate the application-status view (reads from normalized applicant state)
    // Build and write applicant fields into the #application-status card
    function populateApplicationStatus(state) {
        if (!state) return;

        function set(id, val) {
            const el = document.getElementById(id);
            if (!el) return;
            el.textContent = (val === null || val === undefined || (typeof val === 'string' && val.trim() === '')) ? '—' : String(val);
        }

        // Build full name from firstName, middleName (if present), lastName. Fallback to displayName.
        const first = (state.firstName || '').toString().trim();
        const middle = (state.middleName || '').toString().trim();
        const last = (state.lastName || '').toString().trim();
        const parts = [];
        if (first) parts.push(first);
        if (middle) parts.push(middle);
        if (last) parts.push(last);
        const fullName = parts.length ? parts.join(' ') : (state.displayName || '');

        // Map fields (robust to a few variant key names)
        const email = state.email || state.contactEmail || '';
        let phone = state.phone || state.contactNumber || state.contact || '';
        
        // Ensure phone has +63 format
        if (phone && !phone.startsWith('+63')) {
            phone = phone.replace(/^0/, '+63');
        }
        
        const address = state.address || '';
        const birthdate = state.birthDate || state.birthdate || '';
        const preferredLevel = state.preferredLevel || state.preferred || '';
        const degree = state.degree || state.highestDegree || '';
        const major = state.major || '';
        const institution = state.institution || '';
        const gradYear = state.gradYear || state.yearGraduated || '';
        const experience = state.experience || state.experienceYears || '';
        const previousSchools = Array.isArray(state.previousSchools) ? state.previousSchools.join(', ') : (state.previousSchools || '');
        const subjects = Array.isArray(state.subjects) ? state.subjects.join(', ') : (state.subjects || state.qualifiedSubjects || '');
        const employment = state.employment || state.employmentType || '';

        // Write to DOM (these IDs must exist in your teacher.html)
        set('status-fullname', fullName || state.displayName || '—');
        set('status-email', email || '—');
        set('status-phone', phone || '—');
        set('status-address', address || '—');
        set('status-birthdate', birthdate || '—');

        set('status-preferred-level', preferredLevel || '—');
        set('status-degree', degree || '—');
        set('status-major', major || '—');
        set('status-institution', institution || '—');
        set('status-gradyear', gradYear || '—');
        set('status-experience', experience || '—');
        set('status-previous-schools', previousSchools || '—');
        set('status-subjects', subjects || '—');
        set('status-employment', employment || '—');

        // update submitted-at in two possible places (safe if HTML has duplicate id)
        const submittedVal = state.submittedAt || state.createdAt || null;
        const submittedDisplay = formatForDisplay(submittedVal);
        const el1 = document.getElementById('status-submitted-at');
        if (el1) el1.textContent = 'Submitted: ' + (submittedDisplay || '—');
        const el2 = document.getElementById('submitted-at-timeline');
        if (el2) el2.textContent = 'Submitted: ' + (submittedDisplay || '—');

        // Interview info mapping
        if (state.interview && (state.interview.date || state.interview.location)) {
            const dateEl = document.getElementById('status-interview-date');
            const detailsEl = document.getElementById('status-interview-details');
            if (dateEl) dateEl.textContent = state.interview.date || '—';
            if (detailsEl) detailsEl.textContent = state.interview.location || '—';
            const infoEl = document.getElementById('status-interview-info');
            if (infoEl) infoEl.style.display = 'block';
        } else {
            const infoEl = document.getElementById('status-interview-info');
            if (infoEl) infoEl.style.display = 'none';
        }
    }

    // expose for convenience/debugging
    try { window.populateApplicationStatus = populateApplicationStatus; } catch (e) {}

    function updateApplicationStatusTimeline(statusKey, interview, demoTeaching) {
        // Simple 6-step mapping to keep UI clean
        const statusToStep = {
            'submitted': 0,
            'reviewing': 1,
            'screening': 1,
            'interview_scheduled': 2,
            'interview_confirmed': 2,
            'interview_completed': 2,  // Keep at interview step but update text
            'demo_scheduled': 3,        // Move to demo step
            'demo_completed': 3,        // Stay at demo step but show completed
            'demo': 3,                  
            'result': 4,
            'decision': 4,
            'approved': 4,              // Show at result step
            'rejected': 4,              // Show at result step
            'onboarding': 5,
            'archived': 5,              // Stay at onboarding but show completed
            'hired': 5
        };
        
        const currentStepIndex = statusToStep[statusKey] !== undefined ? statusToStep[statusKey] : 0;
        const items = document.querySelectorAll('#app-status-timeline .timeline-item');
        
        // Update each timeline item
        items.forEach((item, index) => {
            // Remove all state classes first
            item.classList.remove('completed', 'current', 'pending');
            
            // Apply appropriate state class
            if (index < currentStepIndex) {
                // Past steps - completed (green)
                item.classList.add('completed');
            } else if (index === currentStepIndex) {
                // Current step - active (blue with pulse)
                item.classList.add('current');
            } else {
                // Future steps - pending (gray/default)
                item.classList.add('pending');
            }
            
            // Update step descriptions dynamically based on actual status
            const stepType = item.dataset.step;
            const descEl = item.querySelector('p');
            
            if (stepType === 'interview' && descEl) {
                // Update interview step description
                if (statusKey === 'interview_completed') {
                    descEl.innerHTML = '<strong style="color: green;">✓ Interview completed successfully</strong>';
                } else if (interview && interview.date) {
                    descEl.innerHTML = `Scheduled: <strong>${interview.date} at ${interview.time || 'TBA'}</strong>`;
                } else {
                    descEl.textContent = 'No interview scheduled.';
                }
            }
            
            if (stepType === 'demo' && descEl) {
                // Update demo teaching step description
                if (statusKey === 'demo_completed') {
                    descEl.innerHTML = '<strong style="color: green;">✓ Demo teaching completed</strong>';
                } else if (statusKey === 'demo_scheduled' && demoTeaching && demoTeaching.date) {
                    descEl.innerHTML = `Scheduled: <strong>${demoTeaching.date} at ${demoTeaching.time || 'TBA'}</strong><br>Location: ${demoTeaching.location || 'TBA'}`;
                } else if (statusKey === 'interview_completed') {
                    descEl.innerHTML = '<em>Awaiting demo schedule</em>';
                } else {
                    descEl.textContent = 'Will be scheduled after successful interview.';
                }
            }
            
            if (stepType === 'result' && descEl) {
                // Update result step description
                if (statusKey === 'approved' || statusKey === 'onboarding') {
                    descEl.innerHTML = '<strong style="color: green;">✓ Application APPROVED!</strong>';
                } else if (statusKey === 'rejected') {
                    descEl.innerHTML = '<strong style="color: red;">Application not approved</strong>';
                } else if (statusKey === 'demo_completed') {
                    descEl.innerHTML = '<em>Evaluation in progress...</em>';
                } else {
                    descEl.textContent = 'Will be determined after the demo teaching.';
                }
            }
            
            if (stepType === 'decision' && descEl) {
                // Update onboarding step description
                if (statusKey === 'archived') {
                    descEl.innerHTML = '<strong style="color: green;">✓ Onboarding complete! Welcome to HFA!</strong>';
                } else if (statusKey === 'onboarding') {
                    descEl.innerHTML = '<em>Onboarding in progress...</em>';
                } else {
                    descEl.textContent = 'Administration will review all evaluation results.';
                }
            }
        });

        // Interview info
        const interviewMeta = document.getElementById('status-interview-info');
        if (interview && (interview.date || interview.location)) {
            const dateEl = document.getElementById('status-interview-date');
            const detailsEl = document.getElementById('status-interview-details');
            if (dateEl) dateEl.textContent = interview.date || '—';
            if (detailsEl) detailsEl.textContent = interview.location || '—';
            if (interviewMeta) interviewMeta.style.display = 'block';
        } else {
            if (interviewMeta) interviewMeta.style.display = 'none';
        }
        
        // Demo teaching info (if available)
        const demoMeta = document.getElementById('status-demo-info');
        if (demoTeaching && (demoTeaching.date || demoTeaching.location)) {
            // Create demo info element if it doesn't exist
            if (!demoMeta) {
                const demoInfoHtml = `
                    <div id="status-demo-info" class="timeline-meta" style="margin-top: 10px;">
                        <h4>Demo Teaching Scheduled</h4>
                        <p><strong>Date:</strong> <span id="status-demo-date">${demoTeaching.date || '—'}</span> at ${demoTeaching.time || '—'}</p>
                        <p><strong>Location:</strong> <span id="status-demo-location">${demoTeaching.location || 'TBA'}</span></p>
                        ${demoTeaching.subject ? `<p><strong>Subject:</strong> ${demoTeaching.subject}</p>` : ''}
                        ${demoTeaching.notes ? `<p><strong>Notes:</strong> ${demoTeaching.notes}</p>` : ''}
                    </div>
                `;
                // Insert after interview info or at the end of timeline
                const timelineContainer = document.querySelector('#app-status-timeline');
                if (timelineContainer) {
                    timelineContainer.insertAdjacentHTML('afterend', demoInfoHtml);
                }
            } else {
                // Update existing demo info
                const dateEl = document.getElementById('status-demo-date');
                const locationEl = document.getElementById('status-demo-location');
                if (dateEl) dateEl.textContent = `${demoTeaching.date || '—'} at ${demoTeaching.time || '—'}`;
                if (locationEl) locationEl.textContent = demoTeaching.location || 'TBA';
                demoMeta.style.display = 'block';
            }
        } else {
            if (demoMeta) demoMeta.style.display = 'none';
        }
    }

    // ----------------- Message modal logic (use existing modal & toast template) -----------------
    const btnMessage = document.getElementById('btn-message-admin');
    const btnCompose = document.getElementById('btn-compose');
    const modalOverlay = document.getElementById('hfaMsgModalOverlay');
    const modalSend = document.getElementById('hfaMsgSendBtn');
    const modalCancel = document.getElementById('hfaMsgCancelBtn');
    const modalClose = document.getElementById('hfaMsgClose');
    const inputRecipient = document.getElementById('hfaMsgRecipient');
    const inputSubject = document.getElementById('hfaMsgSubject');
    const inputBody = document.getElementById('hfaMsgBody');
    const modalError = document.getElementById('hfaMsgError');
    const toastTemplate = document.getElementById('toast-template');

    function openMessageModal() {
        if (!modalOverlay) return;
        // prefill recipient and keep readonly
        if (inputRecipient) {
            inputRecipient.value = 'Admissions';
            inputRecipient.setAttribute('readonly', 'readonly');
        }
        if (inputSubject) inputSubject.value = '';
        if (inputBody) inputBody.value = '';
        if (modalError) modalError.textContent = '';
        if (modalSend) modalSend.disabled = true;

        modalOverlay.style.display = 'flex';
        modalOverlay.setAttribute('aria-hidden', 'false');
        if (inputBody) inputBody.focus();
    }

    function closeMessageModal() {
        if (!modalOverlay) return;
        modalOverlay.style.display = 'none';
        modalOverlay.setAttribute('aria-hidden', 'true');
    }

    // enable send only if body has content
    if (inputBody && modalSend) {
        inputBody.addEventListener('input', function () {
            modalSend.disabled = inputBody.value.trim().length === 0;
            if (modalError) modalError.textContent = '';
        });
    }

    if (btnMessage) btnMessage.addEventListener('click', openMessageModal);
    if (btnCompose) btnCompose.addEventListener('click', openMessageModal);
    if (modalClose) modalClose.addEventListener('click', closeMessageModal);
    if (modalCancel) modalCancel.addEventListener('click', closeMessageModal);

    // append note to UI (after successful send)
    function appendNoteToUI(note) {
        if (!note) return;
        if (!applicantState.messages) applicantState.messages = [];
        applicantState.messages.push(note);
        renderNotes();
    }

    // show toast using your existing template (#toast-template)
    function showToast(message, actionText) {
        if (!toastTemplate) {
            // fallback: simple alert
            try { alert(message); } catch (e) {}
            return;
        }
        const clone = toastTemplate.content.firstElementChild.cloneNode(true);
        const msgEl = clone.querySelector('.toast-message');
        const actBtn = clone.querySelector('.toast-action');
        if (msgEl) msgEl.textContent = message;
        if (actBtn) {
            if (actionText) {
                actBtn.style.display = 'inline-block';
                actBtn.textContent = actionText;
            } else {
                actBtn.style.display = 'none';
            }
        }
        document.body.appendChild(clone);
        // auto remove after 3s
        setTimeout(function () {
            if (clone && clone.parentNode) clone.parentNode.removeChild(clone);
        }, 3200);
    }

    // Send message to server (now uses loaded applicantState.id and cookie/Authorization)
    if (modalSend) {
        modalSend.addEventListener('click', async function () {
            const bodyText = inputBody ? inputBody.value.trim() : '';
            const subject = inputSubject ? inputSubject.value.trim() : '';
            const applicantId = applicantState.id || window.CURRENT_APPLICANT_ID || '';

            if (!bodyText) {
                if (modalError) modalError.textContent = 'Message cannot be empty.';
                return;
            }

            // payload
            const payload = {
                applicantId: applicantId,
                subject: subject,
                body: bodyText
            };

            modalSend.disabled = true;
            modalSend.textContent = 'Sending...';

            try {
                const res = await fetch('/api/applicant-messages', {
                    method: 'POST',
                    credentials: 'include', // JWT cookie sent automatically
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (res.status === 401) {
                    logoutAndRedirect("../login/login.html");
                    return;
                }

                const data = await res.json().catch(() => ({ ok: false, error: 'Server error' }));
                if (!data || !data.ok) {
                    throw new Error((data && data.error) ? data.error : 'Failed to send message');
                }

                // Refresh messages from server to ensure persistence and correct ordering
                await loadApplicantMessages();

                closeMessageModal();
                showToast('Message sent — Admissions will respond soon.');
            } catch (err) {
                console.error('Send message failed', err);
                if (modalError) modalError.textContent = 'Failed to send message. Please try again.';
                showToast('Failed to send message.');
            } finally {
                if (modalSend) {
                    modalSend.disabled = false;
                    modalSend.textContent = 'Send';
                }
            }
        });
    }

    // ---------- Attachments upload UI-only (client-side) ----------
    const uploadBtn = document.getElementById('btn-upload');
    const fileInput = document.getElementById('file-input');

    if (uploadBtn && fileInput) {
        uploadBtn.addEventListener('click', function () {
            fileInput.click();
        });

        fileInput.addEventListener('change', function (e) {
            const files = Array.prototype.slice.call(e.target.files || []);
            if (!files || files.length === 0) return;
            files.forEach(function (f) {
                if (!applicantState.attachments) applicantState.attachments = [];
                // placeholder URL — integrate actual upload server later
                applicantState.attachments.push({ fileName: f.name, filePath: '', fileUrl: '#' });
            });
            renderAttachments();
            // TODO: integrate server upload endpoint (server/routes/files.js)
            fileInput.value = '';
        });
    }

    // Control upload button visibility based on application status
    function updateAttachmentsUploadVisibility() {
        const uploadBtn = document.getElementById('btn-upload');
        if (!uploadBtn) return;

        // Only allow uploads when applicant reaches onboarding stage (final stage before hiring)
        // "approved" is too early - need to wait until "onboarding" status
        const allowedStatuses = ['onboarding', 'hired', 'accepted'];
        const canUpload = allowedStatuses.includes(applicantState.status);

        if (canUpload) {
            uploadBtn.style.display = 'inline-block';
        } else {
            uploadBtn.style.display = 'none';
        }
    }

    // ---------- Signed-url helpers ----------
    async function getSignedUrlOwner(path, ttl) {
        ttl = ttl || 60;
        const q = '?path=' + encodeURIComponent(path) + '&ttl=' + encodeURIComponent(String(ttl));

        const res = await fetch('/api/signed-url-owner' + q, {
            method: 'GET',
            credentials: 'include',
            headers: { 'Accept': 'application/json' }
        });
        if (res.status === 401) {
            // not authorized -> logout
            logoutAndRedirect("../login/login.html");
            return;
        }
        if (!res.ok) {
            const txt = await res.text().catch(() => '');
            let parsed = null;
            try { parsed = JSON.parse(txt); } catch (e) { parsed = txt; }
            const err = new Error('signed-url-owner failed: ' + res.status);
            err.payload = parsed;
            throw err;
        }
        const data = await res.json();
        if (!data || !data.url) throw new Error('signed-url-owner returned no url');
        return data.url;
    }

    async function getSignedUrlAdmin(path, ttl) {
        ttl = ttl || 60;
        const q = '?path=' + encodeURIComponent(path) + '&ttl=' + encodeURIComponent(String(ttl));

        const res = await fetch('/api/signed-url' + q, {
            method: 'GET',
            credentials: 'include',
            headers: { 'Accept': 'application/json' }
        });

        if (res.status === 401) {
            logoutAndRedirect("../login/login.html");
            return;
        }

        if (!res.ok) {
            const txt = await res.text().catch(() => '');
            let parsed = null;
            try { parsed = JSON.parse(txt); } catch (e) { parsed = txt; }
            const err = new Error('signed-url admin failed: ' + res.status);
            err.payload = parsed;
            throw err;
        }
        const data = await res.json();
        if (!data || !data.url) throw new Error('signed-url returned no url');
        return data.url;
    }

    //  Application Status Refresh Button Handler 
    const statusRefreshBtn = document.getElementById('status-refresh-btn');
    if (statusRefreshBtn) {
        statusRefreshBtn.addEventListener('click', async function () {
            statusRefreshBtn.disabled = true;
            const orig = statusRefreshBtn.textContent;
            statusRefreshBtn.textContent = 'Refreshing…';
            try {
                const loaded = await loadApplicant();
                if (!loaded) {
                    // loadApplicant handles redirect/toast
                    return;
                }
                populateApplicationStatus(applicantState);
                await loadApplicantMessages();
                // populate the static status panel

                updateApplicationStatusTimeline(applicantState.status, applicantState.interview, applicantState.demoTeaching);
                // refresh other UI
                renderOverviewCards();
                renderAttachments();
                renderNotes();
                fetchNotifications(); // Refresh notifications from API
                updateTimeline(applicantState.status, applicantState.interview, applicantState.demoTeaching); // existing dashboard timeline
                updateAttachmentsUploadVisibility();
            } catch (err) {
                console.error('status refresh failed', err);
                showToast('Refresh failed. Check console.');
            } finally {
                statusRefreshBtn.disabled = false;
                statusRefreshBtn.textContent = orig || 'Refresh';
            }
        });
    }
    // ---------- Update sidebar display name ----------
    function updateSidebarDisplayName() {
        const sidebarNameEl = document.querySelector('.Teacher-name');
        if (sidebarNameEl) {
            // Try to build full name from firstName, middleName, lastName
            const first = (applicantState.firstName || '').trim();
            const middle = (applicantState.middleName || '').trim();
            const last = (applicantState.lastName || '').trim();
            
            const parts = [];
            if (first) parts.push(first);
            if (middle) parts.push(middle);
            if (last) parts.push(last);
            
            const fullName = parts.length ? parts.join(' ') : (applicantState.displayName || 'Teacher');
            sidebarNameEl.textContent = fullName;
        }
    }

    // ---------- Initialize UI (render everything) ----------
    async function init() {
        // load applicant from server then render
        const loaded = await loadApplicant();
        if (!loaded) {
            // load failed: either redirected or toast shown
            return;
        }
        // Load messages explicitly from server so they persist after refresh
        await loadApplicantMessages();

        // Update sidebar with user's display name
        updateSidebarDisplayName();

        // Render UI using loaded applicantState
        renderOverviewCards();
        renderAttachments();
        renderNotes();
        
        // Start notification polling (fetches and renders automatically)
        startNotificationPolling();

        // update dashboard timeline
        updateTimeline(applicantState.status, applicantState.interview, applicantState.demoTeaching);
        
        // update upload button visibility based on status
        updateAttachmentsUploadVisibility();

        // populate the static Application Status panel (left fields) and its timeline (right)
        try {
            populateApplicationStatus(applicantState);
            updateApplicationStatusTimeline(applicantState.status, applicantState.interview, applicantState.demoTeaching);
        } catch (e) {
            console.warn('populateApplicationStatus failed', e);
        }
    }
    // Call init (do not block DOMContentLoaded)
    init().catch(function (err) {
        console.error('init failed', err);
    });

    // ========== Profile Settings Logic ==========
    
    const profileDisplayName = document.getElementById('profile-displayname');
    const profileEmail = document.getElementById('profile-email');
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

    // Load current user profile data
    async function loadProfileData() {
        try {
            const res = await fetch('/api/teacher/profile', {
                method: 'GET',
                credentials: 'include',
                headers: { 'Accept': 'application/json' }
            });

            if (res.status === 401) {
                logoutAndRedirect("../login/login.html");
                return;
            }

            if (!res.ok) {
                throw new Error('Failed to load profile');
            }

            const data = await res.json();
            
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
            
            // Pre-fill edit field for phone (remove +63 prefix)
            if (profilePhone) {
                const phoneNum = (data.phone || '').replace(/^\+63/, '');
                profilePhone.value = phoneNum;
            }

        } catch (error) {
            console.error('Load profile error:', error);
            showProfileMessage('Failed to load profile data', 'error');
        }
    }

    // Save profile changes (phone number only for teacher)
    if (saveProfileBtn) {
        saveProfileBtn.addEventListener('click', async function() {
            const phone = profilePhone ? profilePhone.value.trim() : '';

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
                const res = await fetch('/api/teacher/profile', {
                    method: 'PUT',
                    credentials: 'include',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    body: JSON.stringify({
                        phone: phone ? `+63${phone}` : null
                    })
                });

                if (res.status === 401) {
                    logoutAndRedirect("../login/login.html");
                    return;
                }

                const data = await res.json();

                if (!res.ok || !data.ok) {
                    throw new Error(data.error || 'Failed to update profile');
                }

                showProfileMessage('Profile updated successfully!', 'success');

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
                const res = await fetch('/api/teacher/change-password', {
                    method: 'POST',
                    credentials: 'include',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    body: JSON.stringify({
                        currentPassword: currentPassword,
                        newPassword: newPassword
                    })
                });

                if (res.status === 401) {
                    logoutAndRedirect("../login/login.html");
                    return;
                }

                const data = await res.json();

                if (!res.ok || !data.ok) {
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

    // Show profile message (success/error)
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

    // Expose small helpers for debugging (optional)
    window._teacherApp = {
        state: applicantState,
        renderOverview: renderOverviewCards,
        renderNotes: renderNotes,
        renderNotifications: renderNotifications,
        renderAttachments: renderAttachments,
        updateTimeline: updateTimeline,
        updateAttachmentsUploadVisibility: updateAttachmentsUploadVisibility,
        openMessageModal: openMessageModal,
     //   getAuthToken: getAuthToken,
        loadApplicant: loadApplicant,
        loadApplicantMessages: loadApplicantMessages,
        loadProfileData: loadProfileData
    };
}); // end DOMContentLoaded
