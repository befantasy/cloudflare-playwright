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
  } else if (body.action === 'screenshot') {
    return await handleScreenshot(body, env, corsHeaders);
  } else {
    return new Response(JSON.stringify({
      success: false,
      error: 'Invalid action. Use "getQR", "checkQR", "login", "post" or "screenshot"'
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// 改进的二维码获取函数
async function handleGetQRCode(body: any, env: any, corsHeaders: any): Promise<Response> {
  const browser = await launch(env.MYBROWSER);
  const page = await browser.newPage();

  try {
    // 设置更大的视窗以便更好地截图
    await page.setViewportSize({ width: 1280, height: 720 });

    // 访问微博登录页面
    await page.goto('https://weibo.com/login.php', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // 尝试多种方式点击二维码登录
    const qrLoginSelectors = [
      'text=二维码登录',
      'text=扫码登录', 
      'text=QR',
      '.info_list a:has-text("二维码")',
      '.info_list a:has-text("扫码")',
      '[node-type="qrcodeTab"]',
      'a[href*="qr"]'
    ];

    let qrTabFound = false;
    for (const selector of qrLoginSelectors) {
      try {
        const qrTab = page.locator(selector);
        if (await qrTab.isVisible({ timeout: 2000 })) {
          await qrTab.click();
          await page.waitForTimeout(2000);
          qrTabFound = true;
          break;
        }
      } catch (e) {
        continue;
      }
    }

    // 等待页面更新
    await page.waitForTimeout(3000);

    // 生成唯一的会话ID
    const sessionId = `qr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // 尝试多种选择器找到二维码图片
    const qrSelectors = [
      'img[src*="qr"]',
      'img[alt*="二维码"]',
      'img[alt*="QR"]',
      '.qrcode_box img',
      '.W_login_qrcode img',
      '.login_qr img',
      'img[src*="login"]',
      '[class*="qr"] img',
      '[id*="qr"] img',
      'canvas' // 有些网站用canvas显示二维码
    ];

    let qrElement = null;
    let qrImageBuffer = null;

    // 寻找二维码元素
    for (const selector of qrSelectors) {
      try {
        const element = page.locator(selector);
        if (await element.isVisible({ timeout: 2000 })) {
          qrElement = element;
          // 直接截取二维码元素
          qrImageBuffer = await element.screenshot({ type: 'png' });
          break;
        }
      } catch (e) {
        continue;
      }
    }

    // 如果没有找到具体的二维码元素，尝试截取二维码区域
    if (!qrImageBuffer) {
      const qrAreaSelectors = [
        '.qrcode_box',
        '.W_login_qrcode',
        '.login_qr',
        '[class*="qr"]',
        '[id*="qr"]'
      ];

      for (const selector of qrAreaSelectors) {
        try {
          const area = page.locator(selector);
          if (await area.isVisible({ timeout: 2000 })) {
            qrImageBuffer = await area.screenshot({ type: 'png' });
            break;
          }
        } catch (e) {
          continue;
        }
      }
    }

    // 如果仍然没有找到，截取整个页面作为调试信息
    if (!qrImageBuffer) {
      console.log('QR code not found, taking full page screenshot for debugging');
      qrImageBuffer = await page.screenshot({ type: 'png', fullPage: false });
    }

    // 保存会话信息到KV
    const sessionInfo = {
      sessionId,
      pageContext: true,
      createTime: Date.now(),
      qrTabFound
    };

    if (env.WEIBO_KV) {
      await env.WEIBO_KV.put(`qr_session:${sessionId}`, JSON.stringify(sessionInfo), {
        expirationTtl: 300 // 5分钟过期
      });
    }

    await browser.close();

    // 根据请求参数决定返回格式
    if (body.returnType === 'image') {
      // 直接返回图片数据
      return new Response(qrImageBuffer, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'image/png',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        }
      });

    } catch (error: any) {
      await browser.close();
      return new Response('Failed to generate QR code', { 
        status: 500,
        headers: corsHeaders
      });
    }
  }

  // 原有的TODO截图功能
  const todos = searchParams.getAll('todo');
  const browser = await launch(env.MYBROWSER);
  const page = await browser.newPage();

  try {
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

  } catch (error: any) {
    await browser.close();
    return new Response('Screenshot failed', { 
      status: 500,
      headers: corsHeaders
    });
  }
}Headers,
          'Content-Type': 'image/png',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        }
      });
    } else {
      // 返回base64编码的JSON响应
      const qrImageBase64 = `data:image/png;base64,${btoa(String.fromCharCode(...qrImageBuffer))}`;
      
      return new Response(JSON.stringify({
        success: true,
        qrCode: qrImageBase64,
        sessionId: sessionId,
        qrTabFound: qrTabFound,
        message: qrTabFound ? 'QR Code generated. Please scan with Weibo app.' : 'Page loaded, please check if QR code is visible.'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

  } catch (error: any) {
    await browser.close();
    const errorMessage = error?.message || 'Failed to get QR code';
    console.error('QR Code generation error:', errorMessage);
    
    return new Response(JSON.stringify({
      success: false,
      error: errorMessage
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// 新增：通用截图功能
async function handleScreenshot(body: any, env: any, corsHeaders: any): Promise<Response> {
  const browser = await launch(env.MYBROWSER);
  const page = await browser.newPage();

  try {
    // 设置视窗大小
    const width = body.width || 1280;
    const height = body.height || 720;
    await page.setViewportSize({ width, height });

    // 访问指定URL
    const url = body.url || 'https://weibo.com/login.php';
    await page.goto(url, { waitUntil: 'networkidle' });
    
    // 等待指定时间
    const waitTime = body.waitTime || 3000;
    await page.waitForTimeout(waitTime);

    // 如果指定了选择器，截取特定元素
    let screenshotBuffer;
    if (body.selector) {
      const element = page.locator(body.selector);
      if (await element.isVisible({ timeout: 5000 })) {
        screenshotBuffer = await element.screenshot({ type: 'png' });
      } else {
        throw new Error(`Element with selector "${body.selector}" not found or not visible`);
      }
    } else {
      // 截取整个页面或视窗
      const fullPage = body.fullPage !== false; // 默认为true
      screenshotBuffer = await page.screenshot({ 
        type: 'png', 
        fullPage,
        quality: body.quality || 80
      });
    }

    await browser.close();

    // 根据请求参数决定返回格式
    if (body.returnType === 'image') {
      return new Response(screenshotBuffer, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'image/png',
          'Cache-Control': 'no-cache, no-store, must-revalidate'
        }
      });
    } else {
      const imageBase64 = `data:image/png;base64,${btoa(String.fromCharCode(...screenshotBuffer))}`;
      return new Response(JSON.stringify({
        success: true,
        image: imageBase64,
        url: url,
        timestamp: Date.now()
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

  } catch (error: any) {
    await browser.close();
    const errorMessage = error?.message || 'Screenshot failed';
    console.error('Screenshot error:', errorMessage);
    
    return new Response(JSON.stringify({
      success: false,
      error: errorMessage
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// 改进的检查二维码扫描状态
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
    await page.setViewportSize({ width: 1280, height: 720 });
    
    // 重新访问页面检查登录状态
    await page.goto('https://weibo.com/login.php', { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);

    // 点击二维码登录选项
    const qrLoginSelectors = [
      'text=二维码登录',
      'text=扫码登录',
      '[node-type="qrcodeTab"]',
      'a[href*="qr"]'
    ];

    for (const selector of qrLoginSelectors) {
      try {
        const qrTab = page.locator(selector);
        if (await qrTab.isVisible({ timeout: 1000 })) {
          await qrTab.click();
          await page.waitForTimeout(1000);
          break;
        }
      } catch (e) {
        continue;
      }
    }

    // 检查二维码状态
    const statusSelectors = [
      '.qrcode_tips',
      '.login_code_tip', 
      '.W_login_qrcode .tips',
      '.qr_tips'
    ];

    let status = 'waiting';
    let message = 'Waiting for scan...';
    let statusScreenshot = null;

    for (const selector of statusSelectors) {
      try {
        const statusElement = page.locator(selector);
        if (await statusElement.isVisible({ timeout: 1000 })) {
          const text = await statusElement.textContent();
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
          
          // 截取状态区域
          if (body.includeStatusScreenshot) {
            statusScreenshot = await statusElement.screenshot({ type: 'png' });
          }
          break;
        }
      } catch (e) {
        continue;
      }
    }

    // 检查是否已经登录成功
    const currentUrl = page.url();
    const loginCheckSelectors = ['.gn_name', '.Nav_username', '.m-person'];
    let isLoggedIn = currentUrl.includes('/home') || currentUrl.includes('/u/');
    
    if (!isLoggedIn) {
      for (const selector of loginCheckSelectors) {
        try {
          if (await page.locator(selector).isVisible({ timeout: 1000 })) {
            isLoggedIn = true;
            break;
          }
        } catch (e) {
          continue;
        }
      }
    }

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

    const response: any = {
      success: true,
      status: status,
      message: message
    };

    // 如果请求了状态截图且有截图数据
    if (statusScreenshot && body.includeStatusScreenshot) {
      if (body.returnType === 'image') {
        return new Response(statusScreenshot, {
          headers: {
            ...corsHeaders,
            'Content-Type': 'image/png'
          }
        });
      } else {
        response.statusScreenshot = `data:image/png;base64,${btoa(String.fromCharCode(...statusScreenshot))}`;
      }
    }

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error: any) {
    await browser.close();
    const errorMessage = error?.message || 'Failed to check QR status';
    console.error('QR status check error:', errorMessage);
    
    return new Response(JSON.stringify({
      success: false,
      error: errorMessage
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

// 保留原有的用户名密码登录功能
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
    await page.setViewportSize({ width: 1280, height: 720 });
    
    // 访问微博登录页面
    await page.goto('https://weibo.com/login.php', { waitUntil: 'networkidle' });
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

    // 检查是否登录成功
    const currentUrl = page.url();
    const loginCheckSelectors = ['.gn_name', '.Nav_username', '.m-person'];
    let isLoggedIn = currentUrl.includes('/home') || currentUrl.includes('/u/');
    
    if (!isLoggedIn) {
      for (const selector of loginCheckSelectors) {
        try {
          if (await page.locator(selector).isVisible({ timeout: 2000 })) {
            isLoggedIn = true;
            break;
          }
        } catch (e) {
          continue;
        }
      }
    }

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

  // 从KV获取登录信息
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

  // 检查登录信息是否过期
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
    await page.setViewportSize({ width: 1280, height: 720 });
    
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
    await page.goto('https://weibo.com', { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);

    // 检查是否仍然登录
    const loginCheckSelectors = ['.gn_name', '.Nav_username', '.m-person'];
    let isLoggedIn = false;
    
    for (const selector of loginCheckSelectors) {
      try {
        if (await page.locator(selector).isVisible({ timeout: 2000 })) {
          isLoggedIn = true;
          break;
        }
      } catch (e) {
        continue;
      }
    }
    
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
    const textAreaSelectors = [
      'textarea[node-type="text"]',
      '.W_input',
      'textarea[placeholder*="有什么新鲜事"]',
      'textarea[placeholder*="分享新鲜事"]'
    ];

    let textArea = null;
    for (const selector of textAreaSelectors) {
      try {
        const element = page.locator(selector);
        if (await element.isVisible({ timeout: 2000 })) {
          textArea = element;
          break;
        }
      } catch (e) {
        continue;
      }
    }

    if (!textArea) {
      await browser.close();
      return new Response(JSON.stringify({
        success: false,
        error: 'Post text area not found'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    await textArea.fill(body.content);
    await page.waitForTimeout(1000);

    // 寻找发布按钮
    const submitBtnSelectors = [
      'a[node-type="submit"]',
      '.W_btn_a[title*="发布"]',
      'button[title*="发布"]',
      '.send_btn',
      '.W_btn_a:has-text("发布")'
    ];

    let submitBtn = null;
    for (const selector of submitBtnSelectors) {
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
      return new Response(JSON.stringify({
        success: false,
        error: 'Submit button not found'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    await submitBtn.click();
    await page.waitForTimeout(3000);

    // 可选：截取发布后的页面作为确认
    let confirmationScreenshot = null;
    if (body.includeConfirmationScreenshot) {
      confirmationScreenshot = await page.screenshot({ type: 'png' });
    }

    await browser.close();

    const response: any = {
      success: true,
      message: 'Weibo posted successfully'
    };

    if (confirmationScreenshot && body.includeConfirmationScreenshot) {
      if (body.returnType === 'image') {
        return new Response(confirmationScreenshot, {
          headers: {
            ...corsHeaders,
            'Content-Type': 'image/png'
          }
        });
      } else {
        response.confirmationScreenshot = `data:image/png;base64,${btoa(String.fromCharCode(...confirmationScreenshot))}`;
      }
    }

    return new Response(JSON.stringify(response), {
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

// 改进的GET处理函数
async function handleGet(request: any, env: any, corsHeaders: any): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get('action') || 'todo';
  
  if (action === 'qr') {
    // 直接通过GET请求获取二维码图片
    const browser = await launch(env.MYBROWSER);
    const page = await browser.newPage();

    try {
      await page.setViewportSize({ width: 1280, height: 720 });
      await page.goto('https://weibo.com/login.php', { waitUntil: 'networkidle' });
      await page.waitForTimeout(3000);

      // 点击二维码登录
      const qrLoginSelectors = [
        'text=二维码登录',
        'text=扫码登录',
        '[node-type="qrcodeTab"]'
      ];

      for (const selector of qrLoginSelectors) {
        try {
          const qrTab = page.locator(selector);
          if (await qrTab.isVisible({ timeout: 2000 })) {
            await qrTab.click();
            await page.waitForTimeout(2000);
            break;
          }
        } catch (e) {
          continue;
        }
      }

      await page.waitForTimeout(3000);

      // 截取二维码区域
      const qrSelectors = [
        '.qrcode_box',
        '.W_login_qrcode',
        '.login_qr'
      ];

      let qrImageBuffer = null;
      for (const selector of qrSelectors) {
        try {
          const element = page.locator(selector);
          if (await element.isVisible({ timeout: 2000 })) {
            qrImageBuffer = await element.screenshot({ type: 'png' });
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (!qrImageBuffer) {
        qrImageBuffer = await page.screenshot({ type: 'png' });
      }

      await browser.close();

      return new Response(qrImageBuffer, {
        headers: {
          ...cors
