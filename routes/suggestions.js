const router = require('express').Router();
const OpenAI = require('openai');
const sgMail = require('@sendgrid/mail');
const { pool } = require('../config/database');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// GET / — render the suggestions page
router.get('/', (req, res) => {
  res.render('suggestions', {
    user: req.session,
    isAdmin: req.session.role === 'admin',
    impersonating: null
  });
});

// POST /generate — polish user text into a professional email body via OpenAI
router.post('/generate', async (req, res) => {
  const { text } = req.body;

  if (!text || !text.trim()) {
    return res.status(400).json({ error: 'Please provide some suggestion text.' });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'You are an email writing assistant. The user has a suggestion or feedback for the docs.HawaiiData.ai platform. Polish their input into a clear, professional email body. Keep their intent and details intact. Do not add a greeting or sign-off — just the body paragraphs.'
        },
        {
          role: 'user',
          content: text.trim()
        }
      ],
      max_tokens: 600
    });

    const polishedBody = completion.choices[0].message.content.trim();

    // Generate a subject line from the suggestion text
    const subjectCompletion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'system',
          content: 'Generate a concise, professional email subject line (under 10 words) for the following suggestion or feedback about the docs.HawaiiData.ai platform. Return only the subject line text, nothing else.'
        },
        {
          role: 'user',
          content: text.trim()
        }
      ],
      max_tokens: 30
    });

    const subject = subjectCompletion.choices[0].message.content.trim().replace(/^["']|["']$/g, '');

    // Track token usage
    const totalTokens = (completion.usage?.total_tokens || 0) + (subjectCompletion.usage?.total_tokens || 0);
    if (totalTokens > 0) {
      pool.query(
        `INSERT INTO token_usage (tenant_id, user_id, action, model, prompt_tokens, completion_tokens, total_tokens)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [req.session.tenantId, req.session.userId, 'suggestion_polish', 'gpt-4o',
         (completion.usage?.prompt_tokens || 0) + (subjectCompletion.usage?.prompt_tokens || 0),
         (completion.usage?.completion_tokens || 0) + (subjectCompletion.usage?.completion_tokens || 0),
         totalTokens]
      ).catch(() => {});
    }

    res.json({ subject, body: polishedBody });
  } catch (err) {
    console.error('Suggestions generate error:', err);
    res.status(500).json({ error: 'Failed to generate email. Please try again.' });
  }
});

// POST /send — send the polished email via SendGrid
router.post('/send', async (req, res) => {
  const { subject, body } = req.body;

  if (!subject || !body) {
    return res.status(400).json({ error: 'Subject and body are required.' });
  }

  const senderName = req.session.fullName || req.session.name || req.session.email || 'A platform user';
  const senderEmail = req.session.email || 'unknown';

  const htmlContent = `
    <div style="font-family: Arial, sans-serif; max-width: 680px; margin: 0 auto; color: #1a1a2e;">
      <h2 style="color: #1e40af; border-bottom: 2px solid #f97316; padding-bottom: 8px;">
        Platform Suggestion — docs.HawaiiData.ai
      </h2>
      <p style="color: #555; font-size: 14px; margin-bottom: 20px;">
        Submitted by: <strong>${senderName}</strong> &lt;${senderEmail}&gt;
      </p>
      <div style="background: #f8fafc; border-left: 4px solid #3b82f6; padding: 16px 20px; border-radius: 4px; margin-bottom: 24px;">
        ${body.split('\n').map(p => p.trim() ? `<p style="color: #334155; margin: 0 0 12px;">${p}</p>` : '').join('')}
      </div>
      <p style="color: #999; font-size: 12px; margin-top: 24px;">
        This suggestion was submitted via the docs.HawaiiData.ai platform.
      </p>
    </div>
  `;

  try {
    await sgMail.send({
      to: 'anakaoka@trinet-hi.com',
      from: 'docs@hawaiidata.ai',
      replyTo: senderEmail,
      subject: subject,
      html: htmlContent,
      text: `Platform Suggestion from ${senderName} <${senderEmail}>\n\n${body}`
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Suggestions send error:', err);
    res.status(500).json({ error: 'Failed to send email. Please try again.' });
  }
});

module.exports = router;
