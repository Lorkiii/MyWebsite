// shs-server.js (updated client-side)
import { API_BASE_URL } from './api-config.js';

document.addEventListener("DOMContentLoaded", () => {
  const submitTrigger = document.getElementById("submit-btn");
  const confirmationModal = document.getElementById("confirmation-modal");
  const confirmBtn = document.getElementById("modal-confirm-btn");
  const cancelBtn = document.getElementById("modal-cancel-btn");
  const confirmationClose = document.getElementById("confirmation-close");
  const successModal = document.getElementById("success-modal");
  const modalOkBtn = document.getElementById("modal-ok-btn");

  // Phone number input validation - restrict to numeric only, max 10 digits
  const phoneInput = document.getElementById("contact-number");
  if (phoneInput) {
    phoneInput.addEventListener("input", function() {
      this.value = this.value.replace(/[^0-9]/g, '');
      if (this.value.length > 10) {
        this.value = this.value.slice(0, 10);
      }
    });
  }

  // File type definitions for new and returning students
  const FILE_TYPES = {
    new: [
      { id: "reportcard-new", type: "reportcard", label: "Report Card (Form 138)" },
      { id: "psa-upload", type: "psa", label: "PSA Birth Certificate" }
    ],
    returning: [
      { id: "clearance-upload", type: "clearance", label: "Clearance Certificate" },
      { id: "reportcard-returning", type: "reportcard", label: "Report Card (Form 138)" }
    ]
  };

  // Add visual feedback for file selection
  function setupFileInputFeedback() {
    const allFileInputs = [
      "reportcard-new",
      "psa-upload",
      "clearance-upload",
      "reportcard-returning"
    ];

    allFileInputs.forEach(inputId => {
      const input = document.getElementById(inputId);
      if (!input) return;

      input.addEventListener("change", function() {
        const labelSpan = document.querySelector(`label[for="${inputId}"] .file-input-text`);
        if (!labelSpan) return;

        if (this.files && this.files.length > 0) {
          const file = this.files[0];
          const fileSizeKB = (file.size / 1024).toFixed(1);
          labelSpan.textContent = `Selected: ${file.name} (${fileSizeKB} KB)`;
          labelSpan.style.color = "#2e8b57";
          labelSpan.style.fontWeight = "500";
        } else {
          labelSpan.textContent = "Choose file";
          labelSpan.style.color = "";
          labelSpan.style.fontWeight = "";
        }
      });
    });
  }

  // Initialize file input feedback
  setupFileInputFeedback();

  // Validate all required fields before submission
  function validateRequiredFields() {
    const requiredFields = [
      { id: "first-name", label: "First Name" },
      { id: "last-name", label: "Last Name" },
      { id: "birth-date", label: "Birth Date" },
      { id: "gender", label: "Gender" },
      { id: "grade-level", label: "Grade Level" },
      { id: "academic-track", label: "Academic Track" },
      { id: "barangay", label: "Barangay" },
      { id: "city", label: "City" },
      { id: "province", label: "Province" },
      { id: "guardian", label: "Parent/Guardian Name" },
      { id: "contact-number", label: "Contact Number" },
      { id: "email-address", label: "Email Address"}
    ];

    const missingFields = [];

    // Check basic required fields
    for (const field of requiredFields) {
      const element = document.getElementById(field.id);
      const value = element?.value?.trim();
      if (!value) {
        missingFields.push(field.label);
      }
    }

    // Check student type is selected
    const studentType = document.querySelector('input[name="student-type"]:checked')?.value;
    if (!studentType) {
      missingFields.push("Student Type");
    }

    // Check conditional required fields
    const previousSchool = document.getElementById("previous-school")?.value?.trim();
    if (!previousSchool) {
      missingFields.push("Previous School");
    }
    if (studentType === "old") {
      const studentNumber = document.getElementById("student-number")?.value?.trim();
      if (!studentNumber) {
        missingFields.push("Student Number");
      }
    }

    // Note: File uploads are now OPTIONAL - students can submit without documents

    // Show alert if there are missing fields
    if (missingFields.length > 0) {
      const fieldsList = missingFields.map((field, index) => `${index + 1}. ${field}`).join('\n');
      alert(`⚠️ Please fill in all required fields:\n\n${fieldsList}`);
      
      // Focus on first missing field
      const firstMissingId = requiredFields.find(f => missingFields.includes(f.label))?.id;
      if (firstMissingId) {
        document.getElementById(firstMissingId)?.focus();
      }
      return false;
    }

    return true;
  }

  const slotToInputId = {
    reportcard: "reportcard-upload",
    psa: "psa-upload",
    clearance: "clearance-upload"
  };

  function fileInputFor(slot) {
    const id = slotToInputId[slot];
    return id ? document.getElementById(id) : null;
  }

  function getOrCreateStatusContainer(slot) {
    const input = fileInputFor(slot);
    if (!input) return null;
    const container = input.closest(".file-input-container") || input.parentElement;
    if (!container) return null;
    const id = `upload-status-${slot}`;
    let statusEl = container.querySelector(`#${id}`);
    if (!statusEl) {
      statusEl = document.createElement("div");
      statusEl.id = id;
      statusEl.className = "upload-status";
      statusEl.style.marginTop = "0.4rem";
      statusEl.style.fontSize = "0.95rem";
      statusEl.style.color = "#439928ff";
      container.appendChild(statusEl);
    }
    return statusEl;
  }

  function renderStatus(slot, { state = "idle", file = null, message = "" } = {}) {
    const container = getOrCreateStatusContainer(slot);
    if (!container) return;
    container.textContent = "";
    let text = "";
    if (state === "selected") text = file ? `Selected: ${file.name}` : "Selected";
    else if (state === "uploading") text = file ? `Uploading: ${file.name}` : "Uploading...";
    else if (state === "success") text = file ? `Uploaded: ${file.name}` : "Uploaded";
    else if (state === "error") text = message || "Upload error";
    else text = message || "";
    container.textContent = text;
  }

  for (const slot of Object.keys(slotToInputId)) {
    const input = fileInputFor(slot);
    if (!input) continue;
    input.addEventListener("change", () => {
      const f = input.files?.[0] || null;
      if (f) {
        renderStatus(slot, { state: "selected", file: f });
      } else {
        const container = getOrCreateStatusContainer(slot);
        if (container) container.textContent = "";
      }
    });
  }

  function collectFormDataAndFiles() {
    const getVal = (id) => document.getElementById(id)?.value?.trim() || "";
    
    // Helper to get selected text from select elements
    const getSelectedText = (id) => {
      const select = document.getElementById(id);
      if (!select || !select.value) return "";
      const selectedOption = select.options[select.selectedIndex];
      return selectedOption ? selectedOption.textContent.trim() : "";
    };

    // Validate and format phone number
    const phoneInput = getVal("contact-number");
    if (!phoneInput) {
      alert('Please enter contact number.');
      document.getElementById("contact-number")?.focus();
      return null;
    }
    if (phoneInput.length !== 10) {
      alert('Contact number must be exactly 10 digits.');
      document.getElementById("contact-number")?.focus();
      return null;
    }
    if (!phoneInput.startsWith('9')) {
      alert('Contact number must start with 9.');
      document.getElementById("contact-number")?.focus();
      return null;
    }
    const contactNumber = '+63' + phoneInput;

    // Combine address fields into single string
    const street = getVal("street-address");
    const barangay = getSelectedText("barangay");
    const city = getSelectedText("city");
    const province = getSelectedText("province");
    const fullAddress = `${street}, ${barangay}, ${city}, ${province}`;

    const metadata = {
      formType: "shs",
      firstName: getVal("first-name"),
      lastName: getVal("last-name"),
      middleName: getVal("middle-name"),
      suffix: getVal("suffix"),
      birthdate: getVal("birth-date"),
      email: getVal("email-address"),
      gender: getVal("gender"),
      gradeLevel: getVal("grade-level"),
      academicTrack: getVal("academic-track"),
      address: fullAddress,
      contactNumber: contactNumber,
      guardianName: getVal("guardian"),
      completionYear: getVal("completion-year"),
      studentType: document.querySelector('input[name="student-type"]:checked')?.value || "",
      previousSchool: getVal("previous-school"),
      studentNumber: getVal("student-number")
    };

    // Get files based on student type
    const studentType = metadata.studentType;
    const fileTypes = (studentType === "new") ? FILE_TYPES.new : FILE_TYPES.returning;
    
    const files = [];
    for (const fileType of fileTypes) {
      const input = document.getElementById(fileType.id);
      const file = input?.files?.[0];
      if (file) {
        files.push({
          file: file,
          type: fileType.type,
          label: fileType.label
        });
      }
    }
    
    return { metadata, files };
  }

  async function performSubmitFlow() {
    if (typeof window.validateAge === "function") {
      const ok = window.validateAge();
      if (!ok) return;
    }

    if (confirmBtn) confirmBtn.disabled = true;
    const origConfirmText = confirmBtn?.textContent || "Confirm";
    if (confirmBtn) confirmBtn.textContent = "Submitting...";

    try {
      const result = collectFormDataAndFiles();
      if (!result) {
        // Validation failed (phone number error)
        if (confirmBtn) {
          confirmBtn.disabled = false;
          confirmBtn.textContent = origConfirmText;
        }
        return;
      }
      const { metadata, files } = result;


      // Create enrollee server-side
      const createResp = await fetch(`${API_BASE_URL}/api/enrollees`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(metadata)
      });

      if (!createResp.ok) {
        const body = await createResp.json().catch(() => ({}));
        throw new Error(body.error || `Server error ${createResp.status}`);
      }
      const createResult = await createResp.json();
      const studentId = createResult.studentId;


      // 2) Upload each file with its type
      for (const fileItem of files) {
        console.log(`📤 SHS: Uploading ${fileItem.label} (${fileItem.type})...`);
        const formData = new FormData();
        formData.append("file", fileItem.file);
        formData.append("fileType", fileItem.type);
        formData.append("label", fileItem.label);

        const uploadUrl = `${API_BASE_URL}/api/enrollees/${encodeURIComponent(studentId)}/upload-file`;
        console.log('📍 SHS: Upload URL:', uploadUrl);
        
        const uploadResp = await fetch(uploadUrl, {
          method: "POST",
          body: formData
        });
     
        if (!uploadResp.ok) {
          const body = await uploadResp.json().catch(() => ({}));
          console.error(`❌ SHS: Failed to upload ${fileItem.label}:`, body);
          throw new Error(body.error || `Upload failed for ${fileItem.label}`);
        }

        const uploadResult = await uploadResp.json();
        console.log(`✅ SHS: Uploaded ${fileItem.label} successfully:`, uploadResult);
      }

      // show success UI
      if (confirmationModal) confirmationModal.style.display = "none";
      if (successModal) successModal.style.display = "block";

      // reset form after short delay
      setTimeout(() => {
        const form = document.getElementById("enrollment-form");
        form?.reset();
        for (const slot of Object.keys(slotToInputId)) {
          const el = getOrCreateStatusContainer(slot);
          if (el) el.textContent = "";
        }
        if (typeof window.handleStudentTypeChange === "function") window.handleStudentTypeChange();
      }, 500);
      
    } catch (err) {
      console.error("Submit error:", err);
      alert("Submission failed: " + (err.message || "check console"));
    } finally {
      if (confirmBtn) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = origConfirmText;
      }
      
    }
  }

  if (submitTrigger) {
    submitTrigger.addEventListener("click", (e) => {
      e.preventDefault();
      // Validate all required fields first
      if (!validateRequiredFields()) return;
      // Validate age
      if (typeof window.validateAge === "function" && !window.validateAge()) return;
      // Show confirmation modal
      if (confirmationModal) confirmationModal.style.display = "block";
    });
  }
  if (cancelBtn) cancelBtn.addEventListener("click", () => {
    if (confirmationModal) confirmationModal.style.display = "none";
  });
  if (confirmationClose) confirmationClose.addEventListener("click", () => {
    if (confirmationModal) confirmationModal.style.display = "none";
  });
  if (confirmBtn) {
    confirmBtn.addEventListener("click", async (ev) => {
      ev.preventDefault();
      await performSubmitFlow();
    });
  }
  if (modalOkBtn) {
    modalOkBtn.addEventListener("click", () => {
      if (successModal) successModal.style.display = "none";
      window.location.reload();
    });
  }
});
