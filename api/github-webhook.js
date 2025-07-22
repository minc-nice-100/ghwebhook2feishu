// api/github-webhook.js
import crypto from 'crypto';

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
      
      // 4. Calculate duration properly
      const duration = calculateJobDuration(job.started_at, job.completed_at);
      
      // 5. Build Feishu message
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
                  `**Duration**: ${duration}`
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

      // 6. Add Feishu signature if configured
      if (process.env.FEISHU_SECRET) {
        const timestamp = Math.floor(Date.now() / 1000).toString();
        message.timestamp = timestamp;
        message.sign = generateFeishuSignature(process.env.FEISHU_SECRET, timestamp);
      }

      // 7. Send to Feishu using native fetch
      const feishuResponse = await fetch(process.env.FEISHU_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message)
      });
      
      if (!feishuResponse.ok) {
        const errorText = await feishuResponse.text();
        throw new Error(`Feishu API error: ${errorText}`);
      }
      
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

// Helper function - Get raw request body
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// Generate Feishu signature
function generateFeishuSignature(secret, timestamp) {
  const stringToSign = `${timestamp}\n${secret}`;
  return crypto.createHmac('sha256', stringToSign)
    .digest('base64');
}

// Properly calculate job duration
function calculateJobDuration(startedAt, completedAt) {
  try {
    // Convert ISO strings to timestamps
    const start = new Date(startedAt).getTime();
    const end = new Date(completedAt).getTime();
    
    // Calculate duration in seconds
    const seconds = Math.round((end - start) / 1000);
    
    // Format as MM:SS
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}m ${remainingSeconds}s`;
  } catch (e) {
    console.error('Duration calculation error:', e);
    return 'N/A';
  }
}
