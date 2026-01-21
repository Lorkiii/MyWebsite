// shsform.js
// Validation + UI toggles for SHS form (matches your HTML ids)
import { setupLocationDropdowns, getSelectedText } from './location-api.js';

document.addEventListener("DOMContentLoaded", function () {
  const returnLink = document.getElementById("return-link");
  if (returnLink) {
    returnLink.addEventListener("click", function (e) {
      e.preventDefault();
      window.location.href = "../applicationform/main.html";
    });
  }
  const studentTypeRadios = document.querySelectorAll('input[name="student-type"]');
  const previousSchoolGroup = document.getElementById("previous-school-group");
  const studentNumberGroup = document.getElementById("student-number-group");
  const studentNumberInput = document.getElementById("student-number");
  const previousSchoolInput = document.getElementById("previous-school");
  const returningStudentDocs = document.getElementById("returning-student-documents");
  const newStudentDocs = document.getElementById("new-student-documents");
  const returningStdRequirements = document.getElementById("returning-std-requirements");
  const newStdRequirements = document.getElementById("new-std-requirements");
  const completionYearGroup = document.getElementById("completion-year-group");

  function handleStudentTypeChange() {
    const selectedValue = document.querySelector('input[name="student-type"]:checked')?.value;

    if (selectedValue === "new") {
      if (previousSchoolGroup) previousSchoolGroup.style.display = "block";
      if (studentNumberGroup) studentNumberGroup.style.display = "none";
      if (studentNumberInput) studentNumberInput.required = false;
      if (previousSchoolInput) previousSchoolInput.required = true;
      if (newStudentDocs) newStudentDocs.style.display = "block";
      if (returningStudentDocs) returningStudentDocs.style.display = "none";
      if (newStdRequirements) newStdRequirements.style.display = "block";
      if (returningStdRequirements) returningStdRequirements.style.display = "none";
      if (completionYearGroup) {
        completionYearGroup.style.display = "block";
        const input = completionYearGroup.querySelector("input");
        if (input) input.required = true;
      }
    } else if (selectedValue === "old") {
      if (studentNumberGroup) studentNumberGroup.style.display = "grid";
      if (previousSchoolGroup) previousSchoolGroup.style.display = "none";
      if (studentNumberInput) studentNumberInput.required = true;
      if (previousSchoolInput) previousSchoolInput.required = false;

      if (returningStudentDocs) returningStudentDocs.style.display = "block";
      if (newStudentDocs) newStudentDocs.style.display = "none";
      if (returningStdRequirements) returningStdRequirements.style.display = "block";
      if (newStdRequirements) newStdRequirements.style.display = "none";
      if (completionYearGroup) completionYearGroup.style.display = "none";
    }
  }

  studentTypeRadios.forEach((radio) => radio.addEventListener("change", handleStudentTypeChange));
  handleStudentTypeChange();

  // ----- AGE VALIDATION -----
  const birthDateInput = document.getElementById("birth-date");
  const birthDateError = document.getElementById("birth-date-error");
  const gradeLevelSelect = document.getElementById("grade-level");


  const submitBtn = document.getElementById("submit-btn");

  function validateAge() {
    // defensive: if required DOM nodes are missing, allow submit (other validations will handle)
    if (!birthDateError || !birthDateInput || !gradeLevelSelect) return true;

    const birthDateValue = birthDateInput.value;
    const gradeLevelValue = (gradeLevelSelect.value || "").trim();

    if (!birthDateValue || !gradeLevelValue) {
      birthDateError.style.display = "none";
      birthDateError.textContent = "";
      if (submitBtn) submitBtn.disabled = false;
      return true;
    }

    const birthDate = new Date(birthDateValue);
    if (isNaN(birthDate.getTime())) {
      birthDateError.style.display = "block";
      birthDateError.textContent = "Invalid birthdate format.";
      if (submitBtn) submitBtn.disabled = true;
      return false;
    }

    const today = new Date();
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      age--;
    }

    // Check maximum age (60 years old)
    const MAX_AGE = 60;
    if (age > MAX_AGE) {
      birthDateError.style.display = "block";
      birthDateError.textContent = `Age must not exceed ${MAX_AGE} years old. (Current age: ${age})`;
      if (submitBtn) submitBtn.disabled = true;
      return false;
    }

    // extract numeric grade (e.g., "Grade 11" -> 11)
    const match = gradeLevelValue.match(/\d+/);
    const gradeNum = match ? match[0] : null;

    const gradeMinAges = { "11": 15, "12": 16 };

    const minAge = gradeNum ? gradeMinAges[gradeNum] : undefined;

    if (!minAge) {
      birthDateError.style.display = "none";
      birthDateError.textContent = "";
      if (submitBtn) submitBtn.disabled = false;
      return true;
    }

    if (age < minAge) {
      birthDateError.style.display = "block";
      birthDateError.textContent = `Age must be at least ${minAge} years old for ${gradeLevelValue} applicants. (Current age: ${age})`;
      if (submitBtn) submitBtn.disabled = true;
      return false;
    } else {
      birthDateError.style.display = "none";
      birthDateError.textContent = "";
      if (submitBtn) submitBtn.disabled = false;
      return true;
    }
  }

  // attach instant validation listeners
  if (birthDateInput) birthDateInput.addEventListener("input", validateAge);
  if (gradeLevelSelect) gradeLevelSelect.addEventListener("change", validateAge);

  // run once on load to initialize state
  validateAge();

  // Expose for other scripts (server) to call before submission
  window.validateAge = validateAge;
  window.handleStudentTypeChange = handleStudentTypeChange;

  // -------- Location Dropdowns Setup --------
  setupLocationDropdowns({
    provinceId: 'province',
    cityId: 'city',
    barangayId: 'barangay'
  }).catch(err => {
    console.error('Failed to setup location dropdowns:', err);
  });

  // intentionally do not attach form submit here; submission handled by shs-server.js

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
    if (!val) { if (required) { setError(el,'This field is required.'); return false; } else { clearError(el); return true; } }
    if (!NAME_RE.test(val)) { setError(el, 'Letters, spaces, apostrophes, hyphens only.'); return false; }
    clearError(el); return true;
  }
  function validateEmail(el) {
    if (!el) return true;
    const v = (el.value || '').trim();
    if (!v) { setError(el,'Email is required.'); return false; }
    if (!EMAIL_RE.test(v)) { setError(el,'Enter a valid email address.'); return false; }
    clearError(el); return true;
  }
  function validatePhone(el) {
    if (!el) return true;
    el.value = (el.value || '').replace(/[^0-9]/g,'').slice(0,10);
    const v = el.value;
    if (v.length !== 10 || v[0] !== '9') { setError(el,'Enter 10 digits starting with 9.'); return false; }
    clearError(el); return true;
  }
  function validateStudentNumber(el, required) {
    if (!el) return true;
    el.value = (el.value || '').replace(/[^0-9]/g,'').slice(0,12);
    const v = (el.value || '').trim();
    if (!v) { if (required) { setError(el,'Student number is required.'); return false; } else { clearError(el); return true; } }
    if (!/^\d{6,12}$/.test(v)) { setError(el,'Digits only, 6–12 length.'); return false; }
    clearError(el); return true;
  }
  function validateLocation(el) {
    // For select dropdowns, just check if a value is selected
    if (!el) return true;
    const v = (el.value || '').trim();
    if (!v) { setError(el, 'This field is required.'); return false; }
    clearError(el); return true;
  }
  function validateRequired(el) {
    if (!el) return true;
    const v = (el.value || '').trim();
    if (!v) { setError(el,'This field is required.'); return false; }
    clearError(el); return true;
  }

  const firstName = document.getElementById('first-name');
  const lastName = document.getElementById('last-name');
  const middleName = document.getElementById('middle-name');
  const guardianEl = document.getElementById('guardian');
  const emailEl = document.getElementById('email-address');
  const phoneEl = document.getElementById('contact-number');
  const studentNoEl = document.getElementById('student-number');
  const barangayEl = document.getElementById('barangay');
  const cityEl = document.getElementById('city');
  const provinceEl = document.getElementById('province');
  const prevSchoolEl = document.getElementById('previous-school');

  if (firstName) {
    firstName.addEventListener('input', () => validateName(firstName, true));
    firstName.addEventListener('blur', () => validateName(firstName, true));
  }
  if (lastName) {
    lastName.addEventListener('input', () => validateName(lastName, true));
    lastName.addEventListener('blur', () => validateName(lastName, true));
  }
  if (middleName) {
    middleName.addEventListener('input', () => validateName(middleName, false));
    middleName.addEventListener('blur', () => validateName(middleName, false));
  }
  if (guardianEl) {
    guardianEl.addEventListener('input', () => validateName(guardianEl, true));
    guardianEl.addEventListener('blur', () => validateName(guardianEl, true));
  }
  if (emailEl) {
    emailEl.addEventListener('input', () => validateEmail(emailEl));
    emailEl.addEventListener('blur', () => validateEmail(emailEl));
  }
  if (phoneEl) {
    phoneEl.addEventListener('input', () => validatePhone(phoneEl));
    phoneEl.addEventListener('blur', () => validatePhone(phoneEl));
  }
  if (studentNoEl) {
    studentNoEl.addEventListener('input', () => {
      const type = document.querySelector('input[name="student-type"]:checked')?.value;
      validateStudentNumber(studentNoEl, type === 'old');
    });
    studentNoEl.addEventListener('blur', () => {
      const type = document.querySelector('input[name="student-type"]:checked')?.value;
      validateStudentNumber(studentNoEl, type === 'old');
    });
  }
  if (barangayEl) {
    barangayEl.addEventListener('change', () => validateLocation(barangayEl));
  }
  if (cityEl) {
    cityEl.addEventListener('change', () => validateLocation(cityEl));
  }
  if (provinceEl) {
    provinceEl.addEventListener('change', () => validateLocation(provinceEl));
  }
  if (prevSchoolEl) {
    prevSchoolEl.addEventListener('input', () => validateRequired(prevSchoolEl));
    prevSchoolEl.addEventListener('blur', () => validateRequired(prevSchoolEl));
  }
});
