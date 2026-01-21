/* tcform.js 
   Flow:
   - Submit -> /applicants/create -> keep files in memory -> open modal
   - Confirm code -> /applicants/confirm-email -> on success upload files -> /applicants/:id/attach-files
   - Success OK clears form and hides modal
*/

/*  Firebase (Client-side)  */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { firebaseConfig } from "../firebase-config.js";
import { setupLocationDropdowns, getSelectedText } from './location-api.js';

// init firebase (client-only)
const app = initializeApp(firebaseConfig);


/* ----------------- Helpers ----------------- */
function randStr(len = 6) {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

// ---------- OCR / PDF helpers ----------
const PDFJS_VERSION = "2.16.105";
const TESSERACT_VERSION = "v4.0.2";

async function loadPDF() {
  if (window.pdfjsLib) {
    window.pdfjsLib.GlobalWorkerOptions.workerSrc =
      `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js`;
    return window.pdfjsLib;
  }
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.js`;
    s.onload = resolve;
    s.onerror = () => reject(new Error("Failed to load PDF.js from CDN."));
    document.head.appendChild(s);
  });
  if (!window.pdfjsLib) throw new Error("PDF.js loaded but pdfjsLib missing.");
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js`;
  return window.pdfjsLib;
}

async function loadTess() {
  if (window.Tesseract) return window.Tesseract;
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://cdn.jsdelivr.net/npm/tesseract.js@${TESSERACT_VERSION}/dist/tesseract.min.js`;
    s.onload = resolve;
    s.onerror = () => reject(new Error("Failed to load Tesseract.js from CDN."));
    document.head.appendChild(s);
  });
  if (!window.Tesseract) throw new Error("Tesseract loaded but missing.");
  return window.Tesseract;
}

async function ocrCanvas(canvas, onProgress = null) {
  const T = await loadTess();
  const worker = T.createWorker({ logger: onProgress || (() => {}) });
  await worker.load();
  await worker.loadLanguage('eng');
  await worker.initialize('eng');
  const { data } = await worker.recognize(canvas);
  await worker.terminate();
  return data?.text || "";
}

async function renderPdfAndOcr(page, scale = 2, onProgress = null) {
  const vp = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  const ctx = canvas.getContext('2d');
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return await ocrCanvas(canvas, onProgress);
}

async function extractPdfText(file, onProgress = null) {
  const pdfjsLib = await loadPDF();
  const fr = new FileReader();
  return new Promise((resolve, reject) => {
    fr.onload = async function () {
      try {
        const arr = new Uint8Array(this.result);
        const pdf = await pdfjsLib.getDocument(arr).promise;
        let allText = "";
        for (let p = 1; p <= pdf.numPages; p++) {
          const page = await pdf.getPage(p);
          const content = await page.getTextContent();
          const txt = content.items.map(i => i.str).join(" ").trim();
          allText += txt + "\n";
        }
        const MIN_LEN = 80;
        if ((allText.trim().length < MIN_LEN) && pdf.numPages > 0) {
          try {
            const page = await pdf.getPage(1);
            const ocrText = await renderPdfAndOcr(page, 2, onProgress);
            allText = (allText + "\n" + ocrText).trim();
          } catch (ocrErr) {
            console.warn("PDF OCR fallback failed:", ocrErr);
          }
        }
        resolve(allText);
      } catch (err) {
        reject(err);
      }
    };
    fr.onerror = () => reject(new Error("Failed to read file."));
    fr.readAsArrayBuffer(file);
  });
}

async function extractImageText(file, onProgress = null) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = async function () {
      try {
        const canvas = document.createElement("canvas");
        const maxDim = 2000;
        let w = img.naturalWidth, h = img.naturalHeight;
        if (Math.max(w, h) > maxDim) {
          const scale = maxDim / Math.max(w, h);
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        const text = await ocrCanvas(canvas, onProgress);
        resolve(text);
      } catch (err) {
        reject(err);
      }
    };
    img.onerror = () => reject(new Error("Failed to load image for OCR."));
    img.src = URL.createObjectURL(file);
  });
}


// ---------- Autofill / parsing helpers ----------
function birthdate(s) {
  const months = {
    jan: 1, january: 1,
    feb: 2, february: 2,
    mar: 3, march: 3,
    apr: 4, april: 4,
    may: 5,
    jun: 6, june: 6,
    jul: 7, july: 7,
    aug: 8, august: 8,
    sep: 9, sept: 9, september: 9,
    oct: 10, october: 10,
    nov: 11, november: 11,
    dec: 12, december: 12,
  };
  const pad = n => String(n).padStart(2, "0");
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/); if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) { const a = +m[1], b = +m[2], y = m[3]; return a > 12 ? `${y}-${pad(b)}-${pad(a)}` : `${y}-${pad(a)}-${pad(b)}`; }
  m = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s*(\d{4})$/);
  if (m) { const mo = months[m[1].toLowerCase()]; if (mo) return `${m[3]}-${pad(mo)}-${pad(m[2])}`; }
  m = s.match(/^(\d{1,2})\s+([A-Za-z]+),?\s*(\d{4})$/);
  if (m) { const mo = months[m[2].toLowerCase()]; if (mo) return `${m[3]}-${pad(mo)}-${pad(m[1])}`; }
  return s;
}

function autoFillFromText(text) {
  if (!text || !text.trim()) return;
  const raw = text.replace(/\r/g, ' ').replace(/\n/g, ' ').replace(/\s{2,}/g, ' ').trim();

  // Name
  const labeledName =
    raw.match(/(?:Applicant(?:'s)?\s+)?(?:Full|Complete|Name)\s*[:\-]\s*([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})/i)
    || raw.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,3})\b/);
  const nameStr = (labeledName && labeledName[1]) ? labeledName[1].trim() : "";
  if (nameStr) {
    const parts = nameStr.split(/\s+/);
    const fn = parts[0] || "";
    const ln = parts.length > 1 ? parts[parts.length - 1] : "";
    const mid = parts.length > 2 ? parts.slice(1, -1).join(" ") : "";
    const firstEl = document.getElementById("first-name");
    const lastEl = document.getElementById("last-name");
    const midEl = document.getElementById("middle-name");
    if (firstEl && firstEl.dataset.userEdited !== 'true' && !firstEl.value) firstEl.value = fn;
    if (lastEl && lastEl.dataset.userEdited !== 'true' && !lastEl.value) lastEl.value = ln;
    if (midEl && midEl.dataset.userEdited !== 'true' && !midEl.value) midEl.value = mid;
  }

  // Email
  const emailMatch = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (emailMatch) {
    const emailEl = document.getElementById("email");
    if (emailEl && emailEl.dataset.userEdited !== 'true' && !emailEl.value) {
      emailEl.value = emailMatch[0].toLowerCase();
    }
  }

  // Phone
  const phoneMatch = raw.match(/(\+?\d{1,3}[\s-\.]?)?(?:\(?\d{2,4}\)?[\s-\.]?)\d{3,4}[\s-\.]?\d{3,4}/);
  if (phoneMatch) {
    const phone = phoneMatch[0].replace(/[^\d+]/g, '');
    const phoneEl = document.getElementById("contact-number");
    if (phoneEl && phoneEl.dataset.userEdited !== 'true' && !phoneEl.value) {
      phoneEl.value = phone;
    }
  }

  // Birthdate
  const dateMatch = raw.match(/\b(\d{4}[-\/]\d{1,2}[-\/]\d{1,2}|\d{1,2}[-\/]\d{1,2}[-\/]\d{4}|[A-Za-z]{3,9}\s+\d{1,2},?\s*\d{4}|\d{1,2}\s+[A-Za-z]{3,9},?\s*\d{4})\b/);
  if (dateMatch) {
    const bdVal = birthdate(dateMatch[1]);
    const bdEl = document.getElementById("birthdate");
    if (bdEl && bdEl.dataset.userEdited !== 'true' && !bdEl.value) {
      bdEl.value = bdVal;
    }
  }

  // Degree / Institution / Major
  const degreeMatch = raw.match(/\b(Bachelor(?:'s)?|Bachelor of|B\.?A\.?|B\.?S\.?|Master(?:'s)?|M\.?A\.?|M\.?S\.?|Doctor|Ph\.?D\.?)\b/i);
  if (degreeMatch) {
    const degEl = document.getElementById("highest-degree");
    if (degEl && degEl.dataset.userEdited !== 'true' && !degEl.value) degEl.value = degreeMatch[0];
  }
  const instMatch = raw.match(/\b([A-Z][\w&\s,.-]{3,60}\b(?:University|College|Institute|School|Academy|Center))\b/i);
  if (instMatch) {
    const instEl = document.getElementById("institution");
    if (instEl && instEl.dataset.userEdited !== 'true' && !instEl.value) instEl.value = instMatch[0].trim();
  }
  const majorMatch = raw.match(/\bMajor\s*[:\-]?\s*([A-Za-z &\/\-]{3,60})\b/i) || raw.match(/\b(?:Field of Study|Specialization)\s*[:\-]?\s*([A-Za-z &\/\-]{3,60})\b/i);
  if (majorMatch) {
    const majorEl = document.getElementById("major");
    if (majorEl && majorEl.dataset.userEdited !== 'true' && !majorEl.value) majorEl.value = majorMatch[1].trim();
  }
}

// ---------- in-memory upload state ----------
const uploads = {}; // e.g. { resume: { file, name }

/* ---------------- DOM wiring and submit handling ---------------- */
document.addEventListener("DOMContentLoaded", () => {
  // DOM refs
  const resumeIn = document.getElementById("resume-upload");
  const resumeBtn = document.getElementById("browse-btn");
  const resumeLabel = document.getElementById("file-name");
  const progBar = document.getElementById("progress-bar");
  const progFill = document.getElementById("progress-fill");
  const progText = document.getElementById("progress-text");
  const submitBtn = document.getElementById("submit-btn");


  const cvIn = document.getElementById("cv-upload");

  // -------- Location Dropdowns Setup --------
  setupLocationDropdowns({
    provinceId: 'province',
    cityId: 'city',
    barangayId: 'barangay'
  }).catch(err => {
    console.error('Failed to setup location dropdowns:', err);
  });

  // inputs protect from overwrite
  const firstIn = document.getElementById("first-name");
  const lastIn = document.getElementById("last-name");
  const midIn = document.getElementById("middle-name");

  [firstIn, lastIn, midIn].forEach(el => {
    if (!el) return;
    el.addEventListener("input", () => { el.dataset.userEdited = 'true'; });
  });

  // -------- Live validation (simple) --------
  function setError(el, msg) {
    if (!el) return;
    // Check if input is inside phone-input-wrapper
    const wrapper = el.closest('.phone-input-wrapper');
    if (wrapper) {
      wrapper.classList.add('is-invalid');
      const formGroup = wrapper.parentElement;
      let msgEl = formGroup && formGroup.querySelector('.error-text');
      if (!msgEl && formGroup) {
        msgEl = document.createElement('small');
        msgEl.className = 'error-text';
        formGroup.appendChild(msgEl);
      }
      if (msgEl) msgEl.textContent = msg || '';
    } else {
      el.classList.add('is-invalid');
      let msgEl = el.parentElement && el.parentElement.querySelector('.error-text');
      if (!msgEl && el.parentElement) {
        msgEl = document.createElement('small');
        msgEl.className = 'error-text';
        el.parentElement.appendChild(msgEl);
      }
      if (msgEl) msgEl.textContent = msg || '';
    }
  }
  function clearError(el) {
    if (!el) return;
    // Check if input is inside phone-input-wrapper
    const wrapper = el.closest('.phone-input-wrapper');
    if (wrapper) {
      wrapper.classList.remove('is-invalid');
      const formGroup = wrapper.parentElement;
      const msgEl = formGroup && formGroup.querySelector('.error-text');
      if (msgEl) msgEl.textContent = '';
    } else {
      el.classList.remove('is-invalid');
      const msgEl = el.parentElement && el.parentElement.querySelector('.error-text');
      if (msgEl) msgEl.textContent = '';
    }
  }

  const NAME_RE = /^[A-Za-zÀ-ÖØ-öø-ÿ]+(?:[' -][A-Za-zÀ-ÖØ-öø-ÿ]+)*$/;
  const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

  function validateName(el, required = true) {
    if (!el) return true;
    const val = (el.value || '').trim();
    if (!val) { if (required) { setError(el, 'This field is required.'); return false; } else { clearError(el); return true; } }
    if (!NAME_RE.test(val)) { setError(el, 'Letters, spaces, apostrophes, hyphens only.'); return false; }
    clearError(el); return true;
  }
  function validateEmail(el) {
    if (!el) return true;
    const v = (el.value || '').trim();
    if (!v) { setError(el, 'Email is required.'); return false; }
    if (!EMAIL_RE.test(v)) { setError(el, 'Enter a valid email address.'); return false; }
    clearError(el); return true;
  }
  function validatePhone(el) {
    if (!el) return true;
    // keep only digits and max 10
    el.value = (el.value || '').replace(/[^0-9]/g, '').slice(0, 10);
    const v = el.value;
    if (v.length !== 10 || v[0] !== '9') { setError(el, 'Enter 10 digits starting with 9.'); return false; }
    clearError(el); return true;
  }
  function validateAge18Plus(el) {
    if (!el) return true;
    const v = el.value;
    if (!v) { setError(el, 'Birthdate is required.'); return false; }
    const bd = new Date(v);
    const today = new Date();
    let age = today.getFullYear() - bd.getFullYear();
    const monthDiff = today.getMonth() - bd.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < bd.getDate())) age--;
    
    // Check minimum age (18 years old)
    if (age < 18) { setError(el, 'You must be at least 18 years old.'); return false; }
    
    // Check maximum age (60 years old)
    const MAX_AGE = 60;
    if (age > MAX_AGE) { setError(el, `Age must not exceed ${MAX_AGE} years old. (Current age: ${age})`); return false; }
    
    clearError(el); return true;
  }
  function validateYearsOfExperience(el) {
    if (!el) return true;
    const v = el.value;
    if (!v || v.trim() === '') { setError(el, 'Years of experience is required.'); return false; }
    const years = parseInt(v, 10);
    if (isNaN(years)) { setError(el, 'Please enter a valid number.'); return false; }
    if (years < 0) { setError(el, 'Years of experience cannot be negative.'); return false; }
    if (years > 30) { setError(el, 'Years of experience must not exceed 30 years.'); return false; }
    clearError(el); return true;
  }
  function validateRequired(el) {
    if (!el) return true;
    const v = (el.value || '').trim();
    if (!v) { setError(el, 'This field is required.'); return false; }
    clearError(el); return true;
  }
  function validateCVFile(el) {
    if (!el || !el.files || el.files.length === 0) return true; // optional
    const file = el.files[0];
    const MAX_SIZE = 5 * 1024 * 1024; // 5MB
    if (file.size > MAX_SIZE) {
      setError(el, 'File size must be 5MB or less.');
      el.value = '';
      return false;
    }
    const isPDF = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (!isPDF) {
      setError(el, 'Only PDF files are allowed.');
      el.value = '';
      return false;
    }
    clearError(el); return true;
  }

  // Get all relevant elements
  const firstNameEl = document.getElementById('first-name');
  const lastNameEl = document.getElementById('last-name');
  const middleNameEl = document.getElementById('middle-name');
  const emailEl = document.getElementById('email');
  const phoneEl = document.getElementById('contact-number');
  const birthdateEl = document.getElementById('birthdate');
  const provinceEl = document.getElementById('province');
  const cityEl = document.getElementById('city');
  const barangayEl = document.getElementById('barangay');
  const experienceYearsEl = document.getElementById('experience-years');
  const cvEl = document.getElementById('cv-upload');

  // Phone number input validation - restrict to numeric only, max 10 digits
  if (phoneEl) {
    phoneEl.addEventListener('input', () => validatePhone(phoneEl));
    phoneEl.addEventListener('blur', () => validatePhone(phoneEl));
  }

  // Name validations
  if (firstNameEl) {
    firstNameEl.addEventListener('input', () => validateName(firstNameEl, true));
    firstNameEl.addEventListener('blur', () => validateName(firstNameEl, true));
  }
  if (lastNameEl) {
    lastNameEl.addEventListener('input', () => validateName(lastNameEl, true));
    lastNameEl.addEventListener('blur', () => validateName(lastNameEl, true));
  }
  if (middleNameEl) {
    middleNameEl.addEventListener('input', () => validateName(middleNameEl, false));
    middleNameEl.addEventListener('blur', () => validateName(middleNameEl, false));
  }

  // Email validation (Gmail-only)
  if (emailEl) {
    emailEl.addEventListener('input', () => validateEmail(emailEl));
    emailEl.addEventListener('blur', () => validateEmail(emailEl));
  }

  // Birthdate validation (18+, max 60)
  if (birthdateEl) {
    birthdateEl.addEventListener('input', () => validateAge18Plus(birthdateEl));
    birthdateEl.addEventListener('blur', () => validateAge18Plus(birthdateEl));
  }

  // Years of experience validation (0-30)
  if (experienceYearsEl) {
    experienceYearsEl.addEventListener('input', () => validateYearsOfExperience(experienceYearsEl));
    experienceYearsEl.addEventListener('blur', () => validateYearsOfExperience(experienceYearsEl));
  }

  // Location dropdown validations
  if (provinceEl) {
    provinceEl.addEventListener('change', () => validateRequired(provinceEl));
  }
  if (cityEl) {
    cityEl.addEventListener('change', () => validateRequired(cityEl));
  }
  if (barangayEl) {
    barangayEl.addEventListener('change', () => validateRequired(barangayEl));
  }

  // CV file validation (PDF only, <= 5MB)
  if (cvEl) {
    cvEl.addEventListener('change', () => validateCVFile(cvEl));
  }

  async function handleFileSelect(el, key) {
    if (!el || !el.files || el.files.length === 0) return;
    const file = el.files[0];
    uploads[key] = { file, name: file.name };
    const labelSpan = document.querySelector(`label[for="${el.id}"] .file-input-text`);
    if (labelSpan) labelSpan.textContent = `Selected: ${file.name}`;

    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    const isImage = /^image\//.test(file.type) || /\.(jpe?g|png|bmp|tiff?)$/i.test(file.name);

    if (isPdf) {
      try {
        if (progText) progText.textContent = "Reading PDF content...";
        const txt = await extractPdfText(file, (p) => {
          if (progText) progText.textContent = `OCR progress: ${Math.round((p.progress||0)*100)}%`;
        });
        if (txt && txt.trim().length) {
          try { autoFillFromText(txt); } catch (e) { console.warn('autoFillFromText failed', e); }
        }
      } catch (err) {
        console.warn("PDF extraction failed:", err);
      } finally {
        if (progText) progText.textContent = "Ready to upload on submit!";
      }
    } else if (isImage) {
      try {
        if (progText) progText.textContent = "Running OCR on image...";
        const txt = await extractImageText(file, (p) => {
          if (progText) progText.textContent = `OCR progress: ${Math.round((p.progress||0)*100)}%`;
        });
        if (txt && txt.trim().length) {
          try { autoFillFromText(txt); } catch (e) { console.warn('autoFillFromText failed', e); }
        }
      } catch (err) {
        console.warn("Image OCR failed:", err);
      } finally {
        if (progText) progText.textContent = "Ready to upload on submit!";
      }
    } else {
      if (progText) progText.textContent = "File selected (no OCR attempted).";
    }
  }

  if (cvIn) cvIn.addEventListener("change", () => handleFileSelect(cvIn, "cv"));

  if (resumeBtn && resumeIn) resumeBtn.addEventListener("click", () => resumeIn.click());

  if (resumeIn) resumeIn.addEventListener("change", async function () {
    if (!this.files.length) return;
    const f = this.files[0];
    const MAX_SIZE_BYTES = 5 * 1024 * 1024;
    if (f.size > MAX_SIZE_BYTES) {
      setError(this, 'File size must be 5MB or less.');
      try { this.value = ''; } catch(e) {}
      if (resumeLabel) resumeLabel.textContent = 'No file selected';
      if (progBar) progBar.style.display = "none";
      if (progFill) progFill.style.width = "0%";
      if (progText) progText.textContent = '';
      if (uploads && uploads.resume) { try { delete uploads.resume; } catch(e) {} }
      return;
    }
    uploads.resume = { file: f, name: f.name };
    if (resumeLabel) resumeLabel.textContent = `Selected: ${f.name}`;
    if (progBar) progBar.style.display = "block";
    if (progFill) progFill.style.width = "0%";
    if (progText) progText.textContent = "Ready to upload on submit...";
    await handleFileSelect(this, "resume");
    if (progFill) progFill.style.width = "100%";
    if (progText) progText.textContent = "Ready to upload on submit!";
  });


  /* ---------- Confirmation modal wiring & improved UI ---------- */
  const confirmationModal = document.getElementById('confirmation-modal');
  const confirmationClose = document.getElementById('confirmation-close');
  const modalCancel = document.getElementById('modal-cancel-btn');
  const modalConfirmBtn = document.getElementById('modal-confirm-btn');

  const emailInput = document.getElementById('confirm-email-input');
  const btnGetCode = document.getElementById('btn-get-code'); // will act as Get / Resend
  const countdownSpan = document.getElementById('confirmation-countdown');
  const codeBlock = document.getElementById('confirmation-code-block');
  const codeInput = document.getElementById('confirm-code-input');
  const btnConfirmCode = document.getElementById('btn-confirm-code');
  const btnResend = document.getElementById('btn-resend'); // optional (we'll keep but hide/show as needed)
  const confirmError = document.getElementById('confirm-error');

  const successCard = document.getElementById('success-message');
  const successOkay = successCard ? successCard.querySelector('.okay-btn') : null;

  function showModal() { if (confirmationModal) confirmationModal.style.display = 'flex'; }
  function hideModal() { if (confirmationModal) confirmationModal.style.display = 'none'; }

  confirmationClose?.addEventListener('click', hideModal);
  modalCancel?.addEventListener('click', hideModal);

  // countdown state
  let countdownTimer = null;
  function startCountdown(seconds) {
    if (!countdownSpan) return;
    let remaining = Math.max(0, Math.floor(Number(seconds) || 0));
    countdownSpan.style.display = 'inline';
    // hide resend/button during countdown (we'll hide btnGetCode)
    if (btnGetCode) btnGetCode.style.display = 'none';
    if (btnResend) btnResend.style.display = 'none';
    function tick() {
      if (remaining <= 0) {
        clearInterval(countdownTimer);
        countdownTimer = null;
        countdownSpan.style.display = 'none';
        // restore the "Resend" button
        if (btnGetCode) { btnGetCode.style.display = ''; btnGetCode.disabled = false; btnGetCode.textContent = 'Resend'; }
        return;
      }
      const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
      const ss = String(remaining % 60).padStart(2, '0');
      countdownSpan.textContent = `Resend in ${mm}:${ss}`;
      remaining--;
    }
    tick();
    countdownTimer = setInterval(tick, 1000);
  }

  // server calls
  async function sendCode(applicationId, email) {
    if (!applicationId || !email) {
      if (confirmError) confirmError.textContent = 'Missing application context or email.';
      return;
    }
    if (!btnGetCode) return;
    btnGetCode.disabled = true;
    btnGetCode.textContent = 'Sending...';
    if (confirmError) confirmError.textContent = '';
    try {
      const resp = await fetch('/applicants/send-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationId, email })
      });

      // rate-limit response handling
      if (resp.status === 429) {
        const respJson = await resp.json().catch(() => ({}));
        const retrySec = respJson && (respJson.retryAfter || respJson.nextAllowedIn) ? Number(respJson.retryAfter || respJson.nextAllowedIn) : 180;
        // start countdown immediately on 429
        startCountdown(retrySec);
        if (confirmError) confirmError.textContent = respJson && (respJson.error || respJson.message) ? (respJson.error || respJson.message) : 'Please wait before resending.';
        return;
      }

      const jsonResp = await resp.json().catch(() => ({}));
      if (!resp.ok || !jsonResp.ok) {
        const msg = jsonResp && (jsonResp.error || jsonResp.message) ? (jsonResp.error || jsonResp.message) : 'Failed to send code.';
        if (confirmError) confirmError.textContent = msg;
        // if server returned nextAllowedIn, start countdown
        const after = (jsonResp && (jsonResp.nextAllowedIn || jsonResp.retryAfter)) ? Number(jsonResp.nextAllowedIn || jsonResp.retryAfter) : 180;
        startCountdown(after);
        return;
      }

      // Success -> show code input block and change Get -> Resend (but do not start cooldown until user clicks Resend)
      if (codeBlock) codeBlock.style.display = 'block';
      if (codeInput) codeInput.focus();

      // change the primary button to act as Resend (visible)
      if (btnGetCode) { btnGetCode.disabled = false; btnGetCode.textContent = 'Resend'; btnGetCode.style.display = ''; }
      // ensure countdown hidden
      if (countdownSpan) countdownSpan.style.display = 'none';

      // If server provided cooldown (allowed next send), we may use it when user clicks Resend
      // we'll store it on the button for later use
      const nextAllowedIn = (jsonResp && jsonResp.nextAllowedIn) ? Number(jsonResp.nextAllowedIn) : null;
      btnGetCode.dataset.nextAllowedIn = nextAllowedIn || '';

    } catch (err) {
      console.error('sendCode error', err);
      if (btnGetCode) { btnGetCode.disabled = false; btnGetCode.textContent = 'Get code'; }
      if (confirmError) confirmError.textContent = 'Network error. Try again.';
    }
  }

  async function verifyCodeAndAttach(applicationId, email, code, displayName) {
    if (confirmError) confirmError.textContent = '';
    if (!code || code.trim().length < 6) {
      if (confirmError) confirmError.textContent = 'Please enter the 6-digit code.';
      return;
    }
    if (!btnConfirmCode) return;
    btnConfirmCode.disabled = true;
    const orig = btnConfirmCode.textContent;
    btnConfirmCode.textContent = 'Verifying...';

    try {
      const resp = await fetch('/applicants/confirm-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ applicationId, email, code, displayName })
      });
      const respJson = await resp.json().catch(() => ({}));
      if (!resp.ok || !respJson.ok) {
        const msg = respJson && (respJson.error || respJson.message) ? (respJson.error || respJson.message) : 'Verification failed.';
        if (confirmError) confirmError.textContent = msg;
        btnConfirmCode.disabled = false;
        btnConfirmCode.textContent = orig || 'Confirm';
        return;
      }

      // At this point server created the user and updated teacherApplicants/{id}.status='submitted'
      // Now upload files to Firebase Storage via backend API
      try {
        let uploadedCount = 0;
        let failedCount = 0;

        // Helper: upload single file to backend
        async function uploadToBackend(fileObj, fileName, fileType = "resume") {
          if (!fileObj) return null;
          
          const formData = new FormData();
          formData.append("file", fileObj);
          formData.append("fileType", fileType);
          formData.append("label", fileName || fileType);

          try {
            const uploadResp = await fetch(`/api/applicants/${encodeURIComponent(applicationId)}/upload-file`, {
              method: "POST",
              body: formData // Note: No Content-Type header - browser sets it automatically with boundary
            });

            const result = await uploadResp.json().catch(() => ({}));
            if (!uploadResp.ok || !result.ok) {
              console.error("Upload failed:", result.error || "Unknown error");
              return null;
            }

            console.log("✅ File uploaded:", result.fileName);
            return result;
          } catch (err) {
            console.error("Upload request failed:", err);
            return null;
          }
        }

        // Iterate over in-memory uploads and upload to backend
        for (const k of Object.keys(uploads)) {
          const entry = uploads[k];
          if (!entry || !entry.file) continue;
          
          // Determine file type based on key (cv -> resume, certificate -> certificate, etc.)
          let fileType = "resume"; // default
          if (k.toLowerCase().includes("certificate")) fileType = "certificate";
          else if (k.toLowerCase().includes("transcript")) fileType = "transcript";
          else if (k.toLowerCase().includes("license")) fileType = "license";
          else if (k.toLowerCase().includes("cv") || k.toLowerCase().includes("resume")) fileType = "resume";
          
          const result = await uploadToBackend(entry.file, entry.name || `${k}.dat`, fileType);
          if (result) uploadedCount++;
          else failedCount++;
        }

        // Show warning if some uploads failed
        if (failedCount > 0) {
          console.warn(`⚠️ ${failedCount} file(s) failed to upload`);
          const noteEl = successCard ? successCard.querySelector('.email-note') : null;
          if (noteEl) noteEl.textContent = `${uploadedCount} file(s) uploaded successfully. ${failedCount} failed. Contact support if needed.`;
        } else if (uploadedCount > 0) {
          console.log(`✅ All ${uploadedCount} file(s) uploaded successfully`);
        }

      } catch (uploadErr) {
        console.error("File upload error after confirm:", uploadErr);
        if (successCard) {
          const noteEl = successCard.querySelector('.email-note');
          if (noteEl) noteEl.textContent = 'File upload failed. Please try uploading from your dashboard or contact support.';
        }
      }

      // Hide confirmation modal FIRST before showing success
      hideModal();
      
      // show success UI
      if (successCard) {
        successCard.style.display = 'block';
        // Ensure success card has higher z-index
        successCard.style.zIndex = '10000';
      }
      else alert('Application submitted and credentials emailed.');

      // if server indicated emailed:false, surface a note
      if (respJson && respJson.emailed === false) {
        const noteEl = successCard ? successCard.querySelector('.email-note') : null;
        if (noteEl) noteEl.textContent = 'Account created but email delivery failed. Contact support.';
        else alert('Account created but email delivery failed. Contact support.');
      }

      btnConfirmCode.disabled = false;
      btnConfirmCode.textContent = orig || 'Confirm';
    } catch (err) {
      console.error('verifyCode error', err);
      if (confirmError) confirmError.textContent = 'Network error. Try again later.';
      btnConfirmCode.disabled = false;
      btnConfirmCode.textContent = orig || 'Confirm';
    }
  }

  // Wire modal buttons behavior
  if (btnGetCode) {
    btnGetCode.addEventListener('click', (ev) => {
      ev.preventDefault();
      if (!window._currentApplicationId) {
        if (confirmError) confirmError.textContent = 'Application context missing. Please submit the form first.';
        return;
      }
      const email = (emailInput && emailInput.value && emailInput.value.trim()) ? emailInput.value.trim() : '';
      if (!email) { if (confirmError) confirmError.textContent = 'Please enter your email address.'; return; }

      // If button currently shows 'Get code' or 'Resend', treat both as sendCode.
      // If it shows 'Resend' and there is a nextAllowedIn stored, start countdown instead of immediate send.
      const btnText = (btnGetCode.textContent || '').toLowerCase().trim();
      const storedNext = Number(btnGetCode.dataset.nextAllowedIn || 0);

      if (btnText === 'resend' && storedNext > 0) {
        // Start countdown using stored nextAllowedIn and prevent immediate resend
        startCountdown(storedNext);
        return;
      }

      sendCode(window._currentApplicationId, email);
    });
  }
  if (btnResend) {
    // some HTML had a separate resend button; keep compatible (hidden by CSS until needed)
    btnResend.addEventListener('click', (ev) => {
      ev.preventDefault();
      if (!window._currentApplicationId) {
        if (confirmError) confirmError.textContent = 'Application context missing.'; return;
      }
      const email = (emailInput && emailInput.value && emailInput.value.trim()) ? emailInput.value.trim() : '';
      if (!email) { if (confirmError) confirmError.textContent = 'Please enter your email.'; return; }
      // when using separate resend, disable and start cooldown after success
      sendCode(window._currentApplicationId, email);
    });
  }

  if (btnConfirmCode) {
    btnConfirmCode.addEventListener('click', (ev) => {
      ev.preventDefault();
      if (!window._currentApplicationId) {
        if (confirmError) confirmError.textContent = 'Application context missing.'; return;
      }
      const email = (emailInput && emailInput.value && emailInput.value.trim()) ? emailInput.value.trim() : '';
      const code = (codeInput && codeInput.value) ? codeInput.value.trim() : '';
      const displayName = `${document.getElementById('first-name').value || ''} ${document.getElementById('last-name').value || ''}`.trim();
      verifyCodeAndAttach(window._currentApplicationId, email, code, displayName);
    });
  }

  // Map modal Confirm button to code verification too
  if (modalConfirmBtn) {
    modalConfirmBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      if (btnConfirmCode) btnConfirmCode.click();
    });
  }

  // Success OK button: clear form and UI
  function clearFormAndResetUI() {
    // clear text inputs
    const inputs = document.querySelectorAll("input[type=text], input[type=email], input[type=tel], input[type=date], input[type=number], input[type=file], textarea");
    inputs.forEach(i => {
      try { i.value = ""; i.dataset.userEdited = 'false'; } catch(e) {}
    });
    // clear selects
    const selects = document.querySelectorAll("select");
    selects.forEach(s => { try { s.selectedIndex = 0; } catch(e) {} });

    // reset file inputs and in-memory uploads
    const fileInputs = document.querySelectorAll("input[type=file]");
    fileInputs.forEach(f => { try { f.value = ""; } catch(e) {} });

    // reset custom UI elements
    const resumeLabel = document.getElementById("file-name");
    if (resumeLabel) resumeLabel.textContent = "";
    const progBar = document.getElementById("progress-bar");
    const progFill = document.getElementById("progress-fill");
    const progText = document.getElementById("progress-text");
    if (progBar) progBar.style.display = "none";
    if (progFill) progFill.style.width = "0%";
    if (progText) progText.textContent = "";

    // clear in-memory upload state
    try { Object.keys(uploads).forEach(k => delete uploads[k]); } catch (e) { console.warn("clear uploads error", e); }

    // hide modal and success card
    if (successCard) successCard.style.display = 'none';
    hideModal();
    // clear _currentApplicationId
    window._currentApplicationId = null;
  }

  if (successOkay) {
    successOkay.addEventListener('click', (ev) => {
      ev.preventDefault();
      clearFormAndResetUI();
    });
  }

  // Open confirmation modal helper
  function openConfirmationModal(applicationId, emailPrefill) {
    window._currentApplicationId = applicationId;
    if (emailInput) emailInput.value = emailPrefill || '';
    // show code block as requested
    if (codeBlock) codeBlock.style.display = 'block';
    if (confirmError) confirmError.textContent = '';
    if (countdownSpan) { countdownSpan.style.display = 'none'; countdownSpan.textContent = ''; }
    if (btnGetCode) { btnGetCode.disabled = false; btnGetCode.textContent = 'Get code'; btnGetCode.style.display = ''; btnGetCode.dataset.nextAllowedIn = ''; }
    if (btnResend) btnResend.style.display = 'none';
    showModal();
  }

  /* ---------- Submit handler ---------- */
  if (submitBtn) submitBtn.addEventListener("click", async (ev) => {
    ev.preventDefault();

    // Helper to get selected text from select elements
    const getSelectedText = (id) => {
      const select = document.getElementById(id);
      if (!select || !select.value) return "";
      const selectedOption = select.options[select.selectedIndex];
      return selectedOption ? selectedOption.textContent.trim() : "";
    };

    // read fields
    const ln = document.getElementById("last-name").value.trim();
    const fn = document.getElementById("first-name").value.trim();
    const mn = document.getElementById("middle-name").value.trim();
    const ext = document.getElementById("name-extension").value;
    const phoneInput = document.getElementById("contact-number").value.trim();
    const userEmail = document.getElementById("email").value.trim();
    const bd = document.getElementById("birthdate").value;
    
    // Combine address fields into single string like JHS/SHS
    const street = document.getElementById("street-address")?.value?.trim() || "";
    const barangay = getSelectedText("barangay");
    const city = getSelectedText("city");
    const province = getSelectedText("province");
    const addr = `${street}, ${barangay}, ${city}, ${province}`;
    
    const degree = document.getElementById("highest-degree").value;
    const major = document.getElementById("major").value.trim();
    const grad = document.getElementById("grad-year").value;
    const inst = document.getElementById("institution").value.trim();
    const exp = document.getElementById("experience-years").value;
    const prev = document.getElementById("previous-schools").value.trim();

    const pref = document.getElementById("preferred-level").value;
    const subjects = document.getElementById("qualified-subjects").value.trim();
    const empType = document.getElementById("employment-type").value;

    // basic validation
    if (!fn || !ln || !userEmail) {
      alert('Please fill required fields (first name, last name, email).');
      return;
    }

    // Validate and format phone number
    if (!phoneInput) {
      alert('Please enter your contact number.');
      document.getElementById("contact-number").focus();
      return;
    }
    if (phoneInput.length !== 10) {
      alert('Contact number must be exactly 10 digits.');
      document.getElementById("contact-number").focus();
      return;
    }
    if (!phoneInput.startsWith('9')) {
      alert('Contact number must start with 9.');
      document.getElementById("contact-number").focus();
      return;
    }
    // Format with +63 prefix
    const phone = '+63' + phoneInput;

    const payload = {
      formType: "teacher",
      lastName: ln,
      firstName: fn,
      middleName: mn,
      nameExtension: ext,
      contactNumber: phone,
      email: userEmail,
      birthdate: bd,
      address: addr,
      highestDegree: degree,
      major,
      gradYear: grad,
      institution: inst,
      experienceYears: exp,
      previousSchools: prev,
      preferredLevel: pref,
      qualifiedSubjects: subjects,
      employmentType: empType
    };

    // disable submit button while creating application
    submitBtn.disabled = true;
    const origText = submitBtn.textContent;
    submitBtn.textContent = 'Submitting…';

    try {
      // Call server to create application (server must NOT create Auth user nor send credentials)
      const res = await fetch("/applicants/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || !result.success) {
        console.error("Server creation error:", result);
        alert("Server error: " + (result.error || "Failed to create applicant"));
        submitBtn.disabled = false;
        submitBtn.textContent = origText;
        return;
      }
      const applicationId = result.applicationId;

      // Open confirmation modal so applicant can confirm the email and get code
      openConfirmationModal(applicationId, userEmail);

    } catch (err) {
      console.error("Error submitting application:", err);
      alert("Failed to submit application. Please try again later.");
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = origText;
    }
  });
});
