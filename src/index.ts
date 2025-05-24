import { launch, Page } from '@cloudflare/playwright'; // Assuming Page might be needed for other type hints, though not strictly for setUserAgent anymore

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
                    // Attempt to extract session ID from the HTML returned by /qr
                    // This depends on how you embed the sessionId in the getQRCode function's response
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = result;
                    const hiddenInput = tempDiv.querySelector('input#sessionId'); // Assuming you have <input type="hidden" id="sessionId" value="...">
                    if (hiddenInput && hiddenInput.value) {
                         sessionId = hiddenInput.value;
                    } else {
                        // Fallback or alternative method if sessionId isn't in a hidden input
                        const match = result.match(/sessionId = '([^']+)'/); // Example: if you have <script>window.parent.sessionId = 'xxx';</script>
                        if (match && match[1]) {
                            sessionId = match[1];
                        } else {
                             console.warn('Session ID not found in QR response.');
                        }
                    }
                    
                    if (sessionId) {
                        startChecking();
                    } else {
                        document.getElementById('status').textContent = '获取二维码成功，但未能提取会话ID。';
                    }
                } else {
                    document.getElementById('status').textContent = '获取二维码失败: ' + result;
                }
            } catch (error) {
                document.getElementById('status').textContent = '网络错误: ' + error.message;
            }
        }

        function startChecking() {
            if (!sessionId) {
                document.getElementById('status').textContent = '会话ID无效，无法开始检查。';
                return;
            }
            document.getElementById('status').textContent = '请使用微博APP扫描二维码...';
            if (checkInterval) clearInterval(checkInterval); // Clear previous interval if any
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
                } else if (result.includes('等待扫描')) {
                    document.getElementById('status').textContent = '等待扫描...'; // Keep user informed
                }
                // Potentially handle other statuses
            } catch (error) {
                console.error('检查登录状态失败:', error);
                document.getElementById('status').textContent = '检查登录状态时发生网络错误。';
            }
        }

        async function postWeibo() {
            const content = document.getElementById('content').value.trim();
            if (!content) {
                alert('请输入微博内容');
                return;
            }
            if (!sessionId) {
                alert('会话ID丢失，请重新登录。');
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
  const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const page = await browser.newPage({ userAgent });

  try {
    // 设置更长的超时时间
    page.setDefaultTimeout(30000);
    // User-Agent is now set via newPage options
    
    // 访问微博手机版登录页面
    await page.goto('https://passport.weibo.cn/signin/login', { 
      waitUntil: 'networkidle',
      timeout: 30000 
    });
    
    await page.waitForTimeout(3000); // Give some time for dynamic content

    // 等待页面完全加载
    await page.waitForLoadState('networkidle');
    
    const qrSelectors = [
      'div.relative.border-2 img',
      'div.w-45.h-45 img',
      'img[src*="qr.weibo.cn"]',
      'img[src*="qrcode"]',
      'img[src*="api_key"]',
      'img[alt=""]',
      '.qr img',
      '.qrcode img',
    ];

    let qrElement = null;
    let qrSrc = null;
    
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
        // console.warn(`Selector ${selector} not found or error:`, e);
        continue;
      }
    }

    let sessionId = `qr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    if (qrElement && qrSrc) {
      const html = `
        <div style="text-align: center;">
          <img src="${qrSrc}" alt="二维码" style="max-width: 300px; border: 1px solid #ddd;">
          <input type="hidden" id="sessionId" value="${sessionId}">
          <script>window.parent.sessionId = '${sessionId}';</script> 
          <p style="margin-top: 10px; font-size: 12px; color: #666;">请使用微博APP扫描二维码</p>
        </div>
      `;

      if (env.WEIBO_KV) {
        await env.WEIBO_KV.put(`session:${sessionId}`, JSON.stringify({
          sessionId,
          createTime: Date.now(),
          status: 'waiting',
          qrSrc: qrSrc
        }), { expirationTtl: 300 }); // 5 minutes
      }

      await browser.close();
      return new Response(html, {
        headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' }
      });
    }
    
    // Fallback: If no QR element found, provide debug info
    const screenshot = await page.screenshot({ fullPage: true });
    const base64 = btoa(String.fromCharCode(...new Uint8Array(screenshot))); // Correct way to convert ArrayBuffer to base64
    
    await browser.close();
    
    const debugHtml = `
      <div style="text-align: center;">
        <h3>调试信息 - 页面截图</h3>
        <p>当前URL: ${page.url()}</p>
        <p>页面标题: ${await page.title()}</p>
        <img src="data:image/png;base64,${base64}" alt="页面截图" style="max-width: 100%; border: 1px solid #ccc;">
        <p style="color: red;">未找到二维码元素，请检查页面是否正确加载以及选择器是否仍然有效。</p>
      </div>
    `;
    
    return new Response(debugHtml, {
      headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' }
    });

  } catch (error: any) {
    await browser.close(); // Ensure browser is closed on error
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

  // Retrieve session data to see if we already have cookies from a previous QR scan for this browser instance
  // This part might be tricky if the Playwright instance in checkLogin is different from the one in getQRCode
  // For simplicity, we assume we need a fresh Playwright instance to check the current global login state.

  const browser = await launch(env.MYBROWSER);
  const userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
  const page = await browser.newPage({ userAgent });

  try {
    // User-Agent is now set via newPage options
    
    // Go to Weibo to check login status.
    // We assume that scanning the QR code on the mobile app logs in the browser session associated with Playwright.
    // This might require the Playwright browser to have some persistence or be the same instance,
    // or rely on Weibo's QR login to affect the account globally for a short period.
    // If `env.MYBROWSER` provides a persistent browser session, this might work.
    // Otherwise, this check might always show "not logged in" if it's a fresh, cookieless browser.

    await page.goto('https://weibo.com', { timeout: 15000, waitUntil: 'networkidle' });
    await page.waitForTimeout(2000); // Allow time for redirects or dynamic content

    const loginChecks = [
      () => page.locator('.gn_name').isVisible().catch(() => false), // Standard desktop view
      () => page.locator('[node-type="username"]').isVisible().catch(() => false), // Another common username node
      () => page.locator('a[href*="/logout.php"]').isVisible().catch(() => false), // Logout link often indicates login
      () => page.url().includes('/home') || (page.url().includes('weibo.com/') && !page.url().includes('login') && !page.url().includes('passport')),
      () => page.locator('.woo-font--nickname').isVisible().catch(() => false), // Newer UI elements
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
      const currentUserAgent = await page.evaluate(() => navigator.userAgent); // Get the actual user agent from the browser

      if (env.WEIBO_KV) {
        await env.WEIBO_KV.put(`login:${sessionId}`, JSON.stringify({
          sessionId,
          cookies: cookieString,
          loginTime: Date.now(),
          userAgent: currentUserAgent
        }), { expirationTtl: 86400 * 7 }); // 7 days
      }

      await browser.close();
      return new Response('登录成功', { headers: corsHeaders });
    }

    // If not logged in, check if QR is still valid or expired (this logic might be more complex)
    // For now, just indicate still waiting if not explicitly logged in.
    // The QR expiration is primarily handled by the client-side timeout for re-fetching.
    // We could also check the KV store for the QR session status if needed.
    const qrSessionDataStr = env.WEIBO_KV ? await env.WEIBO_KV.get(`session:${sessionId}`) : null;
    if (!qrSessionDataStr) {
        await browser.close();
        return new Response('二维码已过期或会话无效', { headers: corsHeaders });
    }

    await browser.close();
    return new Response('等待扫描...', { headers: corsHeaders });

  } catch (error: any) {
    await browser.close(); // Ensure browser is closed on error
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

  let loginInfo: { sessionId: string; cookies: string; loginTime: number; userAgent: string; } | null = null;
  if (env.WEIBO_KV) {
    const loginInfoStr = await env.WEIBO_KV.get(`login:${body.sessionId}`);
    if (loginInfoStr) {
      loginInfo = JSON.parse(loginInfoStr);
    }
  }

  if (!loginInfo || !loginInfo.cookies) { // Check for cookies specifically
    return new Response('未登录或登录信息不完整，请先登录', { status: 401, headers: corsHeaders });
  }

  const browser = await launch(env.MYBROWSER);
  const newPageOptions: { userAgent?: string } = {};
  if (loginInfo.userAgent) {
    newPageOptions.userAgent = loginInfo.userAgent;
  }
  const page = await browser.newPage(newPageOptions);

  try {
    // User-Agent is now set via newPage options

    const cookiesArray = loginInfo.cookies.split('; ').map((cookie: string) => {
      const [name, ...valueParts] = cookie.split('=');
      const value = valueParts.join('=');
      // Ensure domain is correct, typically .weibo.com or m.weibo.cn
      let domain = '.weibo.com';
      if (name === 'SUB' || name === 'SUBP' || name === 'ALF' || name === 'SSOLoginState') {
          domain = '.weibo.com'; // Common login cookies
      }
      // Add more specific domains if needed based on observed cookies
      return { name, value, domain, path: '/' };
    });
    
    await page.context().addCookies(cookiesArray);
    
    await page.goto('https://weibo.com/', { timeout: 15000, waitUntil: 'networkidle' });
    await page.waitForTimeout(3000); // Wait for dynamic elements to load

    // Simplified check for login after setting cookies
    const isLoggedIn = await page.locator('.gn_name').isVisible({ timeout: 5000 }).catch(() => false) ||
                       await page.locator('[node-type="username"]').isVisible({ timeout: 5000 }).catch(() => false) ||
                       await page.locator('.woo-font--nickname').isVisible({ timeout: 5000 }).catch(() => false);

    if (!isLoggedIn) {
      await browser.close();
      // Optionally, delete the stale login info from KV
      // if (env.WEIBO_KV) { await env.WEIBO_KV.delete(`login:${body.sessionId}`); }
      return new Response('登录已过期或Cookie无效，请重新登录', { status: 401, headers: corsHeaders });
    }

    const textAreaSelectors = [
      'textarea[node-type="textareacontent"]', // Common for new UI
      'textarea[title="微博输入框"]',
      'textarea[placeholder*="有什么新鲜事"]',
      'textarea[placeholder*="分享你的新鲜事"]',
      '.Form_input_2gt3L', // Another possible class for textarea wrapper
      'textarea.W_input',
    ];

    let textArea: any = null; // Using 'any' for Playwright Locator type simplicity here
    for (const selector of textAreaSelectors) {
      try {
        const element = page.locator(selector);
        if (await element.isVisible({ timeout: 3000 })) {
          textArea = element;
          break;
        }
      } catch (e) { continue; }
    }

    if (!textArea) {
      const screenshot = await page.screenshot({ fullPage: true });
      const base64 = btoa(String.fromCharCode(...new Uint8Array(screenshot)));
      console.error("未找到发布框。页面截图base64:", base64.substring(0,100) + "..."); // Log a snippet
      await browser.close();
      return new Response('未找到发布框，页面可能已更新。请检查选择器。', { status: 500, headers: corsHeaders });
    }

    await textArea.fill(body.content);
    await page.waitForTimeout(1000);

    const submitSelectors = [
      '.button.woo-button-primary.woo-button-m.woo-button-round', // Common new UI button
      'button[type="button"] span:has-text("发布")', // More specific new UI
      '.woo-button-wrap span:has-text("发布")',
      'a[node-type="submit"]',
      '.W_btn_a[title*="发布"]',
      'button.btn_default:has-text("发布")'
    ];

    let submitBtn: any = null;
    for (const selector of submitSelectors) {
      try {
        // Try to get a specific button if multiple exist
        const buttons = await page.locator(selector).all();
        for(const btn of buttons) {
            if (await btn.isVisible({ timeout: 2000 }) && await btn.isEnabled({ timeout: 2000 })) {
                 // Check if it's the main post button, e.g., by text or specific attribute
                 const text = await btn.innerText().catch(() => "");
                 if (text.trim() === "发布") {
                    submitBtn = btn;
                    break;
                 }
                 // Fallback to the first visible and enabled button if specific text match fails
                 if (!submitBtn) submitBtn = btn;
            }
        }
        if (submitBtn) break;

      } catch (e) { continue; }
    }
    
    if (!submitBtn) {
      const screenshot = await page.screenshot({ fullPage: true });
      const base64 = btoa(String.fromCharCode(...new Uint8Array(screenshot)));
      console.error("未找到发布按钮。页面截图base64:", base64.substring(0,100) + "...");
      await browser.close();
      return new Response('未找到发布按钮，页面可能已更新。请检查选择器。', { status: 500, headers: corsHeaders });
    }

    await submitBtn.click();
    await page.waitForTimeout(5000); // Increased wait time for post to complete and page to update

    // Check for success indicators (these are highly volatile)
    const successIndicators = [
        () => page.locator('div[role="alert"]:has-text("发送成功")').isVisible({timeout: 3000}).catch(()=>false),
        () => page.locator('.toast_text:has-text("发送成功")').isVisible({timeout: 3000}).catch(()=>false), // Mobile-like toast
        () => page.locator('.woo-pop-toast--success').isVisible({timeout: 3000}).catch(()=>false), // Newer toast
        // Check if the new post appears on the timeline (more robust but complex)
        // For example, find an article/div containing body.content. This requires body.content to be unique enough.
    ];

    let isSuccess = false;
    for (const check of successIndicators) {
        if (await check()) {
            isSuccess = true;
            break;
        }
    }
    // If no direct success message, a less certain check is if no obvious error message appears
    // and the URL hasn't redirected to an error page. This is not very reliable.
    if (!isSuccess && !page.url().includes('error')) { // Very weak check
        // Could also check if the textarea is cleared or gone
        const textAreaStillVisible = await textArea.isVisible().catch(()=>true);
        if (!textAreaStillVisible) {
             // isSuccess = true; // Tentative success if textarea is gone
        }
    }


    await browser.close();
    
    if (isSuccess) {
      return new Response('发布成功', { headers: corsHeaders });
    } else {
      // It's possible it posted but we couldn't detect it.
      return new Response('发布操作已执行，但未能明确确认成功状态。请检查微博。', { headers: corsHeaders });
    }

  } catch (error: any) {
    await browser.close(); // Ensure browser is closed on error
    const screenshot = await page.screenshot({ fullPage: true }).catch(() => null); // Try to get screenshot on error
    if (screenshot) {
        const base64 = btoa(String.fromCharCode(...new Uint8Array(screenshot)));
        console.error(`发布失败: ${error.message}. Screenshot base64:`, base64.substring(0,100) + "...");
    } else {
        console.error(`发布失败: ${error.message}. Screenshot failed.`);
    }
    return new Response(`发布失败: ${error.message}`, { 
      status: 500, 
      headers: corsHeaders 
    });
  }
}
