import { auth } from "../firebase-config.js";
import { apiFetch } from "../api-fetch.js";

(function () {
  const API_BASE = "/api/notes"; // Relative URL - works in dev and production
  let allNotes = []; // Store fetched notes
  let isLoading = false;

  // fetches all nmotes
  async function fetchNotes() {
    try {
      isLoading = true;
      showLoading();

      // apiFetch handles auth automatically
      const data = await apiFetch(API_BASE);
      allNotes = data.notes || [];
      renderNotes();
    } catch (err) {
      showError("Failed to load notes");
    } finally {
      isLoading = false;
      hideLoading();
    }
  }

  // creates new notwe
  async function createNote(text) {
    try {
      // apiFetch handles auth and headers automatically
      const data = await apiFetch(API_BASE, {
        method: "POST",
        body: JSON.stringify({ text }),
      });

      // Add new note to local array and re-render
      allNotes.unshift(data.note); // Add to beginning (newest first)
      renderNotes(data.note.id);

      return data.note;
    } catch (err) {
      console.log("[Notes] Error creating note:", err);
      showError(err.message);
      throw err;
    }
  }

  // updates the notes
  async function updateNote(noteId, text) {
    try {
      // apiFetch handles auth and headers automatically
      const data = await apiFetch(`${API_BASE}/${noteId}`, {
        method: "PUT",
        body: JSON.stringify({ text }),
      });

      // Update local array
      const index = allNotes.findIndex((n) => n.id === noteId);
      if (index !== -1) {
        allNotes[index] = data.note;
        renderNotes();
      }

      return data.note;
    } catch (err) {
      console.log("[Notes] Error updating note:", err);
      showError(err.message);
      throw err;
    }
  }

  //delte note
  async function deleteNote(noteId) {
    try {
      // apiFetch handles auth automatically
      await apiFetch(`${API_BASE}/${noteId}`, {
        method: "DELETE",
      });

      // Remove from local array
      allNotes = allNotes.filter((n) => n.id !== noteId);
      renderNotes();
    } catch (err) {
      console.error("[Notes] Error deleting note:", err);
      showError(err.message);
      throw err;
    }
  }

  /**
   * Render all notes to the DOM
   */
  function renderNotes(highlightId = null) {
    const noteList = document.getElementById("note-list");
    const noteEmpty = document.getElementById("note-empty");
    const template = document.getElementById("note-template");

    if (!noteList || !template) return;

    // Clear existing notes (keep empty state element)
    const existingNotes = noteList.querySelectorAll(".note-item");
    existingNotes.forEach((note) => note.remove());

    // Show/hide empty state
    if (allNotes.length === 0) {
      if (noteEmpty) noteEmpty.style.display = "block";
      return;
    } else {
      if (noteEmpty) noteEmpty.style.display = "none";
    }

    // Render each note
    allNotes.forEach((note) => {
      const noteElement = template.content.cloneNode(true);
      const li = noteElement.querySelector(".note-item");

      // Set note data
      li.dataset.noteId = note.id;

      // Set text content
      const noteText = li.querySelector(".note-text");
      noteText.textContent = note.text;

      // Set timestamp
      const timestamp = li.querySelector(".note-timestamp");
      timestamp.textContent = formatTimestamp(note.createdAt, note.updatedAt);

      // Add event listeners for buttons
      const editBtn = li.querySelector(".note-edit-btn");
      const deleteBtn = li.querySelector(".note-delete-btn");

      editBtn.addEventListener("click", () => handleEditClick(note.id));
      deleteBtn.addEventListener("click", () => handleDeleteClick(note.id));

      // Setup edit mode
      setupEditMode(li, note);

      // Setup delete confirmation
      setupDeleteConfirmation(li, note);

      // Highlight if this is a new note
      if (highlightId && note.id === highlightId) {
        li.classList.add("note-highlight");
        setTimeout(() => li.classList.remove("note-highlight"), 2000);
      }

      noteList.appendChild(noteElement);
    });
  }

  /**
   * Format timestamp for display
   */
  function formatTimestamp(createdAt, updatedAt) {
    const date = new Date(updatedAt || createdAt);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    // Show relative time for recent notes
    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? "s" : ""} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;

    // Show full date for older notes
    const options = { month: "short", day: "numeric", year: date.getFullYear() !== now.getFullYear() ? "numeric" : undefined };
    let formatted = date.toLocaleDateString(undefined, options);

    // Add "edited" indicator if updated
    if (updatedAt && updatedAt !== createdAt) {
      formatted += " (edited)";
    }

    return formatted;
  }

  /**
   * Setup edit mode for a note item
   */
  function setupEditMode(noteElement, note) {
    const editInput = noteElement.querySelector(".note-edit-input");
    const saveBtn = noteElement.querySelector(".note-save-btn");
    const cancelBtn = noteElement.querySelector(".note-cancel-btn");

    if (!editInput || !saveBtn || !cancelBtn) return;

    // Save button handler
    saveBtn.addEventListener("click", async () => {
      const newText = editInput.value.trim();
      if (!newText) return;

      saveBtn.disabled = true;
      saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';

      try {
        await updateNote(note.id, newText);
        exitEditMode(noteElement);
      } catch (err) {
        // Error already handled in updateNote
      } finally {
        saveBtn.disabled = false;
        saveBtn.innerHTML = '<i class="fas fa-check"></i> Save';
      }
    });

    // Cancel button handler
    cancelBtn.addEventListener("click", () => {
      exitEditMode(noteElement);
    });

    // Enter key to save
    editInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        saveBtn.click();
      } else if (e.key === "Escape") {
        cancelBtn.click();
      }
    });
  }

  /**
   * Enter edit mode for a note
   */
  function handleEditClick(noteId) {
    const note = allNotes.find((n) => n.id === noteId);
    if (!note) return;

    const noteElement = document.querySelector(`.note-item[data-note-id="${noteId}"]`);
    if (!noteElement) return;

    const noteContent = noteElement.querySelector(".note-content");
    const noteActions = noteElement.querySelector(".note-actions");
    const editMode = noteElement.querySelector(".note-edit-mode");
    const editInput = noteElement.querySelector(".note-edit-input");

    // Show edit mode, hide view mode
    noteContent.style.display = "none";
    noteActions.style.display = "none";
    editMode.style.display = "block";

    // Set input value and focus
    editInput.value = note.text;
    editInput.focus();
    editInput.select();
  }

  /**
   * Exit edit mode
   */
  function exitEditMode(noteElement) {
    const noteContent = noteElement.querySelector(".note-content");
    const noteActions = noteElement.querySelector(".note-actions");
    const editMode = noteElement.querySelector(".note-edit-mode");

    // Show view mode, hide edit mode
    noteContent.style.display = "block";
    noteActions.style.display = "flex";
    editMode.style.display = "none";
  }

  /**
   * Handle delete button click - Show inline confirmation
   */
  function handleDeleteClick(noteId) {
    const noteElement = document.querySelector(`.note-item[data-note-id="${noteId}"]`);
    if (!noteElement) return;

    // Show inline delete confirmation
    showDeleteConfirmation(noteElement);
  }

  /**
   * Show inline delete confirmation (hides note content)
   */
  function showDeleteConfirmation(noteElement) {
    const noteContent = noteElement.querySelector(".note-content");
    const noteActions = noteElement.querySelector(".note-actions");
    const deleteConfirm = noteElement.querySelector(".note-delete-confirm");

    // Hide normal view
    noteContent.style.display = "none";
    noteActions.style.display = "none";

    // Show delete confirmation
    deleteConfirm.style.display = "block";
  }
  /* Hide inline delete confirmation (shows note content*/
  function hideDeleteConfirmation(noteElement) {
    const noteContent = noteElement.querySelector(".note-content");
    const noteActions = noteElement.querySelector(".note-actions");
    const deleteConfirm = noteElement.querySelector(".note-delete-confirm");
    // Show normal view
    noteContent.style.display = "block";
    noteActions.style.display = "flex";
    // Hide delete confirmation
    deleteConfirm.style.display = "none";
  }
  /* Setup delete confirmation buttons for a note item*/
  function setupDeleteConfirmation(noteElement, note) {
    const confirmBtn = noteElement.querySelector(".note-confirm-delete-btn");
    const cancelBtn = noteElement.querySelector(".note-cancel-delete-btn");

    if (!confirmBtn || !cancelBtn) return;
    // Confirm delete button handler
    confirmBtn.addEventListener("click", async () => {
      confirmBtn.disabled = true;
      confirmBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Deleting...';

      try {
        await deleteNote(note.id);
        // Note will be removed from DOM by deleteNote -> renderNotes
      } catch (err) {
        // Error already handled in deleteNote
        confirmBtn.disabled = false;
        confirmBtn.innerHTML = '<i class="fas fa-trash"></i> Delete';
      }
    });

    // Cancel delete button handler
    cancelBtn.addEventListener("click", () => {
      hideDeleteConfirmation(noteElement);
    });
  }
  // LOADING & ERROR STATES
  /*Show loading indicator*/
  function showLoading() {
    const noteList = document.getElementById("note-list");
    if (!noteList) return;

    // Add loading class to list
    noteList.classList.add("loading");
  }
  /* Hide loading indicator*/
  function hideLoading() {
    const noteList = document.getElementById("note-list");
    if (!noteList) return;

    noteList.classList.remove("loading");
  }
  /*Show error message*/
  function showError(message) {
    console.error("[Notes]", message);
    // You can add a toast notification here if you have one
  }
  // CHARACTER COUNTER
  /*Update character counter*/
  function updateCharCounter(input, counter) {
    const length = input.value.length;
    const maxLength = input.maxLength || 500;
    counter.innerHTML = `<small class="muted">${length} / ${maxLength} characters</small>`;

    // Warn if approaching limit
    if (length > maxLength * 0.9) {
      counter.classList.add("warn");
    } else {
      counter.classList.remove("warn");
    }
  }
  // INITIALIZATION
  /*Initialize notes functionality*/
  function init() {
    console.log("[Notes] Initializing...");

    const noteInput = document.getElementById("note-input");
    const addBtn = document.getElementById("add-note");
    const noteCounter = document.getElementById("note-counter");

    if (!noteInput || !addBtn) {
      console.warn("[Notes] Required elements not found");
      return;
    }

    // Setup character counter
    if (noteCounter) {
      updateCharCounter(noteInput, noteCounter);
      noteInput.addEventListener("input", () => updateCharCounter(noteInput, noteCounter));
    }
    // Add note button handler
    addBtn.addEventListener("click", async () => {
      const text = noteInput.value.trim();
      if (!text) return;

      if (text.length > 500) {
        showError("Note is too long (max 500 characters)");
        return;
      }
      // Disable button while creating
      addBtn.disabled = true;
      addBtn.textContent = "Adding...";

      try {
        await createNote(text);
        noteInput.value = "";
        if (noteCounter) updateCharCounter(noteInput, noteCounter);
      } catch (err) {
        // Error already handled
      } finally {
        addBtn.disabled = false;
        addBtn.textContent = "Add";
      }
    });
    // Enter key to add note
    noteInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        addBtn.click();
      }
    });

    // Fetch notes when auth is ready
    if (auth.currentUser) {
      console.log("[Notes] Auth ready, fetching notes...");
      fetchNotes();
    } else {
      // Wait for auth
      const unsubscribe = auth.onAuthStateChanged((user) => {
        if (user) {
          console.log("[Notes] Auth ready, fetching notes...");
          fetchNotes();
        }
        unsubscribe();
      });
    }
  }
  // Initialize
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
