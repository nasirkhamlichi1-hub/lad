'use strict';

// Email templates for transactional LAD CLPD notifications.
// Each builder returns { subject, html, text }. Keep them self-contained and
// dependency-free — they receive plain data and never touch the DB.
//
// House style: clean, government-formal, single accent colour, no external
// images or scripts (deliverability + the API CSP). All dynamic values are
// HTML-escaped via esc() before interpolation.

const BRAND = 'Dubai Legal Affairs Department · CLPD';
const ACCENT = '#0b5c4f';
const SITE = process.env.PUBLIC_SITE_URL || 'https://legalaffairstraining.com';

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Shared shell. `intro` is a short lead line, `rows` is an array of
// {label, value} detail pairs, `note` is an optional closing paragraph.
function layout({ heading, greeting, intro, rows, note, ctaLabel, ctaUrl }) {
  const detailRows = (rows || [])
    .filter((r) => r && r.value != null && r.value !== '')
    .map((r) => `<tr>
      <td style="padding:6px 16px 6px 0;color:#5b6770;font-size:13px;white-space:nowrap;vertical-align:top">${esc(r.label)}</td>
      <td style="padding:6px 0;color:#1a2228;font-size:14px;font-weight:600">${esc(r.value)}</td>
    </tr>`).join('');

  const cta = ctaUrl ? `<tr><td style="padding:24px 0 4px">
      <a href="${esc(ctaUrl)}" style="display:inline-block;background:${ACCENT};color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:11px 22px;border-radius:8px">${esc(ctaLabel || 'View details')}</a>
    </td></tr>` : '';

  const html = `<!doctype html><html><body style="margin:0;background:#eef1f0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef1f0;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e1e6e4">
        <tr><td style="background:${ACCENT};padding:18px 28px">
          <div style="color:#cfe7e0;font-size:11px;letter-spacing:1.5px;text-transform:uppercase">${esc(BRAND)}</div>
        </td></tr>
        <tr><td style="padding:28px 28px 8px">
          <h1 style="margin:0 0 12px;color:#10241e;font-size:20px;font-weight:700">${esc(heading)}</h1>
          ${greeting ? `<p style="margin:0 0 10px;color:#33414a;font-size:15px">${esc(greeting)}</p>` : ''}
          ${intro ? `<p style="margin:0 0 4px;color:#33414a;font-size:15px;line-height:1.5">${esc(intro)}</p>` : ''}
        </td></tr>
        <tr><td style="padding:6px 28px 4px">
          <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-top:1px solid #eef1f0;border-bottom:1px solid #eef1f0;margin:6px 0">${detailRows}</table>
          ${note ? `<p style="margin:14px 0 0;color:#5b6770;font-size:13px;line-height:1.5">${esc(note)}</p>` : ''}
          ${cta}
        </td></tr>
        <tr><td style="padding:22px 28px 26px">
          <p style="margin:0;color:#9aa6ac;font-size:12px;line-height:1.5">This is an automated message from the LAD Continuing Legal Professional Development platform. Please do not reply to this email.</p>
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;

  // Plain-text fallback
  const textRows = (rows || [])
    .filter((r) => r && r.value != null && r.value !== '')
    .map((r) => `  ${r.label}: ${r.value}`).join('\n');
  const text = [
    BRAND, '', heading, '',
    greeting || '', intro || '', '',
    textRows, '',
    note || '',
    ctaUrl ? `\n${ctaLabel || 'View details'}: ${ctaUrl}` : '',
    '', 'This is an automated message — please do not reply.',
  ].filter((l) => l !== undefined).join('\n');

  return { html, text };
}

const fullName = (first, last) => `${first || ''} ${last || ''}`.trim();

module.exports = {
  bookingConfirmation({ name, courseTitle, sessionWhen, venue, language, credits, balance }) {
    const { html, text } = layout({
      heading: 'Booking confirmed',
      greeting: name ? `Dear ${name},` : 'Hello,',
      intro: `Your place on “${courseTitle}” is confirmed. The details are below.`,
      rows: [
        { label: 'Course', value: courseTitle },
        { label: 'When', value: sessionWhen },
        { label: 'Venue', value: venue },
        { label: 'Language', value: language },
        { label: 'Credits used', value: credits != null ? String(credits) : null },
        { label: 'Credit balance', value: balance != null ? String(balance) : null },
      ],
      note: 'You can view or cancel this booking from your CLPD portal. Cancellations within the allowed window are refunded to your credit balance.',
      ctaLabel: 'Open my portal', ctaUrl: SITE,
    });
    return { subject: `Booking confirmed — ${courseTitle}`, html, text };
  },

  bookingCancellation({ name, courseTitle, refundCredits, balance }) {
    const { html, text } = layout({
      heading: 'Booking cancelled',
      greeting: name ? `Dear ${name},` : 'Hello,',
      intro: `Your booking for “${courseTitle}” has been cancelled.`,
      rows: [
        { label: 'Course', value: courseTitle },
        { label: 'Credits refunded', value: refundCredits ? String(refundCredits) : null },
        { label: 'Credit balance', value: balance != null ? String(balance) : null },
      ],
      note: refundCredits ? 'The credits have been returned to your balance and can be used for another course.' : 'No credits were charged for this booking.',
      ctaLabel: 'Browse courses', ctaUrl: SITE,
    });
    return { subject: `Booking cancelled — ${courseTitle}`, html, text };
  },

  creditPurchase({ name, credits, aed, balance, reference, scope }) {
    const { html, text } = layout({
      heading: 'Payment received',
      greeting: name ? `Dear ${name},` : 'Hello,',
      intro: `Thank you — your purchase of ${credits} CLPD credit${credits === 1 ? '' : 's'} has been processed${scope === 'firm' ? ' into your firm pool' : ''}.`,
      rows: [
        { label: 'Credits', value: String(credits) },
        { label: 'Amount', value: `AED ${Number(aed).toLocaleString('en-AE')}` },
        { label: 'Reference', value: reference },
        { label: scope === 'firm' ? 'Firm pool balance' : 'New balance', value: balance != null ? String(balance) : null },
      ],
      note: 'This receipt is for your records. Credits can be used to book accredited and mandatory CLPD courses.',
      ctaLabel: 'View wallet', ctaUrl: SITE,
    });
    return { subject: `Receipt — ${credits} CLPD credit${credits === 1 ? '' : 's'} (AED ${Number(aed).toLocaleString('en-AE')})`, html, text };
  },

  accreditationSubmitted({ contactName, providerName, courseTitle, ref }) {
    const { html, text } = layout({
      heading: 'Accreditation application received',
      greeting: contactName ? `Dear ${contactName},` : 'Hello,',
      intro: 'Thank you for your submission to the LAD CLPD accreditation programme. It has entered the review queue and a reviewer will assess it shortly.',
      rows: [
        { label: 'Reference', value: ref },
        { label: 'Provider', value: providerName },
        { label: 'Course', value: courseTitle },
        { label: 'Status', value: 'Under review' },
      ],
      note: 'You can track the status of this application from the provider portal. We will email you again once a decision has been made.',
      ctaLabel: 'Track application', ctaUrl: SITE,
    });
    return { subject: `Application received — ${ref}`, html, text };
  },

  accreditationDecision({ contactName, ref, status, courseTitle, providerName, points, code }) {
    const approved = status === 'approved';
    const returned = status === 'returned';
    const heading = approved ? 'Accreditation approved' : returned ? 'Accreditation returned for revision' : 'Accreditation decision';
    const intro = approved
      ? `Congratulations — your application “${courseTitle || ref}” has been approved.`
      : returned
        ? `Your application “${courseTitle || ref}” has been returned. Please review the reviewer’s notes and resubmit.`
        : `A decision has been made on your application “${courseTitle || ref}”.`;
    const { html, text } = layout({
      heading,
      greeting: contactName ? `Dear ${contactName},` : 'Hello,',
      intro,
      rows: [
        { label: 'Reference', value: ref },
        { label: 'Provider', value: providerName },
        { label: 'Course', value: courseTitle },
        { label: 'Decision', value: (status || '').charAt(0).toUpperCase() + (status || '').slice(1) },
        approved ? { label: 'Accreditation code', value: code } : null,
        approved && points != null ? { label: 'CPD points', value: String(points) } : null,
      ].filter(Boolean),
      note: approved ? 'Your accredited course is now active and can be offered to lawyers on the platform.' : undefined,
      ctaLabel: 'Open provider portal', ctaUrl: SITE,
    });
    return { subject: `Accreditation ${status} — ${ref}`, html, text };
  },

  pointsAwarded({ name, points, courseTitle, provider }) {
    const { html, text } = layout({
      heading: 'CPD points awarded',
      greeting: name ? `Dear ${name},` : 'Hello,',
      intro: `${points} CPD point${points === 1 ? '' : 's'} ha${points === 1 ? 's' : 've'} been added to your CLPD record for attending an accredited session.`,
      rows: [
        { label: 'Course', value: courseTitle },
        { label: 'Provider', value: provider },
        { label: 'Points awarded', value: String(points) },
      ],
      note: 'Your updated points balance is visible in your CLPD portal.',
      ctaLabel: 'View my record', ctaUrl: SITE,
    });
    return { subject: `${points} CPD point${points === 1 ? '' : 's'} added to your record`, html, text };
  },

  fullName,
};
