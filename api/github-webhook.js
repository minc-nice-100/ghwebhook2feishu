import crypto from 'crypto';
import axios from 'axios';

export default async (req, res) => {
  try {
    // 验证 GitHub 签名
    const githubSignature = req.headers['x-hub-signature-256'] || '';
    const githubEvent = req.headers['x-github-event'] || '';
    
    if (process.env.GITHUB_WEBHOOK_SECRET) {
      const expectedSignature = 'sha256=' + 
        crypto.createHmac('sha256', process.env.GITHUB_WEBHOOK_SECRET)
          .update(JSON.stringify(req.body))
          .digest('hex');
      
      if (!crypto.timingSafeEqual(
        Buffer.from(githubSignature), 
        Buffer.from(expectedSignature)
      )) {
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    // 只处理 workflow_job 完成事件
    if (githubEvent === 'workflow_job' && req.body.action === 'completed') {
      const { workflow_job: job, repository } = req.body;
      
      // 构建飞书消息
      const message = {
        msg_type: "interactive",
        card: {
          header: {
            title: {
              tag: "plain_text",
              content: `Job ${job.conclusion.toUpperCase()}: ${repository.full_name}`
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
                  `**状态**: ${job.conclusion}\n` +
                  `**触发分支**: ${job.head_branch}`
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

      // 添加飞书签名（如果配置了）
      if (process.env.FEISHU_SECRET) {
        const timestamp = Math.floor(Date.now() / 1000).toString();
        const sign = generateFeishuSignature(
          process.env.FEISHU_SECRET, 
          timestamp
        );
        
        message.timestamp = timestamp;
        message.sign = sign;
      }

      // 发送到飞书
      await axios.post(process.env.FEISHU_WEBHOOK_URL, message);
    }

    res.status(200).json({ status: "processed" });
  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// 生成飞书签名
function generateFeishuSignature(secret, timestamp) {
  const stringToSign = `${timestamp}\n${secret}`;
  const hmac = crypto.createHmac('sha256', stringToSign);
  return hmac.digest('base64');
}

export const config = {
  api: {
    bodyParser: false,
  },
};
