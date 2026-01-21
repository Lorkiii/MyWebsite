import { apiFetch } from '../api-fetch.js';
import { db } from '../firebase-config.js';
import { collection, getDocs } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

let calendar = null;

// Initialize calendar when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
  initializeCalendar();
});

// Initialize FullCalendar with simple configuration
function initializeCalendar() {
  const calendarEl = document.getElementById('calendar');
  
  if (!calendarEl) {
    console.error('Calendar element not found');
    return;
  }

  calendar = new FullCalendar.Calendar(calendarEl, {
    initialView: 'dayGridMonth',
    headerToolbar: {
      left: 'prev,next today',
      center: 'title',
      right: 'dayGridMonth,dayGridWeek'
    },
    height: 'auto',
    events: fetchCalendarEvents,
    eventDisplay: 'block',
    displayEventTime: false,
    eventClick: function(info) {
      // Simple display of event details
      showEventDetails(info.event);
    }
  });

  calendar.render();
}

// Fetch all calendar events from different sources
async function fetchCalendarEvents(fetchInfo, successCallback, failureCallback) {
  try {
    const events = [];

    // Fetch announcements and news
    const announcementsData = await fetchAnnouncements();
    events.push(...announcementsData);

    // Fetch enrollment periods
    const enrollmentData = await fetchEnrollmentPeriods();
    events.push(...enrollmentData);

    // Fetch interview schedules
    const interviewData = await fetchInterviews();
    events.push(...interviewData);

    // Fetch demo teaching schedules
    const demoData = await fetchDemoSchedules();
    events.push(...demoData);

    successCallback(events);
  } catch (error) {
    console.error('Error fetching calendar events:', error);
    failureCallback(error);
  }
}

// Fetch announcements and news from API
async function fetchAnnouncements() {
  try {
    const response = await apiFetch('/api/announcements?includeArchived=false');
    
    if (!response.ok || !response.posts) {
      return [];
    }

    // Map announcements to calendar events
    return response.posts.map(post => {
      const isNews = post.type === 'news';
      return {
        id: `ann-${post.id}`,
        title: post.title,
        start: post.createdAt,
        allDay: true,
        backgroundColor: isNews ? '#3b82f6' : '#f59e0b', // Blue for news, amber for announcements
        borderColor: isNews ? '#2563eb' : '#d97706',
        textColor: '#ffffff',
        extendedProps: {
          type: isNews ? 'news' : 'announcement',
          body: post.body,
          category: post.category,
          createdBy: post.createdByName
        }
      };
    });
  } catch (error) {
    console.error('Error fetching announcements:', error);
    return [];
  }
}

// Fetch enrollment periods from API
async function fetchEnrollmentPeriods() {
  try {
    const response = await apiFetch('/api/enrollment/settings');
    
    if (!response) {
      return [];
    }

    const events = [];

    // Add JHS enrollment period
    if (response.jhs?.startDate && response.jhs?.endDate) {
      events.push({
        id: 'enroll-jhs',
        title: '📚 JHS Enrollment Period',
        start: response.jhs.startDate,
        end: addDays(response.jhs.endDate, 1), // Add 1 day for inclusive end date
        allDay: true,
        backgroundColor: '#8b5cf6',
        borderColor: '#7c3aed',
        textColor: '#ffffff',
        extendedProps: {
          type: 'enrollment',
          level: 'JHS'
        }
      });
    }

    // Add SHS enrollment period
    if (response.shs?.startDate && response.shs?.endDate) {
      events.push({
        id: 'enroll-shs',
        title: '🎓 SHS Enrollment Period',
        start: response.shs.startDate,
        end: addDays(response.shs.endDate, 1), // Add 1 day for inclusive end date
        allDay: true,
        backgroundColor: '#ec4899',
        borderColor: '#db2777',
        textColor: '#ffffff',
        extendedProps: {
          type: 'enrollment',
          level: 'SHS'
        }
      });
    }

    return events;
  } catch (error) {
    console.error('Error fetching enrollment periods:', error);
    return [];
  }
}

// Fetch interview schedules from Firestore
async function fetchInterviews() {
  try {
    if (!db) {
      console.warn('Firestore not initialized');
      return [];
    }

    // Fetch all teacher applicants from Firestore
    const querySnapshot = await getDocs(collection(db, 'teacherApplicants'));
    
    const interviews = [];
    
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      
      // Only include if interview is scheduled and has date/time
      if (data.interview && data.interview.date && data.interview.time) {
        const interviewDate = data.interview.date;
        const interviewTime = data.interview.time || '09:00';
        
        // Combine date and time
        const dateTimeStr = `${interviewDate}T${interviewTime}:00`;
        
        // Construct applicant name with proper fallback
        let applicantName = data.fullName || data.displayName;
        if (!applicantName && data.firstName && data.lastName) {
          const parts = [data.firstName, data.middleName, data.lastName].filter(Boolean);
          applicantName = parts.join(' ');
        }
        applicantName = applicantName || 'Applicant';
        
        interviews.push({
          id: `interview-${doc.id}`,
          title: `🎤 Interview: ${applicantName}`,
          start: dateTimeStr,
          allDay: false,
          backgroundColor: '#10b981',
          borderColor: '#059669',
          textColor: '#ffffff',
          extendedProps: {
            type: 'interview',
            applicantName: applicantName,
            applicantEmail: data.contactEmail || data.email,
            mode: data.interview.mode,
            location: data.interview.location,
            
          }
        });
      }
    });

    console.log(`[Calendar] Found ${interviews.length} scheduled interviews`);
    return interviews;
  } catch (error) {
    console.error('Error fetching interviews from Firestore:', error);
    return [];
  }
}

// Fetch demo teaching schedules from Firestore
async function fetchDemoSchedules() {
  try {
    if (!db) {
      console.warn('Firestore not initialized');
      return [];
    }

    // Fetch all teacher applicants from Firestore
    const querySnapshot = await getDocs(collection(db, 'teacherApplicants'));
    
    const demos = [];
    
    querySnapshot.forEach((doc) => {
      const data = doc.data();
      
      // Only include if demo teaching is scheduled and has date/time
      if (data.demoTeaching && data.demoTeaching.date && data.demoTeaching.time) {
        const demoDate = data.demoTeaching.date;
        const demoTime = data.demoTeaching.time || '10:00';
        
        // Combine date and time
        const dateTimeStr = `${demoDate}T${demoTime}:00`;
        
        // Construct applicant name with proper fallback
        let applicantName = data.fullName || data.displayName;
        if (!applicantName && data.firstName && data.lastName) {
          const parts = [data.firstName, data.middleName, data.lastName].filter(Boolean);
          applicantName = parts.join(' ');
        }
        applicantName = applicantName || 'Applicant';
        
        // Create title with applicant name and subject
        const subject = data.demoTeaching.subject ? ` - ${data.demoTeaching.subject}` : '';
        
        demos.push({
          id: `demo-${doc.id}`,
          title: `🎯 Demo: ${applicantName}${subject}`,
          start: dateTimeStr,
          allDay: false,
          backgroundColor: '#f97316',
          borderColor: '#ea580c',
          textColor: '#ffffff',
          extendedProps: {
            type: 'demo',
            applicantName: applicantName,
            applicantEmail: data.contactEmail || data.email,
            subject: data.demoTeaching.subject,
            mode: data.demoTeaching.mode,
            location: data.demoTeaching.location,
            scheduledBy: data.demoTeaching.scheduledBy,
          }
        });
      }
    });

    console.log(`[Calendar] Found ${demos.length} scheduled demo teachings`);
    return demos;
  } catch (error) {
    console.error('Error fetching demo schedules from Firestore:', error);
    return [];
  }
}

// Helper: Add days to a date string
function addDays(dateStr, days) {
  const date = new Date(dateStr);
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
}

// Show event details in modal
function showEventDetails(event) {
  const props = event.extendedProps;
  const modal = document.getElementById('calendar-event-modal');
  const titleElement = document.getElementById('calendar-event-title');
  const detailsElement = document.getElementById('calendar-event-details');

  // Set modal title
  titleElement.textContent = event.title;

  // Build details HTML based on event type
  let detailsHTML = '';

  if (props.type === 'announcement' || props.type === 'news') {
    detailsHTML = `
      <p><strong>Type:</strong> ${props.type.toUpperCase()}</p>
      <p><strong>Category:</strong> ${props.category || 'N/A'}</p>
      <p><strong>Posted by:</strong> ${props.createdBy || 'Admin'}</p>
      <p><strong>Date:</strong> ${formatDate(event.start)}</p>
      <hr style="margin: 15px 0; border: none; border-top: 1px solid #e5e5e5;">
      <p><strong>Content:</strong></p>
      <p style="white-space: pre-wrap;">${props.body || 'No content'}</p>
    `;
  } else if (props.type === 'enrollment') {
    detailsHTML = `
      <p><strong>Level:</strong> ${props.level}</p>
      <p><strong>Start Date:</strong> ${formatDate(event.start)}</p>
      <p><strong>End Date:</strong> ${formatDate(new Date(event.end.getTime() - 86400000))}</p>
    `;
  } else if (props.type === 'interview') {
    detailsHTML = `
      <p><strong>Applicant:</strong> ${props.applicantName || 'N/A'}</p>
      <p><strong>Email:</strong> ${props.applicantEmail || 'N/A'}</p>
      <p><strong>Date & Time:</strong> ${formatDateTime(event.start)}</p>
      ${props.mode ? `<p><strong>Mode:</strong> ${props.mode}</p>` : ''}
      ${props.location ? `<p><strong>Location:</strong> ${props.location}</p>` : ''}
      ${props.status ? `<p><strong>Status:</strong> ${props.status}</p>` : ''}
      ${props.notes ? `<hr style="margin: 15px 0; border: none; border-top: 1px solid #e5e5e5;"><p><strong>Notes:</strong></p><p style="white-space: pre-wrap;">${props.notes}</p>` : ''}
    `;
  } else if (props.type === 'demo') {
    detailsHTML = `
      <p><strong>Applicant:</strong> ${props.applicantName || 'N/A'}</p>
      <p><strong>Email:</strong> ${props.applicantEmail || 'N/A'}</p>
      ${props.subject ? `<p><strong>Subject:</strong> ${props.subject}</p>` : ''}
      <p><strong>Date & Time:</strong> ${formatDateTime(event.start)}</p>
      ${props.mode ? `<p><strong>Mode:</strong> ${props.mode}</p>` : ''}
      ${props.location ? `<p><strong>Location:</strong> ${props.location}</p>` : ''}
      ${props.scheduledBy ? `<p><strong>Scheduled by:</strong> ${props.scheduledBy}</p>` : ''}
      ${props.status ? `<p><strong>Status:</strong> ${props.status}</p>` : ''}
      ${props.notes ? `<hr style="margin: 15px 0; border: none; border-top: 1px solid #e5e5e5;"><p><strong>Notes:</strong></p><p style="white-space: pre-wrap;">${props.notes}</p>` : ''}
    `;
  }

  // Set details and show modal
  detailsElement.innerHTML = detailsHTML;
  modal.style.display = 'flex';
}

// Close calendar event modal
window.closeCalendarEventModal = function() {
  const modal = document.getElementById('calendar-event-modal');
  modal.style.display = 'none';
}

// Close modal when clicking outside
document.addEventListener('click', function(e) {
  const modal = document.getElementById('calendar-event-modal');
  if (e.target === modal) {
    closeCalendarEventModal();
  }
});

// Format date for display
function formatDate(date) {
  if (!date) return 'N/A';
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

// Format date and time for display
function formatDateTime(date) {
  if (!date) return 'N/A';
  return new Date(date).toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}