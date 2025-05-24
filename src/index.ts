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
    </div>

    <script>
        let sessionId = null;
        let checkInterval = null;

        async function getQRCode() {
            try {
                document.getElementById('status').textContent = '正在获取二维码...';
                const response = await fetch('/qr');
                const result = await response.text();
                
                if (response.ok) {
                    document.getElementById('qrCode').innerHTML = result;
                    const match = result.match(/session=([^"&]+)/);
                    if (match) {
                        sessionId = match[1];
                        startChecking();
                    }
                } else {
                    document.getElementById('status').textContent = '获取二维码失败: ' + result;
                }
            } catch (error) {
                document.getElementById('status').textContent = '网络错误: ' + error.message;
            }
        }

        function startChecking() {
            document.getElementById('status').textContent = '请使用微博APP扫描二维码...';
            checkInterval = setInterval(checkLoginStatus, 3000);
        }

        async function checkLoginStatus() {
            if (!sessionId) return;
            
            try {
                const response = await fetch(\`/check?session=\${sessionId}\`);
                const result = await response.text();
                
                if (result.includes('登录成功')) {
                    clearInterval(checkInterval);
                    document.getElementById('status').textContent = '登录成功！';
                    document.getElementById('postForm').style.display = 'block';
                } else if (result.includes('已过期')) {
                    clearInterval(checkInterval);
                    document.getElementById('status').textContent = '二维码已过期，请重新获取';
                }
            } catch (error) {
                console.error('检查登录状态失败:', error);
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
                const response = await fetch('/post', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content, sessionId })
                });
                
                const result = await response.text();
                document.getElementById('postStatus').textContent = result;
                
                if (response.ok && result.includes('成功')) {
                    document.getElementById('content').value = '';
                }
            } catch (error) {
                document.getElementById('postStatus').textContent = '发布失败: ' + error.message;
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
    // 设置更长的超时时间和User-Agent
    page.setDefaultTimeout(30000);
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // 访问微博手机版登录页面，这个页面更容易获取二维码
    await page.goto('https://passport.weibo.cn/signin/login', { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });
    
    await page.waitForTimeout(3000);

    // 等待页面完全加载
    await page.waitForLoadState('networkidle');
    
    // 根据HTML结构，二维码图片的选择器
    const qrSelectors = [
      // 基于你提供的HTML结构
      'div.relative.border-2 img',
      'div.w-45.h-45 img',
      'img[src*="qr.weibo.cn"]',
      'img[src*="qrcode"]',
      'img[src*="api_key"]',
      // 备用选择器
      'img[alt=""]',
      '.qr img',
      '.qrcode img',
    ];

    let qrElement = null;
    let qrSrc = null;
    
    // 首先尝试直接从页面获取二维码图片
    for (const selector of qrSelectors) {
      try {
        const elements = await page.locator(selector).all();
        
        for (const element of elements) {
          if (await element.isVisible({ timeout: 2000 })) {
            const src = await element.getAttribute('src');
            if (src && (src.includes('qr') || src.includes('api_key'))) {
              qrElement = element;
              qrSrc = src;
              break;
            }
          }
        }
        
        if (qrElement) break;
      } catch (e) {
        continue;
      }
    }

    let sessionId = `qr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    if (qrElement && qrSrc) {
      // 如果找到二维码，直接使用其URL
      const html = `
        <div style="text-align: center;">
          <img src="${qrSrc}" alt="二维码" style="max-width: 300px; border: 1px solid #ddd;">
          <input type="hidden" id="sessionId" value="${sessionId}">
          <script>window.parent.sessionId = '${sessionId}';</script>
          <p style="margin-top: 10px; font-size: 12px; color: #666;">请使用微博APP扫描二维码</p>
        </div>
      `;

      // 保存会话信息
      if (env.WEIBO_KV) {
        await env.WEIBO_KV.put(`session:${sessionId}`, JSON.stringify({
          sessionId,
          createTime: Date.now(),
          status: 'waiting',
          qrSrc: qrSrc
        }), { expirationTtl: 300 });
      }

      await browser.close();
      return new Response(html, {
        headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
    
    // 如果没有找到二维码，尝试截图调试
    const screenshot = await page.screenshot({ fullPage: true });
    const base64 = btoa(String.fromCharCode(...screenshot));
    
    await browser.close();
    
    const debugHtml = `
      <div style="text-align: center;">
        <h3>调试信息 - 页面截图</h3>
        <p>当前URL: ${page.url()}</p>
        <p>页面标题: ${await page.title()}</p>
        <img src="data:image/png;base64,${base64}" alt="页面截图" style="max-width: 100%; border: 1px solid #ccc;">
        <p style="color: red;">未找到二维码元素，请检查页面是否正确加载</p>
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

// 检查登录状态 - 修复版本
async function checkLogin(sessionId: string | null, env: any, corsHeaders: any): Promise<Response> {
  if (!sessionId) {
    return new Response('缺少会话ID', { status: 400, headers: corsHeaders });
  }

  const browser = await launch(env.MYBROWSER);
  const page = await browser.newPage();

  try {
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // 检查是否已经登录成功
    await page.goto('https://weibo.com', { timeout: 15000 });
    await page.waitForTimeout(2000);

    // 检查登录状态的多种方式
    const loginChecks = [
      // 检查用户名显示
      () => page.locator('.gn_name').isVisible().catch(() => false),
      // 检查是否跳转到首页
      () => page.url().includes('/home') || page.url().includes('weibo.com') && !page.url().includes('login'),
      // 检查用户头像
      () => page.locator('.head_img').isVisible().catch(() => false),
      // 检查导航栏用户信息
      () => page.locator('[node-type="username"]').isVisible().catch(() => false)
    ];

    let isLoggedIn = false;
    for (const check of loginChecks) {
      if (await check()) {
        isLoggedIn = true;
        break;
      }
    }

    if (isLoggedIn) {
      // 保存登录状态和cookies
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

// 发布微博 - 修复版本
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
    // 设置User-Agent
    if (loginInfo.userAgent) {
      await page.setUserAgent(loginInfo.userAgent);
    }

    // 设置cookies
    const cookies = loginInfo.cookies.split('; ').map((cookie: string) => {
      const [name, ...valueParts] = cookie.split('=');
      const value = valueParts.join('=');
      return { name, value, domain: '.weibo.com', path: '/' };
    });
    
    await page.context().addCookies(cookies);
    
    // 访问微博首页
    await page.goto('https://weibo.com', { timeout: 15000 });
    await page.waitForTimeout(3000);

    // 检查登录状态
    const isLoggedIn = await page.locator('.gn_name').isVisible().catch(() => false);
    if (!isLoggedIn) {
      await browser.close();
      return new Response('登录已过期，请重新登录', { status: 401, headers: corsHeaders });
    }

    // 查找发布框的多种选择器
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

    // 填写内容
    await textArea.fill(body.content);
    await page.waitForTimeout(1000);

    // 查找发布按钮
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

    // 点击发布
    await submitBtn.click();
    await page.waitForTimeout(3000);

    // 检查是否发布成功
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
