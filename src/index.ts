import { launch } from '@cloudflare/playwright';

export default {
  async fetch(request: any, env: any): Promise<Response> {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      switch (path) {
        case '/':
          return getLoginPage(corsHeaders);
        case '/qr':
          return await getQRCode(env, corsHeaders);
        case '/check':
          return await checkLogin(url.searchParams.get('session'), env, corsHeaders);
        case '/post':
          return await postWeibo(request, env, corsHeaders);
        default:
          return new Response('Not Found', { status: 404, headers: corsHeaders });
      }
    } catch (error: any) {
      return new Response(`Error: ${error.message}`, { 
        status: 500, 
        headers: corsHeaders 
      });
    }
  },
};

// 返回登录页面
function getLoginPage(corsHeaders: any): Response {
  const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>微博登录</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
        .container { text-align: center; }
        .qr-container { margin: 20px 0; padding: 20px; border: 1px solid #ddd; border-radius: 8px; }
        button { padding: 10px 20px; margin: 10px; background: #1da1f2; color: white; border: none; border-radius: 4px; cursor: pointer; }
        button:hover { background: #0d8bd9; }
        #qrCode { max-width: 300px; margin: 20px auto; }
        #status { margin: 10px 0; font-weight: bold; }
        .post-form { margin-top: 30px; padding: 20px; border: 1px solid #ddd; border-radius: 8px; display: none; }
        textarea { width: 100%; height: 100px; margin: 10px 0; padding: 10px; border: 1px solid #ddd; border-radius: 4px; }
        .debug { margin-top: 20px; padding: 10px; background: #f5f5f5; border-radius: 4px; font-size: 12px; text-align: left; }
    </style>
</head>
<body>
    <div class="container">
        <h1>微博自动登录与发布</h1>
        
        <div class="qr-container">
            <h3>扫码登录</h3>
            <button onclick="getQRCode()">获取二维码</button>
            <div id="qrCode"></div>
            <div id="status"></div>
        </div>

        <div id="postForm" class="post-form">
            <h3>发布微博</h3>
            <textarea id="content" placeholder="输入微博内容..."></textarea>
            <button onclick="postWeibo()">发布微博</button>
            <div id="postStatus"></div>
        </div>

        <div id="debug" class="debug" style="display: none;"></div>
    </div>

    <script>
        let sessionId = null;
        let checkInterval = null;
        let checkCount = 0;
        const maxChecks = 60; // 最多检查60次 (3分钟)

        function log(message) {
            const debugDiv = document.getElementById('debug');
            debugDiv.style.display = 'block';
            debugDiv.innerHTML += new Date().toLocaleTimeString() + ': ' + message + '<br>';
            console.log(message);
        }

        async function getQRCode() {
            try {
                document.getElementById('status').textContent = '正在获取二维码...';
                log('开始获取二维码');
                
                const response = await fetch('/qr');
                const result = await response.text();
                
                if (response.ok) {
                    document.getElementById('qrCode').innerHTML = result;
                    
                    // 从返回的HTML中提取sessionId
                    const match = result.match(/sessionId['"]\s*:\s*['"]([^'"]+)['"]/);
                    if (match) {
                        sessionId = match[1];
                        log('获取到sessionId: ' + sessionId);
                        startChecking();
                    } else {
                        log('未能从响应中提取sessionId');
                    }
                } else {
                    document.getElementById('status').textContent = '获取二维码失败: ' + result;
                    log('获取二维码失败: ' + result);
                }
            } catch (error) {
                document.getElementById('status').textContent = '网络错误: ' + error.message;
                log('网络错误: ' + error.message);
            }
        }

        function startChecking() {
            document.getElementById('status').textContent = '请使用微博APP扫描二维码...';
            log('开始检查登录状态');
            checkCount = 0;
            checkInterval = setInterval(checkLoginStatus, 3000);
        }

        async function checkLoginStatus() {
            if (!sessionId) return;
            
            checkCount++;
            log(\`检查登录状态 (\${checkCount}/\${maxChecks})\`);
            
            if (checkCount > maxChecks) {
                clearInterval(checkInterval);
                document.getElementById('status').textContent = '检查超时，请重新获取二维码';
                log('检查超时');
                return;
            }
            
            try {
                const response = await fetch(\`/check?session=\${sessionId}\`);
                const result = await response.text();
                log('检查结果: ' + result);
                
                if (result.includes('登录成功')) {
                    clearInterval(checkInterval);
                    document.getElementById('status').textContent = '登录成功！';
                    document.getElementById('postForm').style.display = 'block';
                    log('登录成功，显示发布表单');
                } else if (result.includes('已过期') || result.includes('超时')) {
                    clearInterval(checkInterval);
                    document.getElementById('status').textContent = '二维码已过期，请重新获取';
                    log('二维码已过期');
                } else {
                    // 继续等待
                    document.getElementById('status').textContent = \`等待扫描... (\${checkCount}/\${maxChecks})\`;
                }
            } catch (error) {
                log('检查登录状态失败: ' + error.message);
            }
        }

        async function postWeibo() {
            const content = document.getElementById('content').value.trim();
            if (!content) {
                alert('请输入微博内容');
                return;
            }

            try {
                document.getElementById('postStatus').textContent = '正在发布...';
                log('开始发布微博: ' + content);
                
                const response = await fetch('/post', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content, sessionId })
                });
                
                const result = await response.text();
                document.getElementById('postStatus').textContent = result;
                log('发布结果: ' + result);
                
                if (response.ok && result.includes('成功')) {
                    document.getElementById('content').value = '';
                }
            } catch (error) {
                document.getElementById('postStatus').textContent = '发布失败: ' + error.message;
                log('发布失败: ' + error.message);
            }
        }
    </script>
</body>
</html>`;

  return new Response(html, {
    headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' }
  });
}

// 获取二维码 - 修复版本
async function getQRCode(env: any, corsHeaders: any): Promise<Response> {
  const browser = await launch(env.MYBROWSER);
  const page = await browser.newPage();

  try {
    //await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1');
    
    // 访问微博手机版登录页面
    await page.goto('https://passport.weibo.cn/signin/login', { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });
    
    await page.waitForTimeout(3000);

    // 查找二维码
    const qrSelectors = [
      'div.relative.border-2 img',
      'div.w-45.h-45 img',
      'img[src*="qr.weibo.cn"]',
      'img[src*="qrcode"]',
      'img[src*="api_key"]',
      'img[alt=""]'
    ];

    let qrSrc = null;
    
    for (const selector of qrSelectors) {
      try {
        const elements = await page.locator(selector).all();
        
        for (const element of elements) {
          if (await element.isVisible({ timeout: 2000 })) {
            const src = await element.getAttribute('src');
            if (src && (src.includes('qr') || src.includes('api_key'))) {
              qrSrc = src;
              break;
            }
          }
        }
        
        if (qrSrc) break;
      } catch (e) {
        continue;
      }
    }

    let sessionId = `qr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    if (qrSrc) {
      // 从二维码URL中提取实际的登录参数
      let qrToken = null;
      try {
        const qrUrl = new URL(qrSrc);
        const dataParam = qrUrl.searchParams.get('data');
        if (dataParam) {
          const decodedData = decodeURIComponent(dataParam);
          const qrMatch = decodedData.match(/qr=([^&]+)/);
          if (qrMatch) {
            qrToken = qrMatch[1];
          }
        }
      } catch (e) {
        console.log('提取二维码token失败:', e);
      }

      const html = `
        <div style="text-align: center;">
          <img src="${qrSrc}" alt="二维码" style="max-width: 300px; border: 1px solid #ddd;">
          <input type="hidden" id="sessionId" value="${sessionId}">
          <script>
            window.sessionId = '${sessionId}';
            window.qrToken = '${qrToken || ''}';
          </script>
          <p style="margin-top: 10px; font-size: 12px; color: #666;">请使用微博APP扫描二维码</p>
        </div>
      `;

      // 保存会话信息，包含二维码token
      if (env.WEIBO_KV) {
        await env.WEIBO_KV.put(`session:${sessionId}`, JSON.stringify({
          sessionId,
          createTime: Date.now(),
          status: 'waiting',
          qrSrc: qrSrc,
          qrToken: qrToken,
          loginUrl: 'https://passport.weibo.cn/signin/login'
        }), { expirationTtl: 300 });
      }

      await browser.close();
      return new Response(html, {
        headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
    
    // 调试信息
    const screenshot = await page.screenshot({ fullPage: false });
    const base64 = btoa(String.fromCharCode(...screenshot));
    
    await browser.close();
    
    const debugHtml = `
      <div style="text-align: center;">
        <h3>调试信息</h3>
        <p>当前URL: ${page.url()}</p>
        <p>页面标题: ${await page.title()}</p>
        <img src="data:image/png;base64,${base64}" alt="页面截图" style="max-width: 100%; border: 1px solid #ccc;">
        <p style="color: red;">未找到二维码，请检查页面</p>
      </div>
    `;
    
    return new Response(debugHtml, {
      headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' }
    });

  } catch (error: any) {
    await browser.close();
    return new Response(`获取二维码失败: ${error.message}`, { 
      status: 500, 
      headers: corsHeaders 
    });
  }
}

// 检查登录状态 - 完全重写
async function checkLogin(sessionId: string | null, env: any, corsHeaders: any): Promise<Response> {
  if (!sessionId) {
    return new Response('缺少会话ID', { status: 400, headers: corsHeaders });
  }

  // 获取会话信息
  let sessionInfo = null;
  if (env.WEIBO_KV) {
    const sessionInfoStr = await env.WEIBO_KV.get(`session:${sessionId}`);
    if (sessionInfoStr) {
      sessionInfo = JSON.parse(sessionInfoStr);
    }
  }

  if (!sessionInfo) {
    return new Response('会话已过期', { status: 400, headers: corsHeaders });
  }

  // 检查会话是否超时（5分钟）
  if (Date.now() - sessionInfo.createTime > 300000) {
    return new Response('二维码已过期', { status: 400, headers: corsHeaders });
  }

  const browser = await launch(env.MYBROWSER);
  const page = await browser.newPage();

  try {
    //await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.0 Mobile/15E148 Safari/604.1');
    
    // 方法1: 检查二维码状态API
    if (sessionInfo.qrToken) {
      try {
        // 构造检查登录状态的URL
        const checkUrl = `https://passport.weibo.cn/signin/qrcode/check?qr=${sessionInfo.qrToken}`;
        await page.goto(checkUrl, { timeout: 10000 });
        
        const content = await page.content();
        
        // 检查响应内容
        if (content.includes('"retcode":20000000') || content.includes('success')) {
          // 登录成功，获取登录后的cookies
          await page.goto('https://weibo.com', { timeout: 15000 });
          await page.waitForTimeout(2000);
          
          const cookies = await page.context().cookies();
          const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

          // 保存登录信息
          if (env.WEIBO_KV) {
            await env.WEIBO_KV.put(`login:${sessionId}`, JSON.stringify({
              sessionId,
              cookies: cookieString,
              loginTime: Date.now(),
              userAgent: await page.evaluate(() => navigator.userAgent)
            }), { expirationTtl: 86400 * 7 });

            // 更新会话状态
            await env.WEIBO_KV.put(`session:${sessionId}`, JSON.stringify({
              ...sessionInfo,
              status: 'success',
              loginTime: Date.now()
            }), { expirationTtl: 300 });
          }

          await browser.close();
          return new Response('登录成功', { headers: corsHeaders });
        }
      } catch (e) {
        console.log('API检查失败，尝试其他方法:', e);
      }
    }

    // 方法2: 直接访问微博主页检查登录状态
    await page.goto('https://weibo.com', { timeout: 15000 });
    await page.waitForTimeout(3000);

    // 检查是否已登录
    const loginChecks = [
      async () => {
        try {
          return await page.locator('.gn_name').isVisible({ timeout: 2000 });
        } catch {
          return false;
        }
      },
      async () => {
        return page.url().includes('/home') || (page.url().includes('weibo.com') && !page.url().includes('login'));
      },
      async () => {
        try {
          return await page.locator('[node-type="username"]').isVisible({ timeout: 2000 });
        } catch {
          return false;
        }
      }
    ];

    let isLoggedIn = false;
    for (const check of loginChecks) {
      if (await check()) {
        isLoggedIn = true;
        break;
      }
    }

    if (isLoggedIn) {
      const cookies = await page.context().cookies();
      const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

      if (env.WEIBO_KV) {
        await env.WEIBO_KV.put(`login:${sessionId}`, JSON.stringify({
          sessionId,
          cookies: cookieString,
          loginTime: Date.now(),
          userAgent: await page.evaluate(() => navigator.userAgent)
        }), { expirationTtl: 86400 * 7 });
      }

      await browser.close();
      return new Response('登录成功', { headers: corsHeaders });
    }

    await browser.close();
    return new Response('等待扫描...', { headers: corsHeaders });

  } catch (error: any) {
    await browser.close();
    return new Response(`检查失败: ${error.message}`, { 
      status: 500, 
      headers: corsHeaders 
    });
  }
}

// 发布微博 - 保持原有逻辑
async function postWeibo(request: any, env: any, corsHeaders: any): Promise<Response> {
  const body = await request.json();
  
  if (!body.content || !body.sessionId) {
    return new Response('缺少内容或会话ID', { status: 400, headers: corsHeaders });
  }

  // 获取登录信息
  let loginInfo = null;
  if (env.WEIBO_KV) {
    const loginInfoStr = await env.WEIBO_KV.get(`login:${body.sessionId}`);
    if (loginInfoStr) {
      loginInfo = JSON.parse(loginInfoStr);
    }
  }

  if (!loginInfo) {
    return new Response('未登录，请先登录', { status: 401, headers: corsHeaders });
  }

  const browser = await launch(env.MYBROWSER);
  const page = await browser.newPage();

  try {
    //if (loginInfo.userAgent) {
    //  await page.setUserAgent(loginInfo.userAgent);
    //}

    const cookies = loginInfo.cookies.split('; ').map((cookie: string) => {
      const [name, ...valueParts] = cookie.split('=');
      const value = valueParts.join('=');
      return { name, value, domain: '.weibo.com', path: '/' };
    });
    
    await page.context().addCookies(cookies);
    
    await page.goto('https://weibo.com', { timeout: 15000 });
    await page.waitForTimeout(3000);

    const isLoggedIn = await page.locator('.gn_name').isVisible().catch(() => false);
    if (!isLoggedIn) {
      await browser.close();
      return new Response('登录已过期，请重新登录', { status: 401, headers: corsHeaders });
    }

    const textAreaSelectors = [
      'textarea[node-type="text"]',
      'textarea[placeholder*="有什么新鲜事"]',
      'textarea[placeholder*="分享新鲜事"]',
      '.WB_editor_iframe textarea',
      '.send_weibo textarea',
      'textarea[name="text"]'
    ];

    let textArea = null;
    for (const selector of textAreaSelectors) {
      try {
        const element = page.locator(selector);
        if (await element.isVisible({ timeout: 3000 })) {
          textArea = element;
          break;
        }
      } catch (e) {
        continue;
      }
    }

    if (!textArea) {
      await browser.close();
      return new Response('未找到发布框，页面可能已更新', { status: 500, headers: corsHeaders });
    }

    await textArea.fill(body.content);
    await page.waitForTimeout(1000);

    const submitSelectors = [
      'a[node-type="submit"]',
      '.W_btn_a[title*="发布"]',
      'button[title*="发布"]',
      '.send_btn',
      '.W_btn_a[action-type="submit"]'
    ];

    let submitBtn = null;
    for (const selector of submitSelectors) {
      try {
        const element = page.locator(selector);
        if (await element.isVisible({ timeout: 2000 })) {
          submitBtn = element;
          break;
        }
      } catch (e) {
        continue;
      }
    }

    if (!submitBtn) {
      await browser.close();
      return new Response('未找到发布按钮', { status: 500, headers: corsHeaders });
    }

    await submitBtn.click();
    await page.waitForTimeout(3000);

    const successIndicators = [
      () => page.locator('.W_tips_success').isVisible().catch(() => false),
      () => page.locator('.tips[node-type="success"]').isVisible().catch(() => false),
      () => page.url().includes('/home') || page.url().includes('/u/')
    ];

    let isSuccess = false;
    for (const check of successIndicators) {
      if (await check()) {
        isSuccess = true;
        break;
      }
    }

    await browser.close();
    
    if (isSuccess) {
      return new Response('发布成功', { headers: corsHeaders });
    } else {
      return new Response('发布可能失败，请检查', { headers: corsHeaders });
    }

  } catch (error: any) {
    await browser.close();
    return new Response(`发布失败: ${error.message}`, { 
      status: 500, 
      headers: corsHeaders 
    });
  }
}
