import { launch } from '@cloudflare/playwright';

// Define interfaces for environment variables and request body
interface Env {
  MYBROWSER: any; // Binding to the Browser Worker
  WEIBO_KV: any;  // KV namespace binding
}

interface PostRequestBody {
  content: string;
  sessionId: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: any): Promise<Response> {
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
          const sessionParam = url.searchParams.get('session');
          if (!sessionParam) {
            return new Response('Session parameter is missing', { status: 400, headers: corsHeaders });
          }
          return await checkLogin(sessionParam, env, corsHeaders);
        case '/post':
          return await postWeibo(request, env, corsHeaders);
        default:
          return new Response('Not Found', { status: 404, headers: corsHeaders });
      }
    } catch (error: any) {
      console.error(`Error in main fetch: ${error.stack}`);
      return new Response(`Error: ${error.message}`, {
        status: 500,
        headers: corsHeaders
      });
    }
  },
};

// Function to return the login HTML page
function getLoginPage(corsHeaders: any): Response {
  const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>微博登录</title>
    <style>
        body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; background-color: #f0f2f5; color: #333; }
        .container { text-align: center; background-color: #fff; padding: 30px; border-radius: 10px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
        h1 { color: #1da1f2; margin-bottom: 20px; }
        h3 { color: #555; margin-top: 20px; }
        .qr-container { margin: 20px 0; padding: 20px; border: 1px solid #ddd; border-radius: 8px; background-color: #fafafa; }
        button { padding: 12px 25px; margin: 10px; background: #1da1f2; color: white; border: none; border-radius: 5px; cursor: pointer; font-size: 16px; transition: background-color 0.3s ease; }
        button:hover { background: #0c85d0; }
        #qrCode { min-height: 150px; display: flex; align-items: center; justify-content: center; margin: 20px auto; }
        #qrCode img { max-width: 250px; border: 1px solid #eee; border-radius: 4px;}
        #status { margin: 15px 0; font-weight: bold; color: #333; min-height: 20px; }
        .post-form { margin-top: 30px; padding: 20px; border: 1px solid #ddd; border-radius: 8px; display: none; background-color: #fafafa; }
        textarea { width: calc(100% - 22px); height: 100px; margin: 10px 0; padding: 10px; border: 1px solid #ccc; border-radius: 4px; font-size: 14px; }
        #postStatus { margin-top: 10px; font-weight: bold; min-height: 20px;}
        .loader { border: 4px solid #f3f3f3; border-top: 4px solid #1da1f2; border-radius: 50%; width: 30px; height: 30px; animation: spin 1s linear infinite; margin: 10px auto;}
        @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
    </style>
</head>
<body>
    <div class="container">
        <h1>微博自动登录与发布</h1>
        
        <div class="qr-container">
            <h3>扫码登录</h3>
            <button onclick="getQRCode()">获取二维码</button>
            <div id="qrCode"><p>请点击按钮获取二维码</p></div>
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

        function showLoader(elementId) {
            document.getElementById(elementId).innerHTML = '<div class="loader"></div>';
        }

        function hideLoader(elementId) {
             document.getElementById(elementId).innerHTML = '';
        }

        async function getQRCode() {
            try {
                document.getElementById('status').textContent = '正在获取二维码...';
                showLoader('qrCode');
                const response = await fetch('/qr');
                const resultText = await response.text(); // Always get text first
                
                if (response.ok) {
                    document.getElementById('qrCode').innerHTML = resultText;
                    // Try to extract session ID if it's embedded in the HTML response from /qr
                    // This assumes the /qr endpoint embeds the session ID in a specific way.
                    // If using hidden input:
                    const hiddenInput = document.querySelector('#qrCode input[type="hidden"][id^="sessionId_"]');
                    if (hiddenInput) {
                         sessionId = hiddenInput.value;
                    } else {
                        // Fallback if sessionId is passed differently, e.g. via a script tag setting a global var
                        // This part might need adjustment based on how /qr actually provides the sessionId to the client
                        const scriptTag = document.querySelector('#qrCode script');
                        if (scriptTag && scriptTag.textContent.includes('window.parent.sessionId')) {
                            const match = scriptTag.textContent.match(/window\\.parent\\.sessionId = '([^']+)';/);
                            if (match && match[1]) sessionId = match[1];
                        }
                    }

                    if (sessionId) {
                        startChecking();
                        document.getElementById('status').textContent = '请使用微博APP扫描二维码';
                    } else {
                         document.getElementById('status').textContent = '获取成功，但未能提取会话ID。请检查/qr响应。';
                         console.warn("Session ID could not be extracted from /qr response:", resultText);
                    }
                } else {
                    document.getElementById('status').textContent = '获取二维码失败: ' + resultText;
                    hideLoader('qrCode');
                }
            } catch (error) {
                document.getElementById('status').textContent = '网络错误: ' + error.message;
                console.error('Error fetching QR code:', error);
                hideLoader('qrCode');
            }
        }

        function startChecking() {
            if (checkInterval) clearInterval(checkInterval); // Clear existing interval if any
            document.getElementById('status').textContent = '请使用微博APP扫描二维码...';
            checkInterval = setInterval(checkLoginStatus, 3000);
        }

        async function checkLoginStatus() {
            if (!sessionId) {
                console.log('No session ID, skipping login check.');
                return;
            }
            
            try {
                const response = await fetch(\`/check?session=\${sessionId}\`);
                const result = await response.text();
                document.getElementById('status').textContent = result; // Display current status
                
                if (result.includes('登录成功')) {
                    clearInterval(checkInterval);
                    document.getElementById('status').textContent = '登录成功！';
                    document.querySelector('.qr-container').style.display = 'none';
                    document.getElementById('postForm').style.display = 'block';
                } else if (result.includes('已过期')) {
                    clearInterval(checkInterval);
                    document.getElementById('status').textContent = '二维码已过期，请重新获取';
                } else if (result.includes('已扫描')) {
                    document.getElementById('status').textContent = '已扫描，请在手机上确认登录...';
                }
            } catch (error) {
                console.error('检查登录状态失败:', error);
                // Optionally, update status on error, or stop polling if too many errors
                // document.getElementById('status').textContent = '检查登录状态时发生错误。';
            }
        }

        async function postWeibo() {
            const content = document.getElementById('content').value.trim();
            if (!content) {
                // Replace alert with a custom message display
                document.getElementById('postStatus').textContent = '请输入微博内容';
                document.getElementById('postStatus').style.color = 'red';
                return;
            }
            if (!sessionId) {
                 document.getElementById('postStatus').textContent = '会话ID丢失，请重新登录。';
                 document.getElementById('postStatus').style.color = 'red';
                 return;
            }

            try {
                document.getElementById('postStatus').textContent = '正在发布...';
                document.getElementById('postStatus').style.color = 'inherit';
                showLoader('postStatus');

                const response = await fetch('/post', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ content, sessionId })
                });
                
                const result = await response.text();
                hideLoader('postStatus');
                document.getElementById('postStatus').textContent = result;
                
                if (response.ok && result.includes('成功')) {
                    document.getElementById('content').value = '';
                    document.getElementById('postStatus').style.color = 'green';
                } else {
                    document.getElementById('postStatus').style.color = 'red';
                }
            } catch (error) {
                hideLoader('postStatus');
                document.getElementById('postStatus').textContent = '发布失败: ' + error.message;
                document.getElementById('postStatus').style.color = 'red';
                console.error('Error posting Weibo:', error);
            }
        }
    </script>
</body>
</html>`;

  return new Response(html, {
    headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' }
  });
}


// Function to get QR code using Playwright
async function getQRCode(env: Env, corsHeaders: any): Promise<Response> {
  let browser;
  try {
    browser = await launch(env.MYBROWSER); // env.MYBROWSER is the binding to the Browser Worker
    const page = await browser.newPage();
    page.setDefaultTimeout(45000); // Increased default timeout

    console.log('Navigating to Weibo login page...');
    await page.goto('https://weibo.com/login.php', { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(5000); // Wait for potential dynamic content loading

    // Attempt to click the QR code login tab
    const qrTabSelectors = [
      'a[node-type="qrcodeTab"]', // Official QR tab node-type
      '.login_tab_list > a:nth-child(2)', // Second tab, often QR
      'text=/二维码登录|扫码登录/i', // Text based selector
      '.info_list li:has-text("二维码")',
      '.info_list li:has-text("扫码")',
    ];
    
    let qrTabClicked = false;
    for (const selector of qrTabSelectors) {
      try {
        const element = page.locator(selector).first();
        if (await element.isVisible({ timeout: 5000 })) {
          console.log(`Clicking QR tab with selector: ${selector}`);
          await element.click({ timeout: 5000 });
          await page.waitForTimeout(3000); // Wait for QR code to load after click
          qrTabClicked = true;
          break;
        }
      } catch (e: any) {
        console.log(`Attempting to click QR tab selector failed: ${selector}, Error: ${e.message}`);
      }
    }

    if (!qrTabClicked) {
        console.log("Could not find or click a QR code tab. Proceeding to find QR code directly.");
    }
    
    await page.waitForTimeout(3000); // Additional wait for QR code to ensure it's loaded

    // Attempt to find the QR code image or canvas
    const qrSelectors = [
      '.login_qrimg img', // Common selector for QR image
      '.qrcode_wrap img', // Another common wrapper
      'img[src*="qr"]',
      'img[alt*="二维码"]',
      '.W_login_qrcode img',
      'canvas[id*="qr"]',
      '[class*="qrcode"] img',
    ];

    let qrElement = null;
    let debugInfo = `QR Tab Clicked: ${qrTabClicked}. Page URL: ${page.url()}. `;

    for (const selector of qrSelectors) {
      try {
        const elements = page.locator(selector);
        const count = await elements.count();
        debugInfo += `${selector}: ${count} elements; `;
        if (count > 0) {
          const element = elements.first(); // Take the first one found
          if (await element.isVisible({ timeout: 5000 })) {
            qrElement = element;
            console.log(`Found QR element with selector: ${selector}`);
            break;
          }
        }
      } catch (e: any) {
        console.log(`QR element selector failed: ${selector}, Error: ${e.message}`);
      }
    }

    if (!qrElement) {
      console.log('QR element not found with specific selectors. Taking full page screenshot for debugging.');
      const fullScreenshot = await page.screenshot();
      // Convert Uint8Array to Base64
      let binary = '';
      const bytes = new Uint8Array(fullScreenshot);
      const len = bytes.byteLength;
      for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const fullBase64 = btoa(binary);
      
      await browser.close();
      
      const debugHtml = `
        <div style="text-align: center;">
          <h3>无法定位二维码 - 请检查截图</h3>
          <p>调试信息: ${debugInfo}</p>
          <p>请检查下面的截图，确认二维码是否可见以及其位置。微博页面结构可能已更改。</p>
          <img src="data:image/png;base64,${fullBase64}" alt="页面截图" style="max-width: 90%; border: 1px solid #ccc; margin-top:10px;">
        </div>`;
      return new Response(debugHtml, {
        headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' },
        status: 404 // Not found essentially
      });
    }

    // Screenshot the QR element
    const qrScreenshot = await qrElement.screenshot();
    let qrBinary = '';
    const qrBytes = new Uint8Array(qrScreenshot);
    const qrLen = qrBytes.byteLength;
    for (let i = 0; i < qrLen; i++) {
        qrBinary += String.fromCharCode(qrBytes[i]);
    }
    const qrBase64 = btoa(qrBinary);
    
    // Generate a unique session ID for this QR code instance
    const sessionId = `qr_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;

    // Store minimal session state in KV (e.g., that QR was generated)
    // The actual login state (cookies) will be stored in checkLogin upon success
    if (env.WEIBO_KV) {
      await env.WEIBO_KV.put(`qr_session:${sessionId}`, JSON.stringify({
        sessionId,
        createTime: Date.now(),
        status: 'waiting_scan' // Initial status
      }), { expirationTtl: 300 }); // QR codes typically expire in a few minutes
    }

    await browser.close();

    // Return HTML containing the QR code image and the session ID
    const html = `
      <div style="text-align: center;">
        <img src="data:image/png;base64,${qrBase64}" alt="微博登录二维码" style="max-width: 250px; border: 1px solid #ddd; border-radius: 4px;">
        <input type="hidden" id="sessionId_${sessionId}" value="${sessionId}">
        <script>
          if (window.parent && typeof window.parent.getQRCode === 'function') {
            // More robust way to pass sessionId back if this is in an iframe
            // For the current setup, the client-side JS extracts it directly.
          }
          // The client-side JS in getLoginPage will attempt to find this session ID
        </script>
      </div>`;

    return new Response(html, {
      headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' }
    });

  } catch (error: any) {
    console.error(`Error in getQRCode: ${error.stack}`);
    if (browser) await browser.close();
    return new Response(`获取二维码失败: ${error.message}`, {
      status: 500,
      headers: corsHeaders
    });
  }
}

// Function to check login status
async function checkLogin(sessionId: string, env: Env, corsHeaders: any): Promise<Response> {
  if (!sessionId) {
    return new Response('缺少会话ID (session ID)', { status: 400, headers: corsHeaders });
  }

  let browser;
  try {
    // Check KV first for an existing QR session status
    let sessionData = null;
    if (env.WEIBO_KV) {
        const qrSessionStr = await env.WEIBO_KV.get(`qr_session:${sessionId}`);
        if (qrSessionStr) {
            sessionData = JSON.parse(qrSessionStr);
            if (sessionData.status === 'login_confirmed') {
                 // If already confirmed by another check, no need to launch browser
                return new Response('登录成功', { headers: corsHeaders });
            }
        } else {
            // If no QR session, it might be an old session ID or invalid
            return new Response('会话无效或已过期', { status: 404, headers: corsHeaders });
        }
    }

    browser = await launch(env.MYBROWSER);
    const page = await browser.newPage();
    page.setDefaultTimeout(30000);

    // It's tricky to check login status without the context of the QR scan.
    // Weibo's QR login flow updates the page where the QR was displayed.
    // A more robust way is to rely on the page that displayed the QR code to detect the change.
    // However, if we must check independently:
    // 1. Go to a page that requires login.
    // 2. Check if redirected to login or if user info is present.
    // This approach is less reliable for QR specifically as the state is tied to the QR display page.

    // For QR code, the status is usually on the QR code page itself.
    // This function is called by the client polling. The client *has* the QR code.
    // The server-side check here is more about *confirming* if the scan led to a cookie state.
    // A better approach: the page that showed the QR code should detect the "scanned" and "confirmed" states.
    // This function might be simplified or re-purposed.

    // Let's assume we need to check if *any* Weibo session is active post-scan.
    // This is a generic login check, not strictly tied to the QR code's specific page instance.
    await page.goto('https://weibo.com/home', { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(3000);

    const isLoggedIn = await page.locator('a[href*="/logout.php"]').or(page.locator('.gn_name')).isVisible({timeout: 5000}).catch(() => false);

    if (isLoggedIn) {
      const cookies = await page.context().cookies();
      const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

      if (env.WEIBO_KV) {
        await env.WEIBO_KV.put(`login_session:${sessionId}`, JSON.stringify({ // Store as login_session
          sessionId,
          cookies: cookieString,
          loginTime: Date.now()
        }), { expirationTtl: 86400 * 7 }); // Store for 7 days

        // Update QR session status as well
        await env.WEIBO_KV.put(`qr_session:${sessionId}`, JSON.stringify({
            ...(sessionData || { sessionId, createTime: Date.now() }), // keep existing data or create new
            status: 'login_confirmed',
            loginTime: Date.now()
        }), { expirationTtl: 300 }); // QR session can expire sooner
      }
      await browser.close();
      return new Response('登录成功', { headers: corsHeaders });
    }

    // If not logged in, check the original QR page status (this is difficult without the original page context)
    // The client-side polling is better for "已扫描", "已过期" messages next to the QR.
    // This server-side check is more for "did login succeed and give us cookies".
    
    // Fallback status if not loggedIn
    let statusMessage = '等待扫描或确认...';
    if (sessionData) {
        if (sessionData.status === 'waiting_scan') statusMessage = '等待扫描...';
        // Add more specific statuses based on what the client might see on the QR page
        // e.g., if the QR code itself has expired, the client would see that.
        // This function is less about the QR visual status and more about cookie acquisition.
    }


    await browser.close();
    return new Response(statusMessage, { headers: corsHeaders });

  } catch (error: any) {
    console.error(`Error in checkLogin: ${error.stack}`);
    if (browser) await browser.close();
    return new Response(`检查登录状态失败: ${error.message}`, {
      status: 500,
      headers: corsHeaders
    });
  }
}

// Function to post a Weibo status
async function postWeibo(request: Request, env: Env, corsHeaders: any): Promise<Response> {
  let browser;
  try {
    const body = await request.json() as PostRequestBody;
    if (!body.content || !body.sessionId) {
      return new Response('缺少微博内容或会话ID', { status: 400, headers: corsHeaders });
    }

    let loginInfoStr: string | null = null;
    if (env.WEIBO_KV) {
      loginInfoStr = await env.WEIBO_KV.get(`login_session:${body.sessionId}`);
    }

    if (!loginInfoStr) {
      return new Response('未登录或会话已过期，请先登录', { status: 401, headers: corsHeaders });
    }
    const loginInfo = JSON.parse(loginInfoStr);

    browser = await launch(env.MYBROWSER);
    const context = await browser.newContext(); // No user-agent here
    const page = await context.newPage();
    page.setDefaultTimeout(30000);

    // Set cookies
    const cookiesArray = loginInfo.cookies.split('; ').map((cookie: string) => {
      const [name, ...valueParts] = cookie.split('=');
      const value = valueParts.join('='); // Handle cases where value might contain '='
      return { name, value, domain: '.weibo.com', path: '/' };
    });
    await context.addCookies(cookiesArray);

    console.log('Navigating to Weibo main page for posting...');
    await page.goto('https://weibo.com/', { waitUntil: 'networkidle', timeout: 25000 });
    await page.waitForTimeout(3000); // Wait for page to settle

    // Verify login status again with cookies
    const isLoggedIn = await page.locator('a[href*="/logout.php"]').or(page.locator('.gn_name')).isVisible({timeout: 5000}).catch(() => false);
    if (!isLoggedIn) {
      console.log('Login check failed after setting cookies. Cookies might be invalid or expired.');
      await browser.close();
      // Optionally, delete the stale KV entry
      // if (env.WEIBO_KV) { await env.WEIBO_KV.delete(`login_session:${body.sessionId}`); }
      return new Response('使用存储的凭据登录失败，请重新登录', { status: 401, headers: corsHeaders });
    }
    console.log('Successfully logged in with stored cookies.');

    // Locate textarea and post button
    const textAreaSelectors = [
        'textarea[title="微博输入框"]',
        'textarea[node-type="textEl"]', // Common node-type for textarea
        'textarea[placeholder*="新鲜事"]',
    ];
    let textArea = null;
    for(const selector of textAreaSelectors) {
        const el = page.locator(selector).first();
        if (await el.isVisible({timeout: 3000})) {
            textArea = el;
            console.log(`Found textarea with selector: ${selector}`);
            break;
        }
    }
    if (!textArea) {
        throw new Error('无法找到微博输入框。页面结构可能已更改。');
    }
    
    await textArea.fill(body.content);
    await page.waitForTimeout(1000); // Wait for any JS listeners on fill

    const submitBtnSelectors = [
        'a[node-type="submit"]', // Common node-type for submit
        '.W_btn_a[title="发布"]',
        'button:has-text("发布")',
    ];
    let submitBtn = null;
    for(const selector of submitBtnSelectors) {
        const el = page.locator(selector).first();
        if (await el.isEnabled({timeout: 3000})) { // Check if enabled too
            submitBtn = el;
            console.log(`Found submit button with selector: ${selector}`);
            break;
        }
    }
    if (!submitBtn) {
        throw new Error('无法找到发布按钮。页面结构可能已更改。');
    }

    await submitBtn.click();
    console.log('Submit button clicked. Waiting for post confirmation...');
    
    // Wait for confirmation (e.g., textarea clears, or a success message appears)
    // This part is tricky as confirmation varies. A timeout is a simpler approach for now.
    await page.waitForTimeout(5000); // Increased wait time for post to complete

    // More robust: check if textarea is cleared or a success message appears
    // const isCleared = await textArea.inputValue() === '';
    // if (isCleared) console.log("Textarea cleared, assuming post successful.");
    // else console.log("Textarea not cleared, post might have failed silently or is taking longer.");


    await browser.close();
    return new Response('微博发布成功 (已发送请求)', { headers: corsHeaders }); // Changed to reflect action taken

  } catch (error: any) {
    console.error(`Error in postWeibo: ${error.stack}`);
    if (browser) await browser.close();
    return new Response(`发布微博失败: ${error.message}`, {
      status: 500,
      headers: corsHeaders
    });
  }
}
