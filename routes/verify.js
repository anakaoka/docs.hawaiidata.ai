const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const sgMail = require('@sendgrid/mail');
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { success: false, message: 'Too many verification attempts. Please try again later.' }
});

// Send verification code
router.post('/send', verifyLimiter, async (req, res) => {
  let { phone } = req.body;

  if (!phone) {
    return res.json({ success: false, message: 'Phone number is required' });
  }

  // Normalize: strip non-digits, add +1 for US 10-digit numbers
  let digits = phone.replace(/\D/g, '');
  if (digits.length === 10) digits = '1' + digits;
  phone = '+' + digits;

  try {
    const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

    const verification = await twilio.verify.v2
      .services(process.env.TWILIO_VERIFY_SERVICE_SID)
      .verifications.create({ to: phone, channel: 'sms' });

    // Notify admin
    sgMail.send({
      to: 'anakaoka@trinet-hi.com',
      from: 'docs@hawaiidata.ai',
      subject: '2FA Demo Used — ' + phone,
      html: `<div style="font-family:sans-serif;max-width:500px;margin:0 auto;background:#0b0f1a;color:#d1d5db;padding:30px;border-radius:12px;">
        <div style="margin-bottom:16px;"><span style="font-size:18px;font-weight:700;color:#fff;"><span style="color:#f97316;font-weight:800;">docs.</span>HawaiiData.ai</span></div>
        <p style="color:#fff;font-size:15px;">A verification code was sent to:</p>
        <p style="color:#f97316;font-size:20px;font-weight:700;">${phone}</p>
        <p style="color:#9ca3af;font-size:13px;">Time: ${new Date().toLocaleString('en-US', { timeZone: 'Pacific/Honolulu' })} HST</p>
      </div>`
    }).catch(err => console.error('SendGrid notify error:', err));

    res.json({ success: true, status: verification.status });
  } catch (err) {
    console.error('Twilio send error:', err);
    res.json({ success: false, message: 'Failed to send verification code. Please check the phone number and try again.' });
  }
});

// Check verification code
router.post('/check', verifyLimiter, async (req, res) => {
  let { phone, code } = req.body;

  if (!phone || !code) {
    return res.json({ success: false, message: 'Phone and code are required' });
  }

  // Normalize phone
  let digits = phone.replace(/\D/g, '');
  if (digits.length === 10) digits = '1' + digits;
  phone = '+' + digits;

  try {
    const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

    const check = await twilio.verify.v2
      .services(process.env.TWILIO_VERIFY_SERVICE_SID)
      .verificationChecks.create({ to: phone, code });

    if (check.status === 'approved') {
      res.json({ success: true, status: 'approved' });
    } else {
      res.json({ success: false, message: 'Invalid or expired code. Please try again.' });
    }
  } catch (err) {
    console.error('Twilio check error:', err);
    res.json({ success: false, message: 'Verification failed. Please try again.' });
  }
});

module.exports = router;
