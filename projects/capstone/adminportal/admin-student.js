// admin-student.js (drop-in ready) - namespaced student modal hfa-stu-*
// Keep firebase-config import path consistent
import { db } from '../firebase-config.js';
import {
  collection,
  onSnapshot,
  doc,
  updateDoc,
  serverTimestamp,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { apiFetch } from '../api-fetch.js';

/* ------------------ Required Documents Definition ------------------ */

const REQUIRED_DOCUMENTS = {
  new: [
    { key: 'reportcard', label: 'Report Card (Form 138)' },
    { key: 'psa', label: 'PSA Birth Certificate' }
  ],
  returning: [
    { key: 'clearance', label: 'Clearance Certificate' },
    { key: 'reportcard', label: 'Report Card (Form 138)' }
  ]
};

/* ------------------ App state & DOM references ------------------ */

const applicantsMap = new Map();
const studentsBody = document.getElementById('students-body');

const tableView = document.getElementById('table-view');
const tableBtn = document.querySelector('[data-view="table"]');
const searchInput = document.getElementById('search-input');
const filterStatus = document.getElementById('filter-status');
const sortBy = document.getElementById('sort-by');
const counts = {
  total:    document.getElementById('count-total'),
  enrolled: document.getElementById('count-enrolled'),
  complete: document.getElementById('count-complete')
};

/* ----- Namespaced student modal DOM (hfa-stu-*) ----- */
const stuOverlay = document.getElementById('hfa-stu-modal-overlay');
const stuModal = document.getElementById('hfa-stu-modal');

const stuClose2 = document.getElementById('hfa-stu-close-2');

const stuTitle = document.getElementById('hfa-stu-title');

const stuTypeEl = document.getElementById('hfa-stu-type');
const stuGradeEl = document.getElementById('hfa-stu-grade');
const systemID = document.getElementById('systemID');

const stuEditBtn = document.getElementById('hfa-stu-edit-btn');
const stuArchiveBtn = document.getElementById('hfa-stu-archive-btn');

const stuReqList = document.getElementById('hfa-stu-requirements-list');
const stuDocsList = document.getElementById('hfa-stu-documents');

const stuIdEl = document.getElementById('hfa-stu-id');
const stuFirstEl = document.getElementById('hfa-stu-first');
const stuLastEl = document.getElementById('hfa-stu-last');
const stuMiddleEl = document.getElementById('hfa-stu-middle');
const stuBirthEl = document.getElementById('hfa-stu-birth');
const stuContactEl = document.getElementById('hfa-stu-contact');
const stuAddressEl = document.getElementById('hfa-stu-address');
const stuGrade2El = document.getElementById('hfa-stu-grade2');
const stuTrackEl = document.getElementById('hfa-stu-track');
const stuUpdatedEl = document.getElementById('hfa-stu-updated');
const stuEmailEl = document.getElementById('hfa-stu-email');

const stuInlineConfirm = document.getElementById('hfa-stu-inline-confirm');
const stuConfirmYes = document.getElementById('hfa-stu-confirm-yes');
const stuConfirmNo = document.getElementById('hfa-stu-confirm-no');

/* Enrollment confirmation modal elements (your HTML) */
const enrollModal = document.getElementById('enroll-modal');
const enrollCloseBtn = document.getElementById('enroll-close-btn');
const enrollCancelBtn = document.getElementById('enroll-cancel-btn');
const enrollConfirmBtn = document.getElementById('confirm-enroll-btn');
let _enrollState = { app: null };

/* Message modal (unchanged names) */
const messageModalOverlay = document.getElementById('hfaMsgModalOverlay');
const messageModal = document.getElementById('hfaMsgModal');
const messageSendBtn = document.getElementById('hfaMsgSendBtn');
const messageCancelBtn = document.getElementById('hfaMsgCancelBtn');
const messageRecipient = document.getElementById('hfaMsgRecipient');
const messagePhone = document.getElementById('hfaMsgPhone');
const messageSubject = document.getElementById('hfaMsgSubject');
const messageBody = document.getElementById('hfaMsgBody');
const messageError = document.getElementById('hfaMsgError');
const messageClose = document.getElementById('hfaMsgClose');

/* toast container/template (keep as in your HTML) */
const toastContainer = document.getElementById('admin-toast-container');
const toastTemplate  = document.getElementById('toast-template');

/* other UI state */
let activeTab     = 'all';
let debounceTimer = null;
let currentModalApp = null;

let _messageModalState = { app: null, afterEnroll: false };

/* Pagination state */
let currentPage = 1;
const rowsPerPage = 10;
const paginationControls = document.getElementById('pagination-controls');
const prevPageBtn = document.getElementById('prev-page');
const nextPageBtn = document.getElementById('next-page');
const currentPageNum = document.getElementById('current-page-num');
const totalPagesNum = document.getElementById('total-pages-num');
const showingCount = document.getElementById('showing-count');
const totalCountEl = document.getElementById('total-count');

/* Edit mode state (conditional approach) */
let isEditingStudent = false;

/* ------------------ Helper: Signed URL cache & request ------------------ */

// caches signed urls: key = path, value = { url, expiresAt (ms) }
const signedUrlCache = new Map();
// TTL default (seconds)
const DEFAULT_SIGNED_URL_TTL = 300; // 5 minutes


async function getSignedUrlForPath(path, ttlSeconds = DEFAULT_SIGNED_URL_TTL) {
  if (!path) throw new Error("Missing path");
  // if path already is a full URL, return as-is
  if (path.startsWith("http://") || path.startsWith("https://")) return path;

  const cached = signedUrlCache.get(path);
  const now = Date.now();
  if (cached && cached.url && cached.expiresAt && cached.expiresAt > (now + 5000)) {
    // cached and not about to expire (headroom 5s)
    return cached.url;
  }

  // Request from server (cookie handles auth)
  const url = `/api/files/signed-url?path=${encodeURIComponent(path)}&ttl=${Math.min(ttlSeconds, DEFAULT_SIGNED_URL_TTL)}`;

  // try fetch with credentials to send cookie
  let resp = await fetch(url, { credentials: 'include', cache: 'no-store' });
  if (!resp.ok) {
    // try once more (some transient server issues)
    console.warn("[getSignedUrlForPath] first attempt failed", resp.status);
    resp = await fetch(url, { credentials: 'include', cache: 'no-store' });
  }

  if (!resp.ok) {
    const txt = await resp.text().catch(()=>"");
    throw new Error(`Signed-url request failed ${resp.status} ${txt}`);
  }

  const body = await resp.json().catch(() => null);
  if (!body || !body.ok || !body.url) {
    throw new Error(`Signed-url response invalid: ${JSON.stringify(body)}`);
  }

  signedUrlCache.set(path, { url: body.url, expiresAt: body.expiresAt || (Date.now() + (ttlSeconds*1000)) });
  return body.url;
}

function cleanPathForRequest(path) {
  if (!path) return '';
  let p = ('' + path).trim();
  // remove surrounding angle brackets or whitespace
  p = p.replace(/^[<\s]+|[>\s]+$/g, '');
  // if path starts with the bucket name 'uploads/', remove it since server expects object path
  if (p.startsWith('uploads/')) p = p.slice('uploads/'.length);
  // remove leading slash
  if (p.startsWith('/')) p = p.slice(1);
  return p;
}
/* ------------------ Utility helpers ------------------ */
// requirements
function normalizeRequirements(rawReqs) {
  const out = {};
  if (!rawReqs || typeof rawReqs !== 'object') return out;
  Object.entries(rawReqs).forEach(([k, v]) => {
    if (v === null || v === undefined) {
      out[k] = { label: prettifyKey(k), checked: false };
    } else if (typeof v === 'boolean') {
      out[k] = { label: prettifyKey(k), checked: !!v };
    } else if (typeof v === 'object') {
      // possible shapes: { checked: true/false, label: '...' } or older shapes
      const checked = !!(v.checked || v.isChecked || v.present || v === true);
      const label = v.label || v.name || prettifyKey(k);
      out[k] = { label, checked };
    } else {
      // fallback
      out[k] = { label: prettifyKey(k), checked: false };
    }
  });
  return out;
}

function prettifyKey(k) {
  if (!k) return '';
  return k.replace(/[_\-]+/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .replace(/\b\w/g, ch => ch.toUpperCase());
}

function formatDateTime(d) {
  if (!d) return '-';
  try {
    const dt = (d && d.toDate) ? d.toDate() : ((d instanceof Date) ? d : new Date(d));
    const opts = { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };
    return dt.toLocaleString(undefined, opts);
  } catch (e) {
    return String(d);
  }
}
/* normalize applicant document into consistent shape used by UI */
function normalizeApplicant(docId, data) {
  const raw = data || {};
  // requirements normalization: expects object with entries -> { label, checked }
  const reqs = normalizeRequirements(raw.requirements || {});
  const submittedAt = raw.createdAt && raw.createdAt.toDate ? raw.createdAt.toDate() :
                      (raw.createdAt ? new Date(raw.createdAt) : new Date());
  const archivedAt = raw.archivedAt && raw.archivedAt.toDate ? raw.archivedAt.toDate() :
                     (raw.archivedAt ? new Date(raw.archivedAt) : null);
  const first = raw.firstName || raw.first || raw.first_name || '';
  const last  = raw.lastName || raw.last || raw.last_name || '';
  // extract track robustly from many possible fields
  const track = (raw.track || raw.strand || raw.program || raw.trackName || raw.strandName || raw['academic-track'] || raw.academictrack || '') || '';
  const grade = raw.gradeLevel || raw.grade || raw.level || raw.year || raw.strand || raw.program || '';
  return {
    id: docId,
    formType: raw.formType || 'jhs',
    firstName: first,
    lastName: last,
    fullName: ((first + ' ' + last).trim()) || (raw.name || ''),
    gradeLevel: grade,
    section: raw.section || '',
    track: track,
    submittedAt,
    archivedAt,
    isNew: typeof raw.isNew === 'boolean' ? raw.isNew : true,
    requirements: reqs,
    enrolled: !!raw.enrolled,
    archived: !!raw.archived,
    raw
  };
}

function createIcon(iClass) {
  const i = document.createElement('i');
  i.className = iClass;
  i.setAttribute('aria-hidden', 'true');
  return i;
}
/* ------------------ File extraction/normalization ------------------ */

function extractFilesFromApp(raw) {
  if (!raw) return [];
  // server.finalize persisted 'documents' array: { slot, fileName, filePath, fileUrl, size, uploadedAt }
  if (Array.isArray(raw.documents)) {
    return raw.documents.map(d => normalizeFile({
      name: d.fileName || d.name || d.filename || '',
      url: d.fileUrl || d.publicUrl || d.url || d.downloadUrl || '',
      path: d.filePath || d.path || '',
      size: d.size || 0,
      mime: d.mime || d.contentType || '',
      slot: d.slot || d.field || null
    }));
  }
  // raw.documents might be object map
  if (raw.documents && typeof raw.documents === 'object' && !Array.isArray(raw.documents)) {
    return Object.values(raw.documents).map(d => normalizeFile({
      name: d.name || d.fileName || d.filename || '',
      url: d.url || d.publicUrl || d.fileUrl || '',
      path: d.path || d.filePath || '',
      size: d.size || d.bytes || 0,
      mime: d.contentType || d.mime || '',
      slot: d.slot || d.field || null
    }));
  }
  // older shapes
  if (Array.isArray(raw.uploadedFiles)) {
    return raw.uploadedFiles.map(normalizeFile);
  }
  if (Array.isArray(raw.files)) {
    return raw.files.map(normalizeFile);
  }
  if (Array.isArray(raw.uploads)) {
    return raw.uploads.map(normalizeFile);
  }
  // fallback
  return [];
}

function normalizeFile(f) {
  if (!f) return {};
  return {
    name: f.name || f.filename || f.fileName || (f.path ? f.path.split('/').pop() : ''),
    url: f.fileUrl || f.publicUrl || f.url || f.downloadUrl || '',
    path: f.filePath || f.path || '',
    size: f.size || f.bytes || 0,
    mime: f.mime || f.type || f.contentType || '',
    slot: f.slot || null
  };
}

function readableFileSize(bytes) {
  if (!bytes) return '';
  const units = ['B','KB','MB','GB','TB'];
  let i = 0;
  let v = Number(bytes);
  while (v >= 1024 && i < units.length-1) { v /= 1024; i++; }
  return `${v.toFixed(v<10?2:1)} ${units[i]}`;
}

/* ------------------ Render helpers ------------------ */

function updateCounts() {
  const list = Array.from(applicantsMap.values()).filter(a => !a.archived);
  if (counts.total) counts.total.textContent = list.length;
  if (counts.enrolled) counts.enrolled.textContent = list.filter(a => a.enrolled).length;
  if (counts.complete) counts.complete.textContent = '—';
}

function renderTableRows(list) {
  if (!studentsBody) return;
  studentsBody.innerHTML = '';
  const frag = document.createDocumentFragment();
  const template = document.getElementById('student-row-template');

  list.forEach(app => {
    if (!app) return;

    if (template && template.content) {
      const clone = template.content.cloneNode(true);
      const tr = clone.querySelector('tr');
      if (!tr) return;
      tr.dataset.id = app.id || '';

      // Note: keep same column mapping as template uses classes
      const idCell = tr.querySelector('.cell-id'); if (idCell) idCell.textContent = app.id || '-';
      const nameCell = tr.querySelector('.cell-name'); if (nameCell) {
        nameCell.textContent = app.fullName || '-';
        if (app.archived && app.archivedAt) {
          const small = document.createElement('div');
          small.className = 'muted small archived-ts';
          small.textContent = 'Archived: ' + formatDateTime(app.archivedAt);
          nameCell.appendChild(small);
        }
      }
      const gradeCell = tr.querySelector('.cell-grade'); if (gradeCell) gradeCell.textContent = app.gradeLevel || '-';
      const studentIdCell = tr.querySelector('.cell-studentid'); if (studentIdCell) studentIdCell.textContent = app.section || '-';
      const formCell = tr.querySelector('.cell-form');
      if (formCell) {
        const formType = (app.formType || '').toUpperCase();
        if (formType) {
          const cls = formType === 'SHS' ? 'shs' : 'jhs';
          formCell.innerHTML = `<span class="badge ${cls}">${formType}</span>`;
        } else {
          formCell.textContent = '-';
        }
      }
      const oldNewCell = tr.querySelector('.cell-oldnew'); if (oldNewCell) oldNewCell.textContent = app.isNew ? 'New' : 'Old';

      // Progress - removed
      const progressCell = tr.querySelector('.cell-progress');
      if (progressCell) {
        progressCell.textContent = '—';
      }

      // Status
      const statusCell = tr.querySelector('.cell-status');
      if (statusCell) {
        statusCell.innerHTML = app.enrolled ? '<span class="badge enrolled">Enrolled</span>' : '<span class="badge pending">Pending</span>';
      }

      // Remove any old delete button
      const existingDelete = tr.querySelector('.student-delete');
      if (existingDelete) existingDelete.remove();

      // Conditional rendering: Different actions based on archived status
      const actionsCell = tr.querySelector('.student-actions');
      if (actionsCell) {
        actionsCell.innerHTML = '';

        // Create grouped containers
        const group = document.createElement('div');
        group.className = 'actions-flex'; // legacy-safe wrapper (optional)
        const left = document.createElement('div');
        left.className = 'actions-left';
        const right = document.createElement('div');
        right.className = 'actions-enroll';

        if (app.archived) {
          // Only View on archived
          const viewBtn = document.createElement('button');
          viewBtn.className = 'student-btn student-view';
          viewBtn.title = 'View';
          viewBtn.appendChild(createIcon('fas fa-eye'));
          viewBtn.addEventListener('click', () => openStudentModal(app));
          left.appendChild(viewBtn);
        } else {
          // Left cluster: Message → View → Archive
          const msgBtn = document.createElement('button');
          msgBtn.className = 'student-btn student-message';
          msgBtn.title = 'Message';
          msgBtn.appendChild(createIcon('fas fa-envelope'));
          msgBtn.addEventListener('click', () => openMessageModal(app, { afterEnroll: false }));
          left.appendChild(msgBtn);

          const viewBtn = document.createElement('button');
          viewBtn.className = 'student-btn student-view';
          viewBtn.title = 'View';
          viewBtn.appendChild(createIcon('fas fa-eye'));
          viewBtn.addEventListener('click', () => openStudentModal(app));
          left.appendChild(viewBtn);

          const archiveBtn = document.createElement('button');
          archiveBtn.className = 'student-btn student-archive';
          archiveBtn.title = 'Archive';
          archiveBtn.appendChild(createIcon('fas fa-archive'));
          archiveBtn.addEventListener('click', () => openArchiveConfirm(app));
          left.appendChild(archiveBtn);

          // Right: Enroll aligned far right
          const enrollBtn = document.createElement('button');
          enrollBtn.className = 'student-btn student-enroll';
          enrollBtn.title = app.enrolled ? 'Enrolled' : 'Enroll';
          enrollBtn.textContent = app.enrolled ? 'Enrolled' : 'Enroll';
          enrollBtn.disabled = !!app.enrolled;
          enrollBtn.addEventListener('click', () => {
            if (!app.enrolled) openEnrollConfirm(app);
          });
          right.appendChild(enrollBtn);
        }

        // Append groups
        group.appendChild(left);
        group.appendChild(right);
        // Use the cell itself as flex container; also append group for structure
        actionsCell.appendChild(group);
      }

      frag.appendChild(clone);
    } else {
      // fallback create row (simpler)
      const tr = document.createElement('tr');
      tr.dataset.id = app.id || '';
      tr.innerHTML = `
        <td>${app.section || '-'}</td>
        <td>${app.fullName || '-'}</td>
        <td>${app.gradeLevel || '-'}</td>
        <td>${(app.formType||'').toUpperCase()}</td>
        <td>${app.isNew ? 'New' : 'Old'}</td>
      `;
      frag.appendChild(tr);
    }
  });

  studentsBody.appendChild(frag);
}

/* ------------------ Student modal (namespaced) ------------------ */

function openStudentModal(app) {
  currentModalApp = app;
  if (!stuModal || !stuOverlay) return;

  // make sure any leftover inline edit UI cleared before rendering
  if (stuModal.dataset.editing === 'true') delete stuModal.dataset.editing;

  // title
  if (stuTitle) stuTitle.textContent = app.fullName || '-';

  // subtitle pieces
  if (stuTypeEl) stuTypeEl.textContent = (app.formType || '').toUpperCase() || 'SHS';
  if (stuGradeEl) stuGradeEl.textContent = `Grade ${app.gradeLevel || '-'}`;
  if (systemID) systemID.textContent = `STD-${String(app.id).slice(0, 5).toUpperCase()}` || '-';

  // Fill info fields
  // studentId: show custom field (studentId, studentID) not Firestore doc id
  const customSid = (app.raw && (app.raw.studentId || app.raw.studentID || app.raw.student_id)) || '';
  if (stuIdEl) stuIdEl.textContent = customSid || ''; // blank when none

  if (stuFirstEl) stuFirstEl.textContent = app.firstName || (app.raw && (app.raw.firstName || app.raw.first)) || '-';
  if (stuLastEl) stuLastEl.textContent = app.lastName || (app.raw && (app.raw.lastName || app.raw.last)) || '-';
  if (stuMiddleEl) stuMiddleEl.textContent = (app.raw && (app.raw.middleName || app.raw.middle)) || '-';
  if (stuBirthEl) stuBirthEl.textContent = (app.raw && (app.raw.birthDate || app.raw.dob || app.raw.birthdate)) || '-';
  if (stuContactEl) stuContactEl.textContent = (app.raw && (app.raw.contactNumber || app.raw.phone || app.raw.contact)) || '-';
  if (stuEmailEl) stuEmailEl.textContent = (app.raw && (app.raw.email || app.raw.emailaddress || app.raw.emailAddress)) || '-';
  if (stuAddressEl) stuAddressEl.textContent = (app.raw && (app.raw.address || app.raw.homeAddress || app.raw.residentialAddress)) || '-';
  if (stuGrade2El) stuGrade2El.textContent = app.gradeLevel || '-';
  // track from multiple possible fields (normalizeApplicant sets app.track)
  if (stuTrackEl) stuTrackEl.textContent = (app.track || (app.raw && (app.raw.academictrack || app.raw.strand || app.raw.program || app.raw.academicTrack))) || '-';
  if (stuUpdatedEl) stuUpdatedEl.textContent = app.raw && app.raw.updatedAt ? formatDateTime(app.raw.updatedAt) : '-';

  // Requirements: Show ALL required documents based on student type
  if (stuReqList) {
    stuReqList.innerHTML = '';
    
    // Determine student type (new or returning)
    const studentType = (app.raw && (app.raw.studentType || app.raw.isNew)) || 'new';
    const isNewStudent = studentType === 'new' || studentType === true;
    
    // Get appropriate requirements list
    const requiredDocs = isNewStudent ? REQUIRED_DOCUMENTS.new : REQUIRED_DOCUMENTS.returning;
    
    // Find uploaded files
    const uploadedFiles = extractFilesFromApp(app.raw) || [];
    
    // Display ALL requirements
    requiredDocs.forEach(reqDoc => {
      const uploadedFile = uploadedFiles.find(f => f.slot === reqDoc.key || f.type === reqDoc.key);
      const isChecked = !!uploadedFile || (app.requirements && app.requirements[reqDoc.key] && app.requirements[reqDoc.key].checked);
      
      // Build display label with filename if uploaded
      let displayLabel = reqDoc.label;
      if (uploadedFile && uploadedFile.name) {
        displayLabel += ` → ${uploadedFile.name}`;
      }
      
      const li = document.createElement('li');
      const checkboxId = `hfa-stu-req-${escapeId(reqDoc.key)}-${app.id}`;
      
      li.innerHTML = `<label style="cursor:pointer;">
        <input type="checkbox" id="${checkboxId}" ${isChecked ? 'checked' : ''} />
        <span style="margin-left:8px">${displayLabel}</span>
      </label>`;
      
      stuReqList.appendChild(li);
      
      // Allow admin to manually check/uncheck
      const checkbox = li.querySelector('input[type="checkbox"]');
      if (checkbox) {
        checkbox.addEventListener('change', async (e) => {
          try {
            const collectionName = app.formType === 'jhs' ? 'jhsApplicants' : 'shsApplicants';
            const docRef = doc(db, collectionName, app.id);
            const fieldPath = `requirements.${reqDoc.key}.checked`;
            await updateDoc(docRef, { 
              [fieldPath]: e.target.checked, 
              updatedAt: serverTimestamp() 
            });
            if (app.requirements && app.requirements[reqDoc.key]) {
              app.requirements[reqDoc.key].checked = e.target.checked;
            }
          } catch (err) {
            console.error('Failed updating requirement', err);
            e.target.checked = !e.target.checked;
          }
        });
      }
    });
  }
  // Documents: render uploaded files (common shapes)
  if (stuDocsList) {
    stuDocsList.innerHTML = '';
    const files = extractFilesFromApp(app.raw);
    if (!files || !files.length) {
      const empty = document.createElement('div'); empty.className = 'hfa-stu-doc-empty'; empty.textContent = 'No files uploaded yet.';
      stuDocsList.appendChild(empty);
    } else {
      files.forEach(f => {
        const row = document.createElement('div');
        row.className = 'hfa-stu-doc-item';

        const left = document.createElement('div'); left.className = 'hfa-stu-doc-left';
        const thumb = document.createElement('div'); thumb.className = 'hfa-stu-doc-thumb';
        thumb.textContent = (f.name || '').slice(0,2).toUpperCase();
        const info = document.createElement('div'); info.className = 'hfa-stu-doc-info';
        const nameLink = document.createElement('a'); nameLink.textContent = f.name || 'file';
        nameLink.title = f.name || '';
        if (f.url) {
          nameLink.href = f.url;
          nameLink.target = '_blank';
          nameLink.rel = 'noreferrer noopener';
        } else {
          nameLink.href = '#';
          nameLink.addEventListener('click', (ev) => ev.preventDefault());
        }
        const meta = document.createElement('div'); meta.className = 'hfa-stu-doc-meta';
        if (f.size) meta.textContent = readableFileSize(f.size);

        left.appendChild(thumb); info.appendChild(nameLink); info.appendChild(meta); left.appendChild(info);

        const actions = document.createElement('div'); actions.className = 'hfa-stu-doc-actions';
        // If file has public url => direct anchors
        if (f.url) {
          const viewA = document.createElement('a'); viewA.href = f.url; viewA.target='_blank'; viewA.rel='noreferrer noopener'; viewA.textContent='View';
          actions.appendChild(viewA);
          const dl = document.createElement('a'); dl.href = f.url; dl.download = f.name || ''; dl.textContent = 'Download';
          actions.appendChild(dl);
        } else if (f.path) {
          // path exists but no public URL: use server signed-url route
          const viewBtn = document.createElement('button');
          viewBtn.textContent = 'View';
          viewBtn.className = 'btn small';
          viewBtn.addEventListener('click', async () => {
            try {
              viewBtn.disabled = true;
              viewBtn.textContent = 'Opening...';
             const reqPath = cleanPathForRequest(f.path || f.pathAttr || f.url || '');
             const signed = await getSignedUrlForPath(reqPath);
              // open in new tab
              window.open(signed, '_blank', 'noopener');
            } catch (err) {
              console.error('getSignedUrlForPath error', err);
              showToast('Failed to obtain file link (see console).');
            } finally {
              viewBtn.disabled = false;
              viewBtn.textContent = 'View';
            }
          });
          actions.appendChild(viewBtn);

          const dlBtn = document.createElement('button');
          dlBtn.textContent = 'Download';
          dlBtn.className = 'btn small';
          dlBtn.addEventListener('click', async () => {
            try {
              dlBtn.disabled = true;
              dlBtn.textContent = 'Preparing...';
              const reqPath = cleanPathForRequest(f.path || f.pathAttr || f.url || '');
              const signed = await getSignedUrlForPath(reqPath);

              // programmatic download
              const a = document.createElement('a');
              a.href = signed;
              a.download = f.name || '';
              a.target = '_blank';
              document.body.appendChild(a);
              a.click();
              a.remove();
            } catch (err) {
              console.error('getSignedUrlForPath (download) error', err);
              showToast('Failed to obtain download link (see console).');
            } finally {
              dlBtn.disabled = false;
              dlBtn.textContent = 'Download';
            }
          });
          actions.appendChild(dlBtn);
        } else {
          const btn = document.createElement('button'); btn.textContent = 'No link'; btn.disabled = true;
          actions.appendChild(btn);
        }

        row.appendChild(left); row.appendChild(actions);
        stuDocsList.appendChild(row);
      });
    }
  }

  // Conditional rendering: Show/hide buttons based on archived status
  if (app.archived) {
    // ARCHIVED: Hide Edit and Approve, show Unarchive
    if (stuEditBtn) stuEditBtn.style.display = 'none';
    if (stuArchiveBtn) {
      stuArchiveBtn.textContent = 'Unarchive';
      stuArchiveBtn.className = 'btn success small';
      stuArchiveBtn.style.display = 'inline-block';
      stuArchiveBtn.onclick = () => unarchiveStudent(app);
    }
  } else {
    // NOT ARCHIVED: Show normal buttons
    if (stuEditBtn) {
      stuEditBtn.style.display = 'inline-block';
      stuEditBtn.textContent = 'Edit';
      stuEditBtn.className = 'btn small';
      stuEditBtn.onclick = () => startInlineEdit(app);
    }
    if (stuArchiveBtn) {
      stuArchiveBtn.textContent = 'Archive';
      stuArchiveBtn.className = 'btn danger small';
      stuArchiveBtn.style.display = 'inline-block';
      stuArchiveBtn.onclick = () => openArchiveConfirm(app);
    }

  }

  // Ensure right pane visible (defensive)
  const rightPane = stuModal ? stuModal.querySelector('.hfa-stu-right') : null;
  if (rightPane) rightPane.style.display = 'flex';

  // show modal
  stuOverlay.style.display = 'flex';
  stuOverlay.setAttribute('aria-hidden', 'false');
}

/* helper to convert key to safe id */
function escapeId(s) { return (''+s).replace(/[^a-z0-9\-_]/gi, '_').slice(0,64); }

/* ------------------ Student edit flow (in-place inputs) ------------------ */

function startInlineEdit(app) {
  currentModalApp = app;
  if (!stuModal || !stuOverlay) return;
  
  // If already editing, ignore
  if (isEditingStudent) return;
  
  // Prevent editing archived students
  if (app.archived) {
    showToast('Cannot edit archived students');
    return;
  }
  
  isEditingStudent = true;

  // Store original texts so cancel can restore
  const originals = {};

  // mapping of display elements to field names and input types
  const fields = [
    { el: stuIdEl, name: 'studentId', type: 'text', rawPaths: ['studentId','studentID','student_id'] },
    { el: stuFirstEl, name: 'firstName', type: 'text', rawPaths: ['firstName','first'] },
    { el: stuLastEl, name: 'lastName', type: 'text', rawPaths: ['lastName','last'] },
    { el: stuMiddleEl, name: 'middleName', type: 'text', rawPaths: ['middleName','middle'] },
    { el: stuBirthEl, name: 'birthDate', type: 'date', rawPaths: ['birthDate','dob','birthdate'] },
    { el: stuContactEl, name: 'contactNumber', type: 'text', rawPaths: ['contactNumber','phone','contact'] },
    { el: stuAddressEl, name: 'address', type: 'text', rawPaths: ['address','homeAddress','residentialAddress'] },
    { el: stuGrade2El, name: 'gradeLevel', type: 'text', rawPaths: ['gradeLevel','grade','level'] },
    { el: stuTrackEl, name: 'academictrack', type: 'text', rawPaths: ['track','strand','program','trackName','track','academic-track'] }
  ];

  // create inputs and place them
  const inputs = {};
  fields.forEach(f => {
    const el = f.el;
    if (!el) return;
    originals[f.name] = el.textContent || '';
    // create input
    const input = document.createElement('input');
    input.type = f.type === 'date' ? 'date' : 'text';
    input.value = (function() {
      // prefer raw fields
      const raw = app.raw || {};
      for (const p of f.rawPaths) {
        if (raw && raw[p]) {
          if (f.type === 'date') {
            try {
              const d = new Date(raw[p]);
              if (!isNaN(d)) return d.toISOString().slice(0,10);
            } catch (e) {}
          } else return String(raw[p] || '');
        }
      }
      // fallback to normalized top-level
      return (app[f.name] || '') || '';
    })();
    input.className = 'hfa-inline-input';
    // replace content
    el.innerHTML = '';
    el.appendChild(input);
    inputs[f.name] = input;
  });

  // Change Edit button to Save, add Cancel button
  const parentActions = stuEditBtn && stuEditBtn.parentElement ? stuEditBtn.parentElement : null;
  let cancelBtn = null;
  
  if (stuEditBtn) {
    stuEditBtn.textContent = 'Save';
    stuEditBtn.className = 'btn primary small';
    
    // Create cancel button
    cancelBtn = document.createElement('button');
    cancelBtn.id = 'hfa-stu-cancel-edit';
    cancelBtn.className = 'btn small';
    cancelBtn.textContent = 'Cancel';
    if (parentActions) parentActions.insertBefore(cancelBtn, stuEditBtn.nextSibling);
  }

  // small error message element for studentId duplicate
  const sidErr = document.createElement('div');
  sidErr.id = 'hfa-inline-sid-err';
  sidErr.style.color = '#a11';
  sidErr.style.display = 'none';
  sidErr.style.marginTop = '6px';
  if (stuIdEl) stuIdEl.appendChild(sidErr);

  // cancel handler
  if (cancelBtn) cancelBtn.onclick = () => {
    // Restore originals
    fields.forEach(f => {
      const el = f.el;
      if (!el) return;
      el.innerHTML = originals[f.name] || '';
    });
    
    // Remove error
    if (sidErr && sidErr.parentNode) sidErr.parentNode.removeChild(sidErr);
    
    // Restore Edit button (conditional approach)
    if (stuEditBtn) {
      stuEditBtn.textContent = 'Edit';
      stuEditBtn.className = 'btn small';
    }
    
    // Remove Cancel button
    if (cancelBtn && cancelBtn.parentNode) cancelBtn.parentNode.removeChild(cancelBtn);
    
    // Reset edit state
    isEditingStudent = false;
  };

  // save handler
  if (stuEditBtn) stuEditBtn.onclick = async () => {
    stuEditBtn.disabled = true;
    stuEditBtn.textContent = 'Saving...';
    sidErr.style.display = 'none';
    try {
      const payload = {};
      const newSid = (inputs.studentId && inputs.studentId.value || '').trim();
      const newFirst = (inputs.firstName && inputs.firstName.value || '').trim();
      const newLast = (inputs.lastName && inputs.lastName.value || '').trim();
      const newMiddle = (inputs.middleName && inputs.middleName.value || '').trim();
      const newBirth = (inputs.birthDate && inputs.birthDate.value || '').trim();
      const newContact = (inputs.contactNumber && inputs.contactNumber.value || '').trim();
      const newAddress = (inputs.address && inputs.address.value || '').trim();
      const newGrade = (inputs.gradeLevel && inputs.gradeLevel.value || '').trim();
      const newTrack = (inputs.track && inputs.track.value || '').trim();

      // Validate studentId uniqueness if provided
      if (newSid) {
        // query both collections
        const q1 = query(collection(db, 'jhsApplicants'), where('studentId', '==', newSid));
        const q2 = query(collection(db, 'shsApplicants'), where('studentId', '==', newSid));
        const [r1, r2] = await Promise.all([getDocs(q1), getDocs(q2)]);
        const docs1 = (r1 && r1.docs) || [];
        const docs2 = (r2 && r2.docs) || [];
        const all = docs1.concat(docs2);
        const duplicate = all.find(d => d.id !== app.id);
        if (duplicate) {
          sidErr.textContent = "Student ID is already set by another student.";
          sidErr.style.display = 'block';
          saveBtn.disabled = false;
          saveBtn.textContent = 'Save';
          return;
        }
      }

      // prepare payload
      if (newSid) payload.studentId = newSid; else payload.studentId = null; // allow clearing
      if (newFirst) payload.firstName = newFirst;
      if (newLast) payload.lastName = newLast;
      if (newMiddle) payload.middleName = newMiddle;
      if (newBirth) payload.birthDate = newBirth;
      if (newContact) payload.contactNumber = newContact;
      if (newAddress) payload.address = newAddress;
      if (newGrade) payload.gradeLevel = newGrade;
      if (newTrack) payload.track = newTrack;
      payload.updatedAt = serverTimestamp();

      const collectionName = app.formType === 'jhs' ? 'jhsApplicants' : 'shsApplicants';
      const docRef = doc(db, collectionName, app.id);
      await updateDoc(docRef, payload);

      // Success: restore Edit button and remove Cancel button
      if (cancelBtn && cancelBtn.parentNode) cancelBtn.parentNode.removeChild(cancelBtn);
      
      if (stuEditBtn) {
        stuEditBtn.textContent = 'Edit';
        stuEditBtn.className = 'btn small';
        stuEditBtn.disabled = false;
      }
      
      // Reset edit state
      isEditingStudent = false;

      showToast('Student updated');
      
      // Update local map so UI refresh quickly
      const mergedRaw = { ...(app.raw || {}), ...payload };
      applicantsMap.set(app.id, normalizeApplicant(app.id, mergedRaw));
      applyFiltersAndRender();
      openStudentModal(applicantsMap.get(app.id));
      
    } catch (err) {
      console.error('Save edit failed', err);
      sidErr.style.display = 'block';
      sidErr.textContent = 'Save failed. See console.';
    } finally {
      if (stuEditBtn) { 
        stuEditBtn.disabled = false; 
        if (!isEditingStudent) {
          // Only set to Save if still in edit mode (error occurred)
          stuEditBtn.textContent = isEditingStudent ? 'Save' : 'Edit';
        }
      }
    }
  };
}
/* ------------------ Enroll modal flow ------------------ */
function openEnrollConfirm(app) {
  _enrollState.app = app || null;
  if (!enrollModal) {
    // fallback to simple confirm if modal not present
    if (!app) return;
    if (confirm(`Enroll ${app.fullName}?`)) openMessageModal(app, { afterEnroll: true });
    return;
  }
  // show enroll modal
  enrollModal.style.display = 'flex';
  // set aria-hidden etc if you want
  // content text adjust (optional)
  const msgEl = enrollModal.querySelector('.enroll-message-confirmation');
  if (msgEl) msgEl.textContent = `Are you sure you want to enroll ${app.fullName || 'this student'}?`;
}

function closeEnrollConfirm() {
  _enrollState = { app: null };
  if (enrollModal) enrollModal.style.display = 'none';
}

/* wire enroll modal buttons (if present) */
if (enrollCloseBtn) enrollCloseBtn.addEventListener('click', () => closeEnrollConfirm());
if (enrollModal) {
  enrollModal.addEventListener('click', (e) => {
    if (e.target === enrollModal) closeEnrollConfirm();
  });
}
if (enrollCancelBtn) enrollCancelBtn.addEventListener('click', () => {
  closeEnrollConfirm();
});
if (enrollConfirmBtn) enrollConfirmBtn.addEventListener('click', async () => {
  const app = _enrollState.app || currentModalApp;
  closeEnrollConfirm();
  if (!app) return;
  try {
    await enrollApplicant(app);
    
    // Auto-send enrollment email
    const emailSent = await sendEnrollmentEmail(app);
    if (emailSent) {
      showToast('✅ Student enrolled and email sent');
    } else {
      showToast('⚠️ Student enrolled, but email notification failed');
    }
  } catch (e) {
    console.error('Enroll confirm failed', e);
    showToast('Enroll failed (see console).');
  }
});

/* ------------------ Auto-send enrollment email ------------------ */

async function sendEnrollmentEmail(app) {
  try {
    const emailAddress = (app.raw && (app.raw.email || app.raw.contactEmail || app.raw.emailaddress)) || '';
    if (!emailAddress) {
      console.warn('No email address found for student');
      return false;
    }
    
    const studentName = app.fullName || `${app.firstName} ${app.lastName}` || 'Student';
    
    const emailPayload = {
      studentId: app.id,
      email: emailAddress,
      subject: 'Welcome to Holy Family Academy',
      message: `Good day ${studentName},\n\nCongratulations! You are now enrolled and part of the FAMILIANS at Holy Family Academy. We are excited to welcome you.\n\nWarm regards,\nHoly Family Academy Admissions`
    };
    
    const response = await apiFetch('/api/admin/send-message', {
      method: 'POST',
      body: JSON.stringify(emailPayload)
    });
    
    if (!response.ok) {
      console.error('Email send failed:', response);
      return false;
    }
    
    console.log('Enrollment email sent successfully to:', emailAddress);
    return true;
  } catch (err) {
    console.error('Email send error:', err);
    return false;
  }
}

/* ------------------ Enroll / other small flows ------------------ */

async function enrollApplicant(app) {
  if (!app || app.enrolled) return;
  try {
    const collectionName = app.formType === 'jhs' ? 'jhsApplicants' : 'shsApplicants';
    const docRef = doc(db, collectionName, app.id);
    await updateDoc(docRef, {
      enrolled: true,
      enrolledAt: serverTimestamp(),
      isNew: false,
      updatedAt: serverTimestamp()
    });
    closeStudentModal();
  } catch (err) {
    console.error('Enroll failed', err);
    throw err;
  }
}

/* ------------------ Message modal functions (existing) ------------------ */

function openMessageModal(app, { afterEnroll = false } = {}) {
  if (!messageModalOverlay || !messageModal) {
    console.warn("Message modal DOM missing. Add the provided HTML snippet for the message modal.");
    return;
  }
  _messageModalState.app = app || null;
  _messageModalState.afterEnroll = !!afterEnroll;

  const emailFromDoc = (app && app.raw && (app.raw.email || app.raw.contactEmail || app.raw.emailaddress)) || "";
  const phoneFromDoc = (app && app.raw && (app.raw.contactNumber || app.raw.phone)) || "";

  if (messageRecipient) {
    messageRecipient.value = emailFromDoc || "";
    messageRecipient.dataset.default = emailFromDoc || "";
  }
  if (messagePhone) messagePhone.textContent = phoneFromDoc || "—";

  const studentName = (app && (app.fullName || `${app.firstName} ${app.lastName}`)) || "Student";
  if (messageSubject) messageSubject.value = `Welcome to Holy Family Academy`;
  if (messageBody) {
    const template = `Good day ${studentName},\n\n` +
      `Congratulations! You are now enrolled and part of the FAMILIANS at Holy Family Academy. We are excited to welcome you.\n\n` +
      `Warm regards,\nHoly Family Academy Admissions`;
    messageBody.value = template;
  }

  if (messageError) messageError.textContent = "";
  if (messageSendBtn) messageSendBtn.disabled = false;

  messageModalOverlay.style.display = "flex";
  messageModalOverlay.setAttribute('aria-hidden', 'false');

  if (messageCancelBtn) messageCancelBtn.onclick = closeMessageModal;
  if (messageClose) messageClose.onclick = closeMessageModal;

  if (messageSendBtn) {
    messageSendBtn.onclick = null;
    messageSendBtn.addEventListener('click', handleSendMessage);
  }
}

function closeMessageModal() {
  if (!messageModalOverlay) return;
  messageModalOverlay.style.display = "none";
  messageModalOverlay.setAttribute('aria-hidden', 'true');
  _messageModalState = { app: null, afterEnroll: false };
}

async function handleSendMessage() {
  const app = _messageModalState.app;
  if (!app) { if (messageError) messageError.textContent = "Missing student data."; return; }

  const studentId = app.id;
  const email = (messageRecipient && messageRecipient.value || "").toString().trim();
  const subject = (messageSubject && messageSubject.value || "").toString().trim();
  const message = (messageBody && messageBody.value || "").toString().trim();

  if (!email) { if (messageError) messageError.textContent = "Email is required."; return; }
  if (!subject) { if (messageError) messageError.textContent = "Subject is required."; return; }
  if (!message) { if (messageError) messageError.textContent = "Message body is required."; return; }

  try {
    if (messageSendBtn) {
      messageSendBtn.disabled = true;
      messageSendBtn.textContent = "Sending...";
    }
    if (messageError) messageError.textContent = "";

    // Use JWT cookie for auth (no token needed)
    const resp = await fetch("/api/admin/send-message", {
      method: "POST",
      credentials: 'include',
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ studentId, email, subject, message })
    });

    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const errMsg = body && (body.error || body.message) || `Server error ${resp.status}`;
      if (messageError) messageError.textContent = `Send failed: ${errMsg}`;
      console.error("send-message failed", resp.status, body);
      if (messageSendBtn) { messageSendBtn.disabled = false; messageSendBtn.textContent = "Send"; }
      return;
    }

    showToast("Email sent");
    closeMessageModal();

    if (_messageModalState.afterEnroll) {
      try { await enrollApplicant(app); } catch (e) { console.warn("Enroll after send may have failed", e); showToast('Enroll may have failed. See console.'); }
    }

  } catch (err) {
    console.error("send message exception", err);
    if (messageError) messageError.textContent = "Send failed (see console).";
  } finally {
    if (messageSendBtn) { messageSendBtn.disabled = false; messageSendBtn.textContent = "Send"; }
  }
}

// close modal
function closeStudentModal() {
  if (!stuOverlay) return;
  stuOverlay.style.display = 'none';
  stuOverlay.setAttribute('aria-hidden', 'true');
  currentModalApp = null;
  isEditingStudent = false; // Reset edit state
}
window.closeStudentModal = closeStudentModal; // expose globally as requested

/* ------------------ Archive/Unarchive flows ------------------ */
async function unarchiveStudent(app) {
  if (!app || !app.archived) return;
  
  try {
    const collectionName = app.formType === 'jhs' ? 'jhsApplicants' : 'shsApplicants';
    const docRef = doc(db, collectionName, app.id);
    await updateDoc(docRef, { 
      archived: false, 
      archivedAt: null, 
      updatedAt: serverTimestamp() 
    });
    
    showToast('Student unarchived successfully');
    closeStudentModal();
    applyFiltersAndRender();
    
  } catch (err) {
    console.error('Unarchive failed', err);
    showToast('Failed to unarchive student');
  }
}

/* ------------------ Archive/Delete flows ------------------ */
function openArchiveConfirm(app) {
  currentModalApp = app;
  if (!stuOverlay || stuOverlay.style.display !== 'flex') openStudentModal(app);
  setTimeout(()=> {
    if (stuInlineConfirm) stuInlineConfirm.style.display = 'block';
    if (stuConfirmYes) {
      stuConfirmYes.onclick = async () => {
        try {
          const collectionName = app.formType === 'jhs' ? 'jhsApplicants' : 'shsApplicants';
          const docRef = doc(db, collectionName, app.id);
          await updateDoc(docRef, { archived: true, archivedAt: serverTimestamp(), updatedAt: serverTimestamp() });
          showToast('Applicant archived', 'Undo', async () => {
            try { await updateDoc(docRef, { archived: false, archivedAt: null, updatedAt: serverTimestamp() }); applyFiltersAndRender(); } catch(e){console.error(e);}
          });
          closeStudentModal();
        } catch (err) { console.error('Archive failed', err); }
      };
    }
    if (stuConfirmNo) stuConfirmNo.onclick = () => { if (stuInlineConfirm) stuInlineConfirm.style.display = 'none'; };
  }, 50);
}

/* ------------------ Toast ------------------ */

function showToast(message, actionText, actionCallback) {
  if (!toastContainer) {
    console.log("[toast]", message);
    return;
  }

  if (toastTemplate && toastTemplate.content) {
    const clone = toastTemplate.content.cloneNode(true);
    const root = clone.querySelector('.admin-toast');
    if (!root) return;

    const msgEl = root.querySelector('.toast-message');
    if (msgEl) msgEl.textContent = message;

    const actionBtn = root.querySelector('.toast-action');
    if (actionBtn) {
      if (actionText && actionCallback) {
        actionBtn.textContent = actionText;
        actionBtn.addEventListener('click', () => {
          try { actionCallback(); } catch (e) { console.error(e); }
          if (root.parentNode) root.parentNode.removeChild(root);
        });
      } else {
        actionBtn.remove();
      }
    }

    const wrapper = document.createElement('div');
    wrapper.appendChild(clone);
    toastContainer.appendChild(wrapper);

    setTimeout(() => {
      if (wrapper.parentNode === toastContainer) toastContainer.removeChild(wrapper);
    }, 8000);

    return;
  }

  const t = document.createElement('div');
  t.className = 'admin-toast';
  const m = document.createElement('div'); m.className = 'toast-message'; m.textContent = message;
  t.appendChild(m);
  if (actionText && actionCallback) {
    const a = document.createElement('button'); a.className = 'toast-action'; a.textContent = actionText;
    a.addEventListener('click', () => { actionCallback(); if (t.parentNode) t.parentNode.removeChild(t); });
    t.appendChild(a);
  }
  toastContainer.appendChild(t);
  setTimeout(() => { if (t.parentNode === toastContainer) t.parentNode.removeChild(t); }, 8000);
}

/* ------------------ Pagination helpers ------------------ */

function updatePaginationControls(totalItems, totalPages, startIdx, endIdx) {
  if (!paginationControls) return;
  
  // Show/hide pagination controls
  if (totalItems <= rowsPerPage) {
    paginationControls.style.display = 'none';
    return;
  }
  
  paginationControls.style.display = 'flex';
  
  // Update page numbers
  if (currentPageNum) currentPageNum.textContent = currentPage;
  if (totalPagesNum) totalPagesNum.textContent = totalPages || 1;
  if (totalCountEl) totalCountEl.textContent = totalItems;
  if (showingCount) {
    const showing = Math.min(endIdx, totalItems);
    showingCount.textContent = showing;
  }
  
  // Enable/disable buttons
  if (prevPageBtn) {
    prevPageBtn.disabled = currentPage <= 1;
  }
  if (nextPageBtn) {
    nextPageBtn.disabled = currentPage >= totalPages;
  }
}

function goToPage(page) {
  currentPage = page;
  applyFiltersAndRender();
}

/* ------------------ Filters / Render pipeline ------------------ */

function applyFiltersAndRender() {
  let list = Array.from(applicantsMap.values());

  if (activeTab === 'archived') {
    list = list.filter(a => a.archived);
  } else {
    list = list.filter(a => !a.archived);
    if (activeTab === 'jhs') list = list.filter(a => a.formType === 'jhs');
    else if (activeTab === 'shs') list = list.filter(a => a.formType === 'shs');
    else if (activeTab === 'enrolled') list = list.filter(a => a.enrolled);
  }

  const statusVal = filterStatus ? filterStatus.value : '';
  if (statusVal === 'new') list = list.filter(a => a.isNew);
  else if (statusVal === 'old') list = list.filter(a => !a.isNew);
  // Note: incomplete/complete filters removed as progress tracking is no longer used

  const q = (searchInput && searchInput.value || '').trim().toLowerCase();
  if (q) {
    list = list.filter(a =>
      (a.fullName || '').toLowerCase().includes(q) ||
      (a.id || '').toLowerCase().includes(q) ||
      (String(a.gradeLevel || '')).includes(q)
    );
  }

  if (sortBy && sortBy.value === 'name') list.sort((x, y) => (x.fullName || '').localeCompare(y.fullName || ''));
  else if (sortBy && sortBy.value === 'grade') list.sort((x, y) => String(x.gradeLevel || '').localeCompare(String(y.gradeLevel || '')));
  else list.sort((x, y) => y.submittedAt - x.submittedAt);

  updateCounts();

  // Pagination logic
  const totalItems = list.length;
  const totalPages = Math.ceil(totalItems / rowsPerPage);
  
  // Reset to page 1 if current page exceeds total pages
  if (currentPage > totalPages && totalPages > 0) {
    currentPage = 1;
  }
  
  // Calculate pagination slice
  const startIdx = (currentPage - 1) * rowsPerPage;
  const endIdx = startIdx + rowsPerPage;
  const paginatedList = list.slice(startIdx, endIdx);
  
  // Render table
  if (tableView) tableView.style.display = 'block';
  renderTableRows(paginatedList);
  
  // Update pagination controls
  updatePaginationControls(totalItems, totalPages, startIdx, endIdx);
}

/* ------------------ UI listeners ------------------ */

function attachUIListeners() {
  const tabButtons = document.querySelectorAll('.tab-btn');
  tabButtons.forEach(btn => btn.addEventListener('click', (e) => {
    tabButtons.forEach(b => b.classList.remove('active'));
    e.currentTarget.classList.add('active');
    activeTab = e.currentTarget.dataset.tab;
    currentPage = 1; // Reset to page 1 when switching tabs
    applyFiltersAndRender();
  }));

  if (tableBtn) tableBtn.addEventListener('click', () => {
    activeView = 'table';
    tableBtn.classList.add('active');
    applyFiltersAndRender();
  });

  if (searchInput) searchInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      currentPage = 1; // Reset to page 1 on search
      applyFiltersAndRender();
    }, 250);
  });

  if (filterStatus) filterStatus.addEventListener('change', () => {
    currentPage = 1; // Reset to page 1 on filter change
    applyFiltersAndRender();
  });
  
  if (sortBy) sortBy.addEventListener('change', applyFiltersAndRender);

  // Pagination event listeners
  if (prevPageBtn) {
    prevPageBtn.addEventListener('click', () => {
      if (currentPage > 1) {
        goToPage(currentPage - 1);
      }
    });
  }
  
  if (nextPageBtn) {
    nextPageBtn.addEventListener('click', () => {
      goToPage(currentPage + 1);
    });
  }

  if (stuClose2) stuClose2.addEventListener('click', () => closeStudentModal());

  // global click to close overlays when clicking outside
  window.addEventListener('click', (e) => {
    if (stuOverlay && e.target === stuOverlay) closeStudentModal();
    if (messageModalOverlay && e.target === messageModalOverlay) closeMessageModal();
    if (enrollModal && e.target === enrollModal) closeEnrollConfirm();
  });

  if (messageCancelBtn) messageCancelBtn.addEventListener('click', () => closeMessageModal());
}

/* ------------------ Firestore realtime listeners ------------------ */
function setupRealtimeListeners() {
  const jhsCol = collection(db, 'jhsApplicants');
  onSnapshot(jhsCol, snapshot => {
    snapshot.docChanges().forEach(change => {
      const id = change.doc.id;
      const data = change.doc.data();
      if (change.type === 'removed') applicantsMap.delete(id);
      else applicantsMap.set(id, normalizeApplicant(id, data));
    });
    applyFiltersAndRender();
  }, err => { console.error('JHS onSnapshot error', err); });

  const shsCol = collection(db, 'shsApplicants');
  onSnapshot(shsCol, snapshot => {
    snapshot.docChanges().forEach(change => {
      const id = change.doc.id;
      const data = change.doc.data();
      if (change.type === 'removed') applicantsMap.delete(id);
      else applicantsMap.set(id, normalizeApplicant(id, data));
    });
    applyFiltersAndRender();
  }, err => { console.error('SHS onSnapshot error', err); });
}
/* ------------------ Initialization ------------------ */
function init() {
  attachUIListeners();
  setupRealtimeListeners();
}
init();
