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

/**
 * Helper function to extract a URL parameter.
 * @param urlString The URL string.
 * @param param The parameter name to extract.
 * @returns The parameter value or null if not found.
 */
function getUrlParam(urlString: string, param: string): string | null {
    try {
        const urlObj = new URL(urlString);
        return urlObj.searchParams.get(param);
    } catch (e) {
        console.error(`Error parsing URL: ${urlString}`, e);
        return null;
    }
}

/**
 * Returns the HTML for the login page.
 * @param corsHeaders CORS headers for the response.
 * @returns A Response object containing the HTML.
 */
function getLoginPage(corsHeaders: any): Response {
    const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>微博登录</title>
    <style>
        body { font-family: 'Inter', Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; background-color: #f0f2f5; color: #333; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); }
        .container { text-align: center; padding: 20px; }
        h1, h3 { color: #1da1f2; margin-bottom: 20px; }
        .qr-container, .post-form { margin: 20px 0; padding: 25px; border: 1px solid #e0e0e0; border-radius: 10px; background-color: #fff; box-shadow: 0 2px 8px rgba(0,0,0,0.05); }
        button { padding: 12px 25px; margin: 10px; background: linear-gradient(45deg, #1da1f2, #0d8bd9); color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 16px; font-weight: bold; transition: all 0.3s ease; box-shadow: 0 4px 8px rgba(29,161,242,0.3); }
        button:hover { transform: translateY(-2px); box-shadow: 0 6px 12px rgba(29,161,242,0.4); }
        #qrCode img { max-width: 280px; height: auto; margin: 20px auto; border: 4px solid #1da1f2; border-radius: 8px; display: block; }
        #status, #postStatus { margin: 15px 0; font-weight: bold; color: #555; font-size: 1.1em; }
        .post-form { display: none; } /* Hidden by default */
        textarea { width: calc(100% - 20px); height: 120px; margin: 15px 0; padding: 12px; border: 1px solid #ccc; border-radius: 8px; font-size: 1em; resize: vertical; box-sizing: border-box; }
        textarea:focus { border-color: #1da1f2; outline: none; box-shadow: 0 0 5px rgba(29,161,242,0.3); }
        .message-box {
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background-color: white;
            padding: 25px;
            border-radius: 10px;
            box-shadow: 0 5px 15px rgba(0,0,0,0.3);
            z-index: 1000;
            display: none; /* Hidden by default */
            text-align: center;
            font-family: 'Inter', Arial, sans-serif;
            color: #333;
        }
        .message-box button {
            background: #1da1f2;
            color: white;
            border: none;
            padding: 8px 15px;
            margin-top: 15px;
            border-radius: 5px;
            cursor: pointer;
        }
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

    <div id="messageBox" class="message-box">
        <p id="messageText"></p>
        <button onclick="document.getElementById('messageBox').style.display='none'">确定</button>
    </div>

    <script>
        let sessionId = null;
        let checkInterval = null;

        function showMessage(text) {
            document.getElementById('messageText').textContent = text;
            document.getElementById('messageBox').style.display = 'block';
        }

        async function getQRCode() {
            try {
                document.getElementById('status').textContent = '正在获取二维码...';
                document.getElementById('qrCode').innerHTML = ''; // Clear previous QR
                document.getElementById('postForm').style.display = 'none'; // Hide post form
                clearInterval(checkInterval); // Clear any existing interval

                const response = await fetch('/qr');
                const result = await response.text();

                if (response.ok) {
                    document.getElementById('qrCode').innerHTML = result;
                    // Extract sessionId from the returned HTML (it's injected by the worker)
                    const tempDiv = document.createElement('div');
                    tempDiv.innerHTML = result;
                    const sessionIdInput = tempDiv.querySelector('#sessionId');
                    if (sessionIdInput) {
                        sessionId = sessionIdInput.value;
                        startChecking();
                    } else {
                        document.getElementById('status').textContent = '获取二维码失败: 无法提取会话ID';
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
            if (checkInterval) clearInterval(checkInterval); // Ensure only one interval runs
            checkInterval = setInterval(checkLoginStatus, 3000); // Poll every 3 seconds
        }

        async function checkLoginStatus() {
            if (!sessionId) {
                clearInterval(checkInterval);
                document.getElementById('status').textContent = '会话ID丢失，请重新获取二维码';
                return;
            }

            try {
                const response = await fetch(`/check?session=${sessionId}`);
                const result = await response.text();

                if (result.includes('登录成功')) {
                    clearInterval(checkInterval);
                    document.getElementById('status').textContent = '登录成功！';
                    document.getElementById('postForm').style.display = 'block'; // Show post form
                } else if (result.includes('已过期')) {
                    clearInterval(checkInterval);
                    document.getElementById('status').textContent = '二维码已过期，请重新获取';
                    sessionId = null; // Clear session ID
                } else {
                    document.getElementById('status').textContent = result; // e.g., "等待扫描..."
                }
            } catch (error) {
                console.error('检查登录状态失败:', error);
                // document.getElementById('status').textContent = '检查登录状态失败: ' + error.message; // Avoid overwhelming user with network errors during polling
            }
        }

        async function postWeibo() {
            const content = document.getElementById('content').value.trim();
            if (!content) {
                showMessage('请输入微博内容');
                return;
            }

            if (!sessionId) {
                showMessage('请先登录微博');
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
                    document.getElementById('content').value = ''; // Clear content on success
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

/**
 * Generates a Weibo QR code for login.
 * Launches Playwright, navigates to the Weibo mobile login page, extracts the QR code image URL
 * and the associated 'qr' token, then stores this information in KV.
 * @param env The Cloudflare Worker environment variables (including MYBROWSER and WEIBO_KV).
 * @param corsHeaders CORS headers for the response.
 * @returns A Response object containing the QR code HTML or debug info.
 */
async function getQRCode(env: any, corsHeaders: any): Promise<Response> {
    const browser = await launch(env.MYBROWSER);
    const page = await browser.newPage();

    try {
        page.setDefaultTimeout(30000); // Set a longer timeout for page operations
        // Navigate to Weibo mobile login page, which is more likely to provide a QR code
        await page.goto('https://passport.weibo.cn/signin/login', {
            waitUntil: 'networkidle', // Wait until network is idle
            timeout: 30000
        });
        await page.waitForTimeout(3000); // Wait a bit for dynamic content to load
        await page.waitForLoadState('networkidle'); // Ensure page is fully loaded

        // Define multiple selectors to find the QR code image
        const qrSelectors = [
            'div.relative.border-2 img', // Based on provided HTML structure
            'div.w-45.h-45 img',
            'img[src*="qr.weibo.cn"]', // Common pattern for Weibo QR code URLs
            'img[src*="qrcode"]',
            'img[src*="api_key"]', // Often found in Weibo QR URLs
            'img[alt=""]', // Generic image with empty alt, might be QR
            '.qr img', // Common class names
            '.qrcode img',
        ];

        let qrElement = null;
        let qrSrc = null;

        // Iterate through selectors to find the QR code image
        for (const selector of qrSelectors) {
            try {
                const elements = await page.locator(selector).all();
                for (const element of elements) {
                    // Check visibility and get src attribute
                    if (await element.isVisible({ timeout: 2000 })) {
                        const src = await element.getAttribute('src');
                        // Validate src to ensure it's likely a QR code
                        if (src && (src.includes('qr') || src.includes('api_key'))) {
                            qrElement = element;
                            qrSrc = src;
                            break; // Found QR, break inner loop
                        }
                    }
                }
                if (qrElement) break; // Found QR, break outer loop
            } catch (e) {
                // Continue to next selector if current one fails
                console.warn(`Selector "${selector}" failed: ${e.message}`);
            }
        }

        // Generate a unique session ID for this QR code request
        let sessionId = `qr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        if (qrElement && qrSrc) {
            // Extract the 'qr' token from the 'data' parameter within the qrSrc URL
            const dataParam = getUrlParam(qrSrc, 'data');
            let qrToken = null;
            if (dataParam) {
                // Decode the data parameter to get the inner URL, then extract 'qr'
                qrToken = getUrlParam(decodeURIComponent(dataParam), 'qr');
            }

            if (!qrToken) {
                // If qrToken cannot be extracted, it's a critical error
                throw new Error('未能从二维码URL中提取到qr token，请检查微博页面结构。');
            }

            // HTML to return to the client, displaying the QR code
            const html = `
                <div style="text-align: center;">
                    <img src="${qrSrc}" alt="二维码" style="max-width: 300px; border: 1px solid #ddd;">
                    <input type="hidden" id="sessionId" value="${sessionId}">
                    <script>window.parent.sessionId = '${sessionId}';</script>
                    <p style="margin-top: 10px; font-size: 12px; color: #666;">请使用微博APP扫描二维码</p>
                </div>
            `;

            // Save session information to KV, including the qrToken for status checking
            if (env.WEIBO_KV) {
                await env.WEIBO_KV.put(`session:${sessionId}`, JSON.stringify({
                    sessionId,
                    createTime: Date.now(),
                    status: 'waiting',
                    qrSrc: qrSrc, // Keep qrSrc for display purposes
                    qrToken: qrToken // Store qrToken for polling Weibo's status API
                }), { expirationTtl: 300 }); // QR code typically expires in 5 minutes (300 seconds)
            }

            await browser.close(); // Close the browser instance
            return new Response(html, {
                headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' }
            });
        }

        // If no QR code element was found after trying all selectors, take a screenshot for debugging
        const screenshot = await page.screenshot({ fullPage: true });
        const base64 = btoa(String.fromCharCode(...screenshot)); // Convert screenshot to base64

        await browser.close(); // Close the browser instance

        // Debug HTML to help diagnose why QR code was not found
        const debugHtml = `
            <div style="text-align: center;">
                <h3>调试信息 - 页面截图</h3>
                <p>当前URL: ${page.url()}</p>
                <p>页面标题: ${await page.title()}</p>
                <img src="data:image/png;base64,${base64}" alt="页面截图" style="max-width: 100%; border: 1px solid #ccc;">
                <p style="color: red;">未找到二维码元素，请检查页面是否正确加载或微博页面结构是否发生变化。</p>
            </div>
        `;

        return new Response(debugHtml, {
            headers: { ...corsHeaders, 'Content-Type': 'text/html; charset=utf-8' }
        });

    } catch (error: any) {
        // Ensure browser is closed even if an error occurs
        if (browser) await browser.close();
        return new Response(`获取二维码失败: ${error.message}`, {
            status: 500,
            headers: corsHeaders
        });
    }
}

/**
 * Checks the Weibo login status using the QR token.
 * It polls Weibo's QR status API. If successful, it navigates to weibo.com
 * to capture and store the full authentication cookies in KV.
 * @param sessionId The session ID associated with the QR code.
 * @param env The Cloudflare Worker environment variables.
 * @param corsHeaders CORS headers for the response.
 * @returns A Response object indicating login status.
 */
async function checkLogin(sessionId: string | null, env: any, corsHeaders: any): Promise<Response> {
    if (!sessionId) {
        return new Response('缺少会话ID', { status: 400, headers: corsHeaders });
    }

    let sessionData = null;
    if (env.WEIBO_KV) {
        const sessionDataStr = await env.WEIBO_KV.get(`session:${sessionId}`);
        if (sessionDataStr) {
            sessionData = JSON.parse(sessionDataStr);
        }
    }

    // If session data or qrToken is missing, the QR code was never generated or has expired from KV
    if (!sessionData || !sessionData.qrToken) {
        return new Response('二维码会话已过期或不存在，请重新获取二维码', { status: 400, headers: corsHeaders });
    }

    // First, check if login info (cookies) for this session already exists in KV.
    // This handles cases where login was successful in a previous check.
    let loginInfo = null;
    if (env.WEIBO_KV) {
        const loginInfoStr = await env.WEIBO_KV.get(`login:${sessionId}`);
        if (loginInfoStr) {
            loginInfo = JSON.parse(loginInfoStr);
            if (loginInfo.cookies) {
                // Already logged in and cookies saved, no need to launch Playwright
                return new Response('登录成功', { headers: corsHeaders });
            }
        }
    }

    const browser = await launch(env.MYBROWSER);
    const page = await browser.newPage();

    try {
        // Construct the URL for polling the QR code status API
        // _t parameter is a timestamp to prevent caching
        const qrCheckUrl = `https://passport.weibo.cn/signin/qrcode/check?qr=${sessionData.qrToken}&_t=${Date.now()}`;
        await page.goto(qrCheckUrl, { timeout: 15000, waitUntil: 'domcontentloaded' });

        // Get the response text (usually JSON)
        const responseText = await page.evaluate(() => document.body.textContent);
        let checkResult;
        try {
            checkResult = JSON.parse(responseText || '{}');
        } catch (e) {
            console.error('Failed to parse QR check response as JSON:', responseText, e);
            // Fallback to text-based check if JSON parsing fails (less reliable)
            if (responseText?.includes('成功') || responseText?.includes('SUCCESS')) {
                checkResult = { code: '20000000', data: { status: 'SUCCESS' } };
            } else if (responseText?.includes('过期') || responseText?.includes('EXPIRED')) {
                checkResult = { code: '10000100', data: { status: 'EXPIRED' } };
            } else {
                checkResult = { code: 'UNKNOWN', data: { status: 'WAITING' } };
            }
        }

        // Check the status from the API response
        if (checkResult.code === '20000000' && checkResult.data?.status === 'SUCCESS') {
            // QR code scanned and confirmed. Now navigate to weibo.com to get the final authentication cookies.
            await page.goto('https://weibo.com', { timeout: 15000, waitUntil: 'networkidle' });
            await page.waitForTimeout(2000); // Give some time for redirects and page loading

            // Capture all cookies from the current Playwright context
            const cookies = await page.context().cookies();
            const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

            // Save the login cookies and user agent to KV for future use (e.g., posting)
            if (env.WEIBO_KV) {
                await env.WEIBO_KV.put(`login:${sessionId}`, JSON.stringify({
                    sessionId,
                    cookies: cookieString,
                    loginTime: Date.now(),
                    userAgent: await page.evaluate(() => navigator.userAgent) // Store user agent for consistency
                }), { expirationTtl: 86400 * 7 }); // Store login info for 7 days
            }

            await browser.close();
            return new Response('登录成功', { headers: corsHeaders });
        } else if (checkResult.data?.status === 'EXPIRED') {
            await browser.close();
            // If QR code expired, remove the session data from KV to force a new QR code generation
            if (env.WEIBO_KV) {
                await env.WEIBO_KV.delete(`session:${sessionId}`);
            }
            return new Response('二维码已过期，请重新获取', { headers: corsHeaders });
        } else {
            // Still waiting for scan or other unknown status
            await browser.close();
            return new Response('等待扫描...', { headers: corsHeaders });
        }

    } catch (error: any) {
        // Ensure browser is closed even if an error occurs
        if (browser) await browser.close();
        return new Response(`检查登录状态失败: ${error.message}`, {
            status: 500,
            headers: corsHeaders
        });
    }
}

/**
 * Posts a Weibo message using a previously authenticated session.
 * It retrieves cookies from KV, sets them in a new Playwright instance,
 * navigates to Weibo, finds the post input, fills it, and clicks publish.
 * @param request The incoming request containing content and sessionId.
 * @param env The Cloudflare Worker environment variables.
 * @param corsHeaders CORS headers for the response.
 * @returns A Response object indicating the posting result.
 */
async function postWeibo(request: any, env: any, corsHeaders: any): Promise<Response> {
    const body = await request.json(); // Parse request body as JSON

    if (!body.content || !body.sessionId) {
        return new Response('缺少内容或会话ID', { status: 400, headers: corsHeaders });
    }

    // Retrieve login information (cookies) from KV
    let loginInfo = null;
    if (env.WEIBO_KV) {
        const loginInfoStr = await env.WEIBO_KV.get(`login:${body.sessionId}`);
        if (loginInfoStr) {
            loginInfo = JSON.parse(loginInfoStr);
        }
    }

    if (!loginInfo || !loginInfo.cookies) {
        return new Response('未登录，请先登录', { status: 401, headers: corsHeaders });
    }

    const browser = await launch(env.MYBROWSER);
    const page = await browser.newPage();

    try {
        // Set User-Agent if available from login info for consistency
        if (loginInfo.userAgent) {
            await page.setUserAgent(loginInfo.userAgent);
        }

        // Convert cookie string back to Playwright's cookie array format
        const cookies = loginInfo.cookies.split('; ').map((cookie: string): { name: string, value: string, domain: string, path: string } => {
            const [cookieName, ...valueParts] = cookie.split('='); // Renamed 'name' to 'cookieName'
            const cookieValue = valueParts.join('='); // Renamed 'value' to 'cookieValue'
            // Ensure domain and path are correctly set for all cookies
            return { name: cookieName, value: cookieValue, domain: '.weibo.com', path: '/' };
        });

        await page.context().addCookies(cookies); // Add cookies to the new page context

        // Navigate to Weibo homepage
        await page.goto('https://weibo.com', { timeout: 15000, waitUntil: 'networkidle' });
        await page.waitForTimeout(3000); // Give some time for page to load with cookies

        // Check login status after navigation. This is crucial to ensure cookies are valid.
        const isLoggedIn = await page.locator('.gn_name').isVisible().catch(() => false) ||
                           (page.url().includes('/home') || (page.url().includes('weibo.com') && !page.url().includes('login'))); // Add URL check as backup
        if (!isLoggedIn) {
            await browser.close();
            // If login expired, clear the stored login info from KV
            if (env.WEIBO_KV) {
                await env.WEIBO_KV.delete(`login:${body.sessionId}`);
            }
            return new Response('登录已过期，请重新登录', { status: 401, headers: corsHeaders });
        }

        // Define multiple selectors to find the Weibo post textarea/input
        const textAreaSelectors = [
            'textarea[node-type="text"]',
            'textarea[placeholder*="有什么新鲜事"]',
            'textarea[placeholder*="分享新鲜事"]',
            '.WB_editor_iframe textarea',
            '.send_weibo textarea',
            'textarea[name="text"]',
            'div[contenteditable="true"][action-type="text"]', // Common for rich text editors
            'div[contenteditable="true"][class*="compose"]' // Another common contenteditable pattern
        ];

        let textArea = null;
        for (const selector of textAreaSelectors) {
            try {
                const element = page.locator(selector);
                // Check if the element is visible and enabled
                if (await element.isVisible({ timeout: 3000 }) && await element.isEnabled().catch(() => true)) {
                    textArea = element;
                    break;
                }
            } catch (e) {
                // Continue to next selector if current one fails
                console.warn(`Text area selector "${selector}" failed: ${e.message}`);
            }
        }

        if (!textArea) {
            await browser.close();
            return new Response('未找到微博发布框，页面结构可能已更新。', { status: 500, headers: corsHeaders });
        }

        // Fill the content into the text area
        await textArea.fill(body.content);
        await page.waitForTimeout(1000); // Short pause after filling

        // Define multiple selectors to find the publish button
        const submitSelectors = [
            'a[node-type="submit"]',
            '.W_btn_a[title*="发布"]',
            'button[title*="发布"]',
            '.send_btn',
            '.W_btn_a[action-type="submit"]',
            'a.W_btn_a[action-type="publish"]', // Specific for publish button
            'a.W_btn_a.btn_bed' // Another common button class
        ];

        let submitBtn = null;
        for (const selector of submitSelectors) {
            try {
                const element = page.locator(selector);
                // Check if the element is visible and enabled
                if (await element.isVisible({ timeout: 2000 }) && await element.isEnabled().catch(() => true)) {
                    submitBtn = element;
                    break;
                }
            } catch (e) {
                // Continue to next selector if current one fails
                console.warn(`Submit button selector "${selector}" failed: ${e.message}`);
            }
        }

        if (!submitBtn) {
            await browser.close();
            return new Response('未找到微博发布按钮，页面结构可能已更新。', { status: 500, headers: corsHeaders });
        }

        // Click the publish button
        await submitBtn.click();
        await page.waitForTimeout(3000); // Wait for the post to process and page to update

        // Check for success indicators after clicking publish
        const successIndicators = [
            () => page.locator('.W_tips_success').isVisible().catch(() => false), // Green success tip
            () => page.locator('.tips[node-type="success"]').isVisible().catch(() => false),
            () => page.url().includes('/home') || page.url().includes('/u/'), // Check if redirected to profile/home page
            async () => { // More robust check: reload and see if the post text appears on timeline
                try {
                    await page.reload({ waitUntil: 'networkidle' });
                    // Look for the first 20 characters of the posted content
                    const postTextVisible = await page.locator(`text=${body.content.substring(0, Math.min(body.content.length, 20))}`).isVisible({ timeout: 5000 }).catch(() => false);
                    return postTextVisible;
                } catch (reloadError) {
                    console.warn('Failed to reload page for post verification:', reloadError);
                    return false;
                }
            }
        ];

        let isSuccess = false;
        for (const check of successIndicators) {
            if (await check()) {
                isSuccess = true;
                break;
            }
        }

        await browser.close(); // Close the browser instance

        if (isSuccess) {
            return new Response('发布成功', { headers: corsHeaders });
        } else {
            // If not clearly successful, log page content for debugging
            const pageContent = await page.content();
            console.error('微博发布可能失败，页面内容:', pageContent);
            return new Response('发布可能失败，请检查。', { headers: corsHeaders });
        }

    } catch (error: any) {
        // Ensure browser is closed even if an error occurs
        if (browser) await browser.close();
        return new Response(`发布失败: ${error.message}`, {
            status: 500,
            headers: corsHeaders
        });
    }
}
