// /login/verify-otp.js

const DEFAULT_COOLDOWN = 180; // seconds

document.addEventListener('DOMContentLoaded', () => {
  const verifyEmailSpan = document.getElementById('verify-email');
  const resendLink = document.querySelector('.resend-link');
  const countdownSpan = document.getElementById('countdown');

  const otpForm = document.getElementById('otp-form');
  const otpInput = document.getElementById('otp');
  const otpError = document.getElementById('otp-error');
  const verifyBtn = document.getElementById('verify-btn');

  // read stored session info
  const idToken = sessionStorage.getItem('idToken');
  const verifyEmail = sessionStorage.getItem('verifyEmail');

  // show email in UI
  if (verifyEmail && verifyEmailSpan) {
    verifyEmailSpan.textContent = verifyEmail;
  }

  if (!idToken && !verifyEmail) {
    // no context -> redirect to login
    window.location.replace('/login/login.html');
    return;
  }

  // countdown management
  let countdownTimer = null;
  function startCountdown(seconds) {
    let remaining = Math.max(Math.floor(seconds), 0);
    if (countdownSpan) {
      countdownSpan.style.display = 'inline';
      countdownSpan.textContent = `You can resend the code in ${formatSeconds(remaining)}`;
    }
    if (resendLink) resendLink.classList.add('disabled');
    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = setInterval(() => {
      remaining -= 1;
      if (countdownSpan) {
        if (remaining > 0) countdownSpan.textContent = `You can resend the code in ${formatSeconds(remaining)}`;
        else {
          clearInterval(countdownTimer);
          countdownTimer = null;
          if (countdownSpan) countdownSpan.style.display = 'none';
          if (resendLink) resendLink.classList.remove('disabled');
        }
      }
    }, 1000);
  }

  function formatSeconds(sec) {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  if (countdownSpan) countdownSpan.style.display = 'none';

  // Resend handler
  async function handleResend(e) {
    e && e.preventDefault();
    if (!resendLink || resendLink.classList.contains('disabled')) return;
    if (resendLink) resendLink.classList.add('disabled');
    if (countdownSpan) {
      countdownSpan.style.display = 'inline';
      countdownSpan.textContent = 'Sending...';
    }

    try {
      const body = idToken ? { idToken } : { email: verifyEmail };
      const resp = await fetch('/auth/resend-otp', {
        method: 'POST',
        credentials: 'include', // include cookie so server can read session if needed
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (resp.status === 429) {
        const json = await resp.json().catch(() => ({}));
        const retryAfter = json && json.retryAfter ? Number(json.retryAfter) : DEFAULT_COOLDOWN;
        if (countdownSpan) countdownSpan.textContent = `Please wait ${formatSeconds(retryAfter)} before resending.`;
        startCountdown(retryAfter);
        return;
      }

      const data = await resp.json().catch(() => ({}));
      const nextAllowed = data && (data.nextAllowedIn || DEFAULT_COOLDOWN);

      if (!resp.ok && !data.ok) {
        const msg = (data && (data.error || data.message)) || 'Failed to resend OTP.';
        if (countdownSpan) countdownSpan.textContent = msg;
        startCountdown(nextAllowed);
        return;
      }

      if (data && data.ok && data.emailed) {
        if (countdownSpan) countdownSpan.textContent = data.message || 'OTP resent. Check your email.';
        startCountdown(nextAllowed);
      } else {
        const msg = (data && data.message) || 'Failed to send OTP. Please try logging in again.';
        if (countdownSpan) countdownSpan.textContent = msg;
        startCountdown(nextAllowed);
      }

    } catch (err) {
      console.error('resend error', err);
      if (countdownSpan) countdownSpan.textContent = 'Network error. Try again later.';
      startCountdown(DEFAULT_COOLDOWN);
    }
  }

  if (resendLink) {
    resendLink.addEventListener('click', handleResend);
  }

  // OTP verify submit
  if (otpForm) {
    otpForm.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (!otpInput) return;
      const code = otpInput.value.trim();
      if (otpError) otpError.textContent = '';
      if (!code) {
        if (otpError) otpError.textContent = 'Please enter the 6-digit code.';
        return;
      }

      // disable verify button and show text-only "Verifying..."
      verifyBtn.disabled = true;
      const origText = verifyBtn.textContent;
      verifyBtn.textContent = 'Verifying...';

      try {
        const resp = await fetch('/auth/verify-otp', {
          method: 'POST',
          credentials: 'include', // <-- ensure cookie is set/received
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ otp: code, idToken, email: verifyEmail })
        });

        const body = await resp.json().catch(() => ({}));
        if (!resp.ok) {
          if (otpError) otpError.textContent = body && (body.error || body.message) ? (body.error || body.message) : 'Verification failed.';
          verifyBtn.disabled = false;
          verifyBtn.textContent = origText;
          return;
        }

        // success: server returns { ok:true, token?, role, forcePasswordChange? }
        // Clear temporary sessionStorage keys used for verification
        try { sessionStorage.removeItem('idToken'); sessionStorage.removeItem('verifyEmail'); } catch (e) {}

        // Optionally store server token (if returned) — useful for API calls that use Authorization header.
        // The main auth mechanism is the HttpOnly __session cookie the server set.
        if (body && body.token) {
          try { sessionStorage.setItem('serverToken', body.token); } catch (e) { /* ignore */ }
        }

        // Check if user must change password on first login (security measure)
        if (body && body.forcePasswordChange) {
          // Extract uid from URL params
          const urlParams = new URLSearchParams(window.location.search);
          const uid = urlParams.get('uid');
          if (uid) {
            window.location.replace(`/login/changepass.html?uid=${encodeURIComponent(uid)}`);
            return;
          }
        }

        // Redirect: role-aware. If the server provided role, use it; else default to admin redirect.
        const role = body && body.role ? body.role : 'admin';
        if (role === 'admin') window.location.replace('/adminportal/admin.html');
        else window.location.replace('/teacher-application/teacher.html');

      } catch (err) {
        console.error('verify-otp network error', err);
        if (otpError) otpError.textContent = 'Network error. Try again later.';
        verifyBtn.disabled = false;
        verifyBtn.textContent = origText;
      }
    });
  }
});
