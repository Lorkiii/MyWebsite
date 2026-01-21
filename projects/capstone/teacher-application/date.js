  // date widget
  (function () {
    // Node selectors (matches your HTML classes)
    const dateEl = document.querySelector(".datetime-widget .current-date");
    const timeEl = document.querySelector(".datetime-widget .current-time");

    // Use Manila timezone explicitly
    const TIMEZONE = "Asia/Manila";

    // Formatting options
    const dateOptions = {
      timeZone: TIMEZONE,
      year: "numeric",
      month: "long",
      day: "numeric",
    };

    const timeOptions = {
      timeZone: TIMEZONE,
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    };

    function updateDateTime() {
      const now = new Date();

      if (dateEl) {
        dateEl.textContent = now.toLocaleDateString(
          navigator.language || "en-US",
          dateOptions
        );
      }

      if (timeEl) {
        timeEl.textContent = now.toLocaleTimeString(
          navigator.language || "en-US",
          timeOptions
        );
      }
    }
    // Initialize and schedule updates
    updateDateTime();
    // Update every 1 second so the minute flips exactly on time.
    setInterval(updateDateTime, 1000);
  })();