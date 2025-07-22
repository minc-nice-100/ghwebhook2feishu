// api/github-webhook.js
import crypto from 'crypto';
import axios from 'axios';

export default async (req, res) => {
  try {
    // 1. Get raw request body
    const rawBody = await getRawBody(req);
    const payload = JSON.parse(rawBody);
    
    // 2. Verify GitHub signature
    const githubSignature = req.headers['x-hub-signature-256'] || '';
    if (process.env.GITHUB_WEBHOOK_SECRET) {
      const expectedSignature = 'sha256=' + 
        crypto.createHmac('sha256', process.env.GITHUB_WEBHOOK_SECRET)
          .update(rawBody)
          .digest('hex');
      
      if (githubSignature !== expectedSignature) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    // 3. Process workflow_job events
    const eventType = req.headers['x-github-event'];
    if (eventType === "workflow_job" && payload.action === "completed") {
      const job = payload.workflow_job;
      const repo = payload.repository.full_name;
      
      // 4. Build Feishu message
      const message = {
        msg_type: "interactive",
        card: {
          header: {
            title: {
              tag: "plain_text",
              content: `Job ${job.conclusion.toUpperCase()}: ${repo}`
            },
            template: job.conclusion === "success" ? "green" : "red"
          },
          elements: [
            {
              tag: "div",
              text: {
                tag: "lark_md",
                content: 
                  `**Workflow**: ${job.workflow_name}\n` +
                  `**Job**: ${job.name}\n` +
                  `**Status**: ${job.conclusion}\n` +
                  `**Branch**: ${job.head_branch}\n` +
                  `**Duration**: ${Math.round(job.completed_at - job.started_at)}s`
              }
            },
            {
              tag: "action",
              actions: [{
                tag: "button",
                text: { tag: "plain_text", content: "View Logs" },
                url: job.html_url,
                type: "primary"
              }]
            }
          ]
        }
      };

      // 5. Add Feishu signature if configured
      if (process.env.FEISHU_SECRET) {
        const timestamp = Math.floor(Date.now() / 1000).toString();
        message.timestamp = timestamp;
        message.sign = generateFeishuSignature(process.env.FEISHU_SECRET, timestamp);
      }

      // 6. Send to Feishu
      await axios.post(process.env.FEISHU_WEBHOOK_URL, message);
      return res.status(200).json({ success: true });
    }
    
    res.status(200).json({ message: 'Event ignored' });
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ 
      error: 'Server error',
      details: error.message 
    });
  }
};

// Helper function to get raw body
function getRawBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => resolve(data));
  });
}

// Generate Feishu signature
function generateFeishuSignature(secret, timestamp) {
  const stringToSign = `${timestamp}\n${secret}`;
  return crypto.createHmac('sha256', stringToSign)
    .digest('base64');
}
