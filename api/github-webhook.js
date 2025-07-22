// api/github-webhook.js
import crypto from 'crypto';

export default async (req, res) => {
  try {
    // 1. 获取原始请求体
    const rawBody = await getRawBody(req);
    const payload = JSON.parse(rawBody);
    
    // 2. 验证 GitHub 签名
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

    // 3. 处理 workflow_job 事件
    const eventType = req.headers['x-github-event'];
    if (eventType === "workflow_job" && payload.action === "completed") {
      const job = payload.workflow_job;
      const repo = payload.repository.full_name;
      
      // 4. 构建飞书消息
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
                  `**工作流**: ${job.workflow_name}\n` +
                  `**任务**: ${job.name}\n` +
                  `**状态**: ${job.conclusion}\n` +
                  `**分支**: ${job.head_branch}\n` +
                  `**用时**: ${Math.round(job.completed_at - job.started_at)}秒`
              }
            },
            {
              tag: "action",
              actions: [{
                tag: "button",
                text: { tag: "plain_text", content: "查看日志" },
                url: job.html_url,
                type: "primary"
              }]
            }
          ]
        }
      };

      // 5. 添加飞书签名（如果配置了）
      if (process.env.FEISHU_SECRET) {
        const timestamp = Math.floor(Date.now() / 1000).toString();
        message.timestamp = timestamp;
        message.sign = generateFeishuSignature(process.env.FEISHU_SECRET, timestamp);
      }

      // 6. 使用原生 fetch 发送到飞书
      const feishuResponse = await fetch(process.env.FEISHU_WEBHOOK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(message)
      });
      
      if (!feishuResponse.ok) {
        const errorText = await feishuResponse.text();
        throw new Error(`飞书API错误: ${errorText}`);
      }
      
      return res.status(200).json({ success: true });
    }
    
    res.status(200).json({ message: '事件已忽略' });
  } catch (error) {
    console.error('错误:', error);
    return res.status(500).json({ 
      error: '服务器错误',
      details: error.message 
    });
  }
};

// 辅助函数 - 获取原始请求体
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => data += chunk);
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

// 生成飞书签名
function generateFeishuSignature(secret, timestamp) {
  const stringToSign = `${timestamp}\n${secret}`;
  return crypto.createHmac('sha256', stringToSign)
    .digest('base64');
}