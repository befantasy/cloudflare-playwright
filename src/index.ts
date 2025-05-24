import { launch } from '@cloudflare/playwright';
import { expect } from '@cloudflare/playwright/test';

export default {
  async fetch(request: any, env: any): Promise<Response> {
    // 设置CORS头
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    // 处理预检请求
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      if (request.method === 'POST') {
        return await handlePost(request, env, corsHeaders);
      } else {
        return await handleGet(request, env, corsHeaders);
      }
    } catch (error: any) {
      console.error('Error:', error);
      const errorMessage = error?.message || 'Unknown error';
      return new Response(JSON.stringify({ 
        success: false, 
        error: errorMessage 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  },
};

async function handlePost(request: any, env: any, corsHeaders: any): Promise<Response> {
  const body = await request.json();
  
  if (body.action === 'getQR') {
    return await handleGetQRCode(body, env, corsHeaders);
  } else if (body.action === 'checkQR') {
    return await handleCheckQRCode(body, env, corsHeaders);
  } else if (body.action === 'login') {
    return await handleLogin(body, env, corsHeaders);
  } else if (body.action === 'post') {
    return await handlePostWeibo(body, env, corsHeaders);
  } else {
    return new Response(JSON.stringify({
      success: false,
      error: 'Invalid action. Use "getQR", "checkQR", "login" or "post"'
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// 获取二维码
async function handleGetQRCode(body: any, env: any, corsHeaders: any): Promise<Response> {
  const browser = await launch(env.MYBROWSER);
  const page = await browser.newPage();

  try {
    // 访问微博登录页面
    await page.goto('https://weibo.com/login.php');
    await page.waitForTimeout(5000);

    // 尝试多种方式点击二维码登录
    try {
      // 方法1：查找二维码登录标签
      const qrTab1 = page.locator('text=二维码登录');
      if (await qrTab1.isVisible({ timeout: 2000 })) {
        await qrTab1.click();
        await page.waitForTimeout(2000);
      }
    } catch (e) {
      try {
        // 方法2：查找包含"扫码"的元素
        const qrTab2 = page.locator('text=扫码登录');
        if (await qrTab2.isVisible({ timeout: 2000 })) {
          await qrTab2.click();
          await page.waitForTimeout(2000);
        }
      } catch (e2) {
        // 方法3：通过CSS选择器
        const qrTab3 = page.locator('.info_list a').filter({ hasText: /二维码|扫码|QR/ });
        if (await qrTab3.count() > 0) {
          await qrTab3.first().click();
          await page.waitForTimeout(2000);
        }
      }
    }

    // 等待页面加载
    await page.waitForTimeout(3000);

    // 尝试多种选择器找到二维码图片
    let qrCodeImg = null;
    const qrSelectors = [
      'img[src*="qr"]',
      'img[alt*="二维码"]',
      'img[alt*="QR"]',
      '.qrcode_box img',
      '.W_login_qrcode img',
      '.login_qr img',
      'img[src*="login"]',
      'canvas', // 有些网站用canvas显示二维码
      '[class*="qr"] img',
      '[id*="qr"] img'
    ];

    for (const selector of qrSelectors) {
      try {
        const element = page.locator(selector);
        if (await element.isVisible({ timeout: 2000 })) {
          qrCodeImg = element;
          break;
        }
      } catch (e) {
        continue;
      }
    }

    if (!qrCodeImg) {
      // 如果找不到二维码，截取整个页面让用户看看情况
      const fullScreenshot = await page.screenshot();
      const debugImage = `data:image/png;base64,${btoa(String.fromCharCode(...fullScreenshot))}`;
      
      await browser.close();
      return new Response(JSON.stringify({
        success: false,
        error: 'QR code element not found. Here is the current page:',
        debugImage: debugImage
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    
    // 获取二维码图片源
    const qrSrc = await qrCodeImg.getAttribute('src');
    
    // 生成唯一的会话ID
    const sessionId = `qr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // 获取二维码图片数据
    let qrImageData = null;
    if (qrSrc) {
      if (qrSrc.startsWith('data:')) {
        // Base64 数据
        qrImageData = qrSrc;
      } else {
        // 相对或绝对URL，需要截图
        const qrElement = await qrCodeImg.boundingBox();
        if (qrElement) {
          const qrScreenshot = await page.screenshot({
            clip: qrElement
          });
          qrImageData = `data:image/png;base64,${btoa(String.fromCharCode(...qrScreenshot))}`;
        }
      }
    }

    // 如果没有获取到二维码图片，截取整个二维码区域
    if (!qrImageData) {
      const qrScreenshot = await qrCodeImg.screenshot();
      qrImageData = `data:image/png;base64,${btoa(String.fromCharCode(...qrScreenshot))}`;
    }

    // 保存会话信息到KV
    const sessionInfo = {
      sessionId,
      pageContext: true, // 标记页面仍在运行
      createTime: Date.now()
    };

    if (env.WEIBO_KV) {
      await env.WEIBO_KV.put(`qr_session:${sessionId}`, JSON.stringify(sessionInfo), {
        expirationTtl: 300 // 5分钟过期
      });
    }

    // 不关闭浏览器，保持页面活跃用于检查扫码状态
    // 注意：这里需要一个机制来管理长时间运行的浏览器实例

    return new Response(JSON.stringify({
      success: true,
      qrCode: qrImageData,
      sessionId: sessionId,
      message: 'QR Code generated. Please scan with Weibo app.'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    await browser.close();
    const errorMessage = error?.message || 'Failed to get QR code';
    return new Response(JSON.stringify({
      success: false,
      error: errorMessage
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// 检查二维码扫描状态
async function handleCheckQRCode(body: any, env: any, corsHeaders: any): Promise<Response> {
  if (!body.sessionId) {
    return new Response(JSON.stringify({
      success: false,
      error: 'Session ID required'
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // 从KV获取会话信息
  let sessionInfo = null;
  if (env.WEIBO_KV) {
    const sessionInfoStr = await env.WEIBO_KV.get(`qr_session:${body.sessionId}`);
    if (sessionInfoStr) {
      sessionInfo = JSON.parse(sessionInfoStr);
    }
  }

  if (!sessionInfo) {
    return new Response(JSON.stringify({
      success: false,
      error: 'Invalid or expired session'
    }), {
      status: 404,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const browser = await launch(env.MYBROWSER);
  const page = await browser.newPage();

  try {
    // 重新访问页面检查登录状态
    await page.goto('https://weibo.com/login.php');
    await page.waitForTimeout(2000);

    // 点击二维码登录选项
    const qrLoginTab = page.locator('.info_list .W_fL').or(
      page.locator('a[href*="qr"]').or(
        page.locator('[node-type="qrcodeTab"]')
      )
    );
    
    if (await qrLoginTab.isVisible()) {
      await qrLoginTab.click();
      await page.waitForTimeout(1000);
    }

    // 检查二维码状态
    const statusText = page.locator('.qrcode_tips').or(
      page.locator('.login_code_tip').or(
        page.locator('.W_login_qrcode .tips')
      )
    );

    let status = 'waiting';
    let message = 'Waiting for scan...';

    if (await statusText.isVisible()) {
      const text = await statusText.textContent();
      if (text) {
        if (text.includes('已扫描') || text.includes('scanned')) {
          status = 'scanned';
          message = 'QR code scanned, waiting for confirmation...';
        } else if (text.includes('已确认') || text.includes('confirmed')) {
          status = 'confirmed';
          message = 'Login confirmed, redirecting...';
        } else if (text.includes('已过期') || text.includes('expired')) {
          status = 'expired';
          message = 'QR code expired, please get a new one.';
        }
      }
    }

    // 检查是否已经登录成功
    const currentUrl = page.url();
    const isLoggedIn = currentUrl.includes('/home') || currentUrl.includes('/u/') || 
                      await page.locator('.gn_name').isVisible().catch(() => false);

    if (isLoggedIn || status === 'confirmed') {
      // 登录成功，获取cookies
      const cookies = await page.context().cookies();
      const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

      // 保存登录信息到KV
      const loginInfo = {
        sessionId: body.sessionId,
        cookies: cookieString,
        loginTime: Date.now(),
        loginMethod: 'qrcode'
      };

      if (env.WEIBO_KV) {
        await env.WEIBO_KV.put(`login:${body.sessionId}`, JSON.stringify(loginInfo), {
          expirationTtl: 86400 * 7 // 7天过期
        });
        // 清理会话信息
        await env.WEIBO_KV.delete(`qr_session:${body.sessionId}`);
      }

      await browser.close();

      return new Response(JSON.stringify({
        success: true,
        status: 'success',
        message: 'Login successful',
        sessionId: body.sessionId
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    await browser.close();

    return new Response(JSON.stringify({
      success: true,
      status: status,
      message: message
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    await browser.close();
    const errorMessage = error?.message || 'Failed to check QR status';
    return new Response(JSON.stringify({
      success: false,
      error: errorMessage
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// 保留原有的用户名密码登录功能作为备选
async function handleLogin(body: any, env: any, corsHeaders: any): Promise<Response> {
  if (!body.username || !body.password) {
    return new Response(JSON.stringify({
      success: false,
      error: 'Username and password required'
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const browser = await launch(env.MYBROWSER);
  const page = await browser.newPage();

  try {
    // 访问微博登录页面
    await page.goto('https://weibo.com/login.php');
    await page.waitForTimeout(3000);

    // 尝试找到登录表单元素
    const usernameInput = page.locator('input[name="username"]').or(page.locator('#loginname'));
    const passwordInput = page.locator('input[name="password"]').or(page.locator('#pl_login_form input[type="password"]'));
    
    await usernameInput.fill(body.username);
    await passwordInput.fill(body.password);
    
    // 点击登录按钮
    const submitBtn = page.locator('a[node-type="submitBtn"]').or(page.locator('.W_btn_a'));
    await submitBtn.click();
    await page.waitForTimeout(5000);

    // 检查是否登录成功 - 检查URL变化或页面元素
    const currentUrl = page.url();
    const isLoggedIn = currentUrl.includes('/home') || currentUrl.includes('/u/') || 
                      await page.locator('.gn_name').isVisible().catch(() => false);

    if (!isLoggedIn) {
      await browser.close();
      return new Response(JSON.stringify({
        success: false,
        error: 'Login failed. Please check username/password or try again later.'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 获取cookies
    const cookies = await page.context().cookies();
    const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    // 保存登录信息到KV
    const loginInfo = {
      username: body.username,
      password: body.password,
      cookies: cookieString,
      loginTime: Date.now(),
      loginMethod: 'password'
    };

    if (env.WEIBO_KV) {
      await env.WEIBO_KV.put(`login:${body.username}`, JSON.stringify(loginInfo), {
        expirationTtl: 86400 * 7 // 7天过期
      });
    }

    await browser.close();

    return new Response(JSON.stringify({
      success: true,
      message: 'Login successful'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    await browser.close();
    const errorMessage = error?.message || 'Login failed';
    return new Response(JSON.stringify({
      success: false,
      error: errorMessage
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

async function handlePostWeibo(body: any, env: any, corsHeaders: any): Promise<Response> {
  if (!body.content) {
    return new Response(JSON.stringify({
      success: false,
      error: 'Content required'
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // 从KV获取登录信息 - 支持sessionId或username
  let loginInfo = null;
  let loginKey = body.sessionId ? `login:${body.sessionId}` : `login:${body.username}`;
  
  if (env.WEIBO_KV) {
    const loginInfoStr = await env.WEIBO_KV.get(loginKey);
    if (loginInfoStr) {
      loginInfo = JSON.parse(loginInfoStr);
    }
  }

  if (!loginInfo) {
    return new Response(JSON.stringify({
      success: false,
      error: 'Not logged in. Please login first.'
    }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // 检查登录信息是否过期（7天）
  const loginTime = loginInfo.loginTime || 0;
  if (Date.now() - loginTime > 86400 * 7 * 1000) {
    return new Response(JSON.stringify({
      success: false,
      error: 'Login expired. Please login again.'
    }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const browser = await launch(env.MYBROWSER);
  const page = await browser.newPage();

  try {
    // 设置cookies
    const cookiesStr = loginInfo.cookies || '';
    if (cookiesStr) {
      const cookies = cookiesStr.split('; ').map((cookie: string) => {
        const [name, value] = cookie.split('=');
        return { name, value, domain: '.weibo.com', path: '/' };
      });
      
      await page.context().addCookies(cookies);
    }

    // 访问微博首页
    await page.goto('https://weibo.com');
    await page.waitForTimeout(3000);

    // 检查是否仍然登录
    const isLoggedIn = await page.locator('.gn_name').isVisible().catch(() => false) ||
                      await page.locator('.Nav_username').isVisible().catch(() => false);
    
    if (!isLoggedIn) {
      await browser.close();
      return new Response(JSON.stringify({
        success: false,
        error: 'Session expired. Please login again.'
      }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // 寻找发微博的文本框
    const textArea = page.locator('textarea[node-type="text"]').or(
      page.locator('.W_input').or(
        page.locator('textarea[placeholder*="有什么新鲜事"]')
      )
    );

    await textArea.fill(body.content);
    await page.waitForTimeout(1000);

    // 寻找发布按钮
    const submitBtn = page.locator('a[node-type="submit"]').or(
      page.locator('.W_btn_a[title*="发布"]').or(
        page.locator('button[title*="发布"]')
      )
    );

    await submitBtn.click();
    await page.waitForTimeout(3000);

    await browser.close();

    return new Response(JSON.stringify({
      success: true,
      message: 'Weibo posted successfully'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    await browser.close();
    const errorMessage = error?.message || 'Post failed';
    return new Response(JSON.stringify({
      success: false,
      error: errorMessage
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

async function handleGet(request: any, env: any, corsHeaders: any): Promise<Response> {
  // 保留原来的截图功能
  const { searchParams } = new URL(request.url);
  const todos = searchParams.getAll('todo');

  const browser = await launch(env.MYBROWSER);
  const page = await browser.newPage();

  await page.goto('https://demo.playwright.dev/todomvc');

  const TODO_ITEMS = todos.length > 0 ? todos : [
    'buy some cheese',
    'feed the cat',
    'book a doctors appointment'
  ];

  const newTodo = page.getByPlaceholder('What needs to be done?');
  for (const item of TODO_ITEMS) {
    await newTodo.fill(item);
    await newTodo.press('Enter');
  }

  await expect(page.getByTestId('todo-title')).toHaveCount(TODO_ITEMS.length);

  const img = await page.screenshot();
  await browser.close();

  return new Response(img, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'image/png',
    },
  });
}
