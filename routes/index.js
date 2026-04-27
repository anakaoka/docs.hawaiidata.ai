const router = require('express').Router();
const sgMail = require('@sendgrid/mail');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

router.get('/', (req, res) => {
  res.render('index', { user: req.session.userId ? req.session : null });
});

// Redirect old public 2FA demo URL to authenticated version
router.get('/verify-demo', (req, res) => {
  res.redirect('/dashboard/verify-demo');
});

router.get('/request-access', (req, res) => {
  res.render('request-access', { user: req.session.userId ? req.session : null, message: null, error: null });
});

router.post('/request-access', async (req, res) => {
  const { full_name, email, phone, address, company } = req.body;

  if (!full_name || !email || !company) {
    return res.render('request-access', {
      user: req.session.userId ? req.session : null,
      message: null,
      error: 'Please fill in all required fields.'
    });
  }

  try {
    await sgMail.send({
      to: 'anakaoka@trinet-hi.com',
      from: 'docs@hawaiidata.ai',
      subject: `Access Request: ${company} — ${full_name}`,
      html: `
        <div style="font-family: 'Inter', -apple-system, sans-serif; max-width: 600px; margin: 0 auto; background: #0b0f1a; color: #d1d5db; padding: 40px; border-radius: 12px;">
          <div style="margin-bottom: 24px;">
            <span style="font-size: 20px; font-weight: 700; color: #ffffff;">(<span style="color: #f97316;">docs</span>)HawaiiData.ai</span>
          </div>
          <h2 style="color: #ffffff; margin-bottom: 16px;">New Access Request</h2>
          <div style="background: #111827; border: 1px solid #1f2937; border-radius: 8px; padding: 20px; margin-bottom: 16px;">
            <p style="margin: 0 0 10px;"><strong style="color: #9ca3af;">Name:</strong> <span style="color: #fff;">${full_name}</span></p>
            <p style="margin: 0 0 10px;"><strong style="color: #9ca3af;">Email:</strong> <span style="color: #fff;">${email}</span></p>
            <p style="margin: 0 0 10px;"><strong style="color: #9ca3af;">Phone:</strong> <span style="color: #fff;">${phone || '—'}</span></p>
            <p style="margin: 0 0 10px;"><strong style="color: #9ca3af;">Address:</strong> <span style="color: #fff;">${address || '—'}</span></p>
            <p style="margin: 0;"><strong style="color: #9ca3af;">Company:</strong> <span style="color: #fff;">${company}</span></p>
          </div>
          <p style="font-size: 12px; color: #6b7280;">Sent from docs.hawaiidata.ai access request form</p>
        </div>
      `
    });

    res.render('request-access', {
      user: req.session.userId ? req.session : null,
      message: 'Your request has been submitted! We\'ll be in touch soon.',
      error: null
    });
  } catch (err) {
    console.error('Access request email error:', err);
    res.render('request-access', {
      user: req.session.userId ? req.session : null,
      message: null,
      error: 'Something went wrong. Please try again or email anakaoka@trinet-hi.com directly.'
    });
  }
});

module.exports = router;
