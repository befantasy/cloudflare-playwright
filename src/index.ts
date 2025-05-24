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
    // 设置移动端用户代理，因为看起来是移动端页面
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 14_7_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Mobile/15E148 Safari/604.1');
    
    // 访问微博登录页面
    await page.goto('https://passport.weibo.cn/signin/login', { waitUntil: 'networkidle' });
    await page.waitForTimeout(5000);

    // 根据HTML结构，二维码直接在左侧显示，寻找二维码图片
    const qrSelectors = [
      // 根据提供的HTML，二维码在这个结构中
      'img[src*="v2.qr.weibo.cn"]',
      'img[src*="qr.weibo"]',
      '.w-45.h-45 img', // 宽高45的div中的图片
      '.p-5 img', // padding为5的div中的图片
      '.border-2.border-line img', // 有边框的div中的图片
      'img[src*="api_key"]', // 包含api_key的二维码链接
      'img[alt=""]', // 空alt属性的图片
      // 备用选择器
      'img[src*="qr"]',
      'img[src*="QR"]'
    ];

    let qrElement = null;
    let qrSrc = null;
    let debugInfo = '';
    
    for (const selector of qrSelectors) {
      try {
        const elements = page.locator(selector);
        const count = await elements.count();
        debugInfo += `${selector}: ${count}个元素; `;
        
        if (count > 0) {
          const element = elements.first();
          if (await element.isVisible({ timeout: 3000 })) {
            qrElement = element;
            qrSrc = await element.getAttribute('src');
            break;
          }
        }
      } catch (e) { 
        continue; 
      }
    }

    // 如果找不到二维码元素，直接截取左侧二维码区域
    if (!qrElement) {
      // 尝试定位二维码容器区域
      const qrContainer = page.locator('.w-82\\.5').or(
        page.locator('text=扫描二维码登录').locator('xpath=../..').or(
          page.locator('.border-2.border-line')
        )
      );
      
      if (await qrContainer.isVisible({ timeout: 3000 })) {
        const containerScreenshot = await qrContainer.screenshot();
        const containerBase64 = btoa(String.fromCharCode(...containerScreenshot));
        
        const sessionId = `qr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        if (env.WEIBO_KV) {
          await env.WEIBO_KV.put(`session:${sessionId}`, JSON.stringify({
            sessionId,
            createTime: Date.now(),
            status: 'waiting'
          }), { expirationTtl: 300 });
        }

        await browser.close();

        const html = `
          <div style="text-align: center;">
            <img src="data:image/png;base64,${containerBase64}" alt="二维码区域" style="max-width: 300px; border: 1px solid #ddd;">
            <input type="hidden" id="sessionId" value="${sessionId}">
            <script>window.parent.sessionId = '${sessionId}';</script>
          </div>
        `;

        return new Response(html, {
          headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' }
        });
      }
    }

    // 如果找到了二维码元素
    if (qrElement) {
      let qrBase64 = '';
      
      // 如果有src属性且是完整URL，直接使用
      if (qrSrc && qrSrc.startsWith('http')) {
        // 直接返回二维码URL
        const sessionId = `qr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        if (env.WEIBO_KV) {
          await env.WEIBO_KV.put(`session:${sessionId}`, JSON.stringify({
            sessionId,
            createTime: Date.now(),
            status: 'waiting',
            qrUrl: qrSrc
          }), { expirationTtl: 300 });
        }

        await browser.close();

        const html = `
          <div style="text-align: center;">
            <img src="${qrSrc}" alt="二维码" style="max-width: 300px; border: 1px solid #ddd;">
            <p style="font-size: 12px; color: #666; margin-top: 10px;">打开微博手机APP - 我的页面 - 扫一扫</p>
            <input type="hidden" id="sessionId" value="${sessionId}">
            <script>window.parent.sessionId = '${sessionId}';</script>
          </div>
        `;

        return new Response(html, {
          headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' }
        });
      } else {
        // 截取二维码图片
        const qrScreenshot = await qrElement.screenshot();
        qrBase64 = btoa(String.fromCharCode(...qrScreenshot));
        
        const sessionId = `qr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        if (env.WEIBO_KV) {
          await env.WEIBO_KV.put(`session:${sessionId}`, JSON.stringify({
            sessionId,
            createTime: Date.now(),
            status: 'waiting'
          }), { expirationTtl: 300 });
        }

        await browser.close();

        const html = `
          <div style="text-align: center;">
            <img src="data:image/png;base64,${qrBase64}" alt="二维码" style="max-width: 300px; border: 1px solid #ddd;">
            <p style="font-size: 12px; color: #666; margin-top: 10px;">打开微博手机APP - 我的页面 - 扫一扫</p>
            <input type="hidden" id="sessionId" value="${sessionId}">
            <script>window.parent.sessionId = '${sessionId}';</script>
          </div>
        `;

        return new Response(html, {
          headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' }
        });
      }
    }

    // 如果所有方法都失败，返回调试信息
    const fullScreenshot = await page.screenshot();
    const fullBase64 = btoa(String.fromCharCode(...fullScreenshot));
    
    await browser.close();
    
    const debugHtml = `
      <div style="text-align: center;">
        <h3>调试信息 - 当前页面截图</h3>
        <p>选择器尝试结果: ${debugInfo}</p>
        <p>当前URL: ${page.url()}</p>
        <img src="data:image/png;base64,${fullBase64}" alt="页面截图" style="max-width: 100%; border: 1px solid #ccc;">
        <p>请检查页面是否正确显示二维码</p>
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
