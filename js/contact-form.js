// Self-contained contact form for Ogen. Injects the form, loads intl-tel-input
// from CDN, and AJAX-submits to Formspree. Drop <div id="contact-form-mount"></div>
// on any page and include this script.
//
// Language is detected from <html lang>: 'en' -> English, anything else -> Hebrew.
//
// SETUP: create a free form at https://formspree.io, then replace FORM_ID below
// with your form's ID (the part after /f/ in its endpoint URL).

(function() {
  const ITI = 'https://cdn.jsdelivr.net/npm/intl-tel-input@23.8.0';
  const FORM_ID = 'YOUR_FORM_ID'; // <-- replace with your Formspree form ID
  const FORMSPREE_URL = `https://formspree.io/f/${FORM_ID}`;

  const mount = document.getElementById('contact-form-mount');
  if (!mount) return;

  const isEn = (document.documentElement.lang || '').toLowerCase().startsWith('en');
  const nextUrl = isEn ? '/en/confirmation' : '/confirmation';

  const t = isEn
    ? {
        firstName: 'First name', lastName: 'Last name',
        email: 'Email *', phone: 'Phone', message: 'Message *',
        submit: 'Send',
        success: '✓ Message sent successfully! We\'ll be in touch soon.',
        error: 'Something went wrong. Please try again.'
      }
    : {
        firstName: 'שם פרטי', lastName: 'שם משפחה',
        email: 'אימייל *', phone: 'טלפון', message: 'הודעה *',
        submit: 'שלחו',
        success: '✓ ההודעה נשלחה בהצלחה! נחזור אליכם בקרוב.',
        error: 'שגיאה בשליחה. אנא נסו שוב.'
      };

  // Append intl-tel-input CSS once.
  if (!document.querySelector('link[data-iti]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `${ITI}/build/css/intlTelInput.css`;
    link.dataset.iti = '1';
    document.head.appendChild(link);
  }

  mount.innerHTML = `
    <form id="contact-form" action="${FORMSPREE_URL}" method="POST">
      <input type="hidden" name="_next" value="${nextUrl}">
      <input type="hidden" name="_subject" value="">
      <div class="form-row">
        <div class="form-field"><input type="text" name="first_name" placeholder="${t.firstName}"></div>
        <div class="form-field"><input type="text" name="last_name" placeholder="${t.lastName}"></div>
      </div>
      <div class="form-row">
        <div class="form-field"><input type="email" name="email" placeholder="${t.email}" required></div>
        <div class="form-field"><input type="tel" name="phone" id="contact-phone" placeholder="${t.phone}"></div>
      </div>
      <div class="form-row">
        <div class="form-field"><textarea name="message" placeholder="${t.message}" required></textarea></div>
      </div>
      <button type="submit" class="btn-primary form-submit">${t.submit}</button>
    </form>
    <div id="form-success" style="display:none; margin-top:20px; padding:16px 20px; background:#eef1e8; border-radius:8px; color:#4a5a3a; font-size:15px; text-align:center;">${t.success}</div>
    <div id="form-error" style="display:none; margin-top:20px; padding:16px 20px; background:#fdf0ee; border-radius:8px; color:#a03020; font-size:15px; text-align:center;">${t.error}</div>
  `;

  // Lazy-load intl-tel-input then wire everything up.
  const script = document.createElement('script');
  script.src = `${ITI}/build/js/intlTelInput.min.js`;
  script.onload = init;
  document.head.appendChild(script);

  function init() {
    const phoneInput = document.getElementById('contact-phone');
    const iti = window.intlTelInput(phoneInput, {
      initialCountry: 'cy',
      preferredCountries: ['cy', 'il', 'gb', 'us'],
      utilsScript: `${ITI}/build/js/utils.js`
    });

    const form = document.getElementById('contact-form');
    const successEl = document.getElementById('form-success');
    const errorEl = document.getElementById('form-error');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.style.opacity = '0.6';
      successEl.style.display = 'none';
      errorEl.style.display = 'none';

      // Replace local-format phone with full international format before sending.
      if (phoneInput.value.trim()) phoneInput.value = iti.getNumber();

      // Per-submission subject so email threads don't collapse into one.
      const first = form.elements.first_name.value.trim();
      const last = form.elements.last_name.value.trim();
      const email = form.elements.email.value.trim();
      const ident = [first, last].filter(Boolean).join(' ') || email || 'unknown';
      form.elements._subject.value = `Ogen — new contact from ${ident}`;

      try {
        const res = await fetch(FORMSPREE_URL, {
          method: 'POST',
          body: new FormData(form),
          headers: { Accept: 'application/json' }
        });
        if (res.ok) {
          form.reset();
          form.style.display = 'none';
          successEl.style.display = 'block';
        } else {
          errorEl.style.display = 'block';
          btn.disabled = false;
          btn.style.opacity = '1';
        }
      } catch (err) {
        errorEl.style.display = 'block';
        btn.disabled = false;
        btn.style.opacity = '1';
      }
    });
  }
})();
