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

// 获取二维码并直接返回HTML页面显示
async function getQRCode(env: any, corsHeaders: any): Promise<Response> {
  const browser = await launch(env.MYBROWSER);
  const page = await browser.newPage();

  try {
    await page.goto('https://weibo.com/login.php');
    await page.waitForTimeout(3000);

    // 点击二维码登录
    const qrTabs = [
      'text=二维码登录',
      'text=扫码登录', 
      '.info_list a[href*="qr"]'
    ];
    
    for (const selector of qrTabs) {
      try {
        const element = page.locator(selector);
        if (await element.isVisible({ timeout: 2000 })) {
          await element.click();
          await page.waitForTimeout(2000);
          break;
        }
      } catch (e) { continue; }
    }

    // 寻找二维码
    const qrSelectors = [
      'img[src*="qr"]',
      'img[alt*="二维码"]', 
      '.qrcode_box img',
      '.W_login_qrcode img'
    ];

    let qrElement = null;
    for (const selector of qrSelectors) {
      try {
        const element = page.locator(selector);
        if (await element.isVisible({ timeout: 2000 })) {
          qrElement = element;
          break;
        }
      } catch (e) { continue; }
    }

    if (!qrElement) {
      await browser.close();
      return new Response('未找到二维码元素', { status: 404, headers: corsHeaders });
    }

    // 截取二维码
    const qrScreenshot = await qrElement.screenshot();
    const qrBase64 = btoa(String.fromCharCode(...qrScreenshot));
    
    // 生成会话ID
    const sessionId = `qr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // 保存页面上下文到KV
    if (env.WEIBO_KV) {
      await env.WEIBO_KV.put(`session:${sessionId}`, JSON.stringify({
        sessionId,
        createTime: Date.now(),
        status: 'waiting'
      }), { expirationTtl: 300 });
    }

    await browser.close();

    // 返回包含二维码的HTML
    const html = `
      <img src="data:image/png;base64,${qrBase64}" alt="二维码" style="max-width: 300px;">
      <input type="hidden" id="sessionId" value="${sessionId}">
      <script>window.parent.sessionId = '${sessionId}';</script>
    `;

    return new Response(html, {
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

// 检查登录状态
async function checkLogin(sessionId: string | null, env: any, corsHeaders: any): Promise<Response> {
  if (!sessionId) {
    return new Response('缺少会话ID', { status: 400, headers: corsHeaders });
  }

  const browser = await launch(env.MYBROWSER);
  const page = await browser.newPage();

  try {
    await page.goto('https://weibo.com/login.php');
    await page.waitForTimeout(2000);

    // 切换到二维码登录
    try {
      await page.locator('text=二维码登录').click({ timeout: 2000 });
      await page.waitForTimeout(1000);
    } catch (e) {}

    // 检查登录状态
    const currentUrl = page.url();
    const isLoggedIn = currentUrl.includes('/home') || 
                      await page.locator('.gn_name').isVisible().catch(() => false);

    if (isLoggedIn) {
      // 保存登录状态
      const cookies = await page.context().cookies();
      const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

      if (env.WEIBO_KV) {
        await env.WEIBO_KV.put(`login:${sessionId}`, JSON.stringify({
          sessionId,
          cookies: cookieString,
          loginTime: Date.now()
        }), { expirationTtl: 86400 * 7 });
      }

      await browser.close();
      return new Response('登录成功', { headers: corsHeaders });
    }

    // 检查二维码状态
    const statusElement = page.locator('.qrcode_tips').or(page.locator('.login_code_tip'));
    let status = '等待扫描...';
    
    if (await statusElement.isVisible()) {
      const text = await statusElement.textContent();
      if (text?.includes('已扫描')) status = '已扫描，请确认...';
      else if (text?.includes('已过期')) status = '二维码已过期';
    }

    await browser.close();
    return new Response(status, { headers: corsHeaders });

  } catch (error: any) {
    await browser.close();
    return new Response(`检查失败: ${error.message}`, { 
      status: 500, 
      headers: corsHeaders 
    });
  }
}

// 发布微博
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
    // 设置cookies
    const cookies = loginInfo.cookies.split('; ').map((cookie: string) => {
      const [name, value] = cookie.split('=');
      return { name, value, domain: '.weibo.com', path: '/' };
    });
    
    await page.context().addCookies(cookies);
    await page.goto('https://weibo.com');
    await page.waitForTimeout(3000);

    // 检查登录状态
    const isLoggedIn = await page.locator('.gn_name').isVisible().catch(() => false);
    if (!isLoggedIn) {
      await browser.close();
      return new Response('登录已过期', { status: 401, headers: corsHeaders });
    }

    // 填写并发布微博
    const textArea = page.locator('textarea[node-type="text"]').or(
      page.locator('textarea[placeholder*="有什么新鲜事"]')
    );
    
    await textArea.fill(body.content);
    await page.waitForTimeout(1000);

    const submitBtn = page.locator('a[node-type="submit"]').or(
      page.locator('.W_btn_a[title*="发布"]')
    );
    
    await submitBtn.click();
    await page.waitForTimeout(3000);

    await browser.close();
    return new Response('发布成功', { headers: corsHeaders });

  } catch (error: any) {
    await browser.close();
    return new Response(`发布失败: ${error.message}`, { 
      status: 500, 
      headers: corsHeaders 
    });
  }
}
