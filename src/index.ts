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
  
  if (body.action === 'login') {
    return await handleLogin(body, env, corsHeaders);
  } else if (body.action === 'post') {
    return await handlePostWeibo(body, env, corsHeaders);
  } else {
    return new Response(JSON.stringify({
      success: false,
      error: 'Invalid action. Use "login" or "post"'
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
}

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
      loginTime: Date.now()
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
  if (!body.username || !body.content) {
    return new Response(JSON.stringify({
      success: false,
      error: 'Username and content required'
    }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // 从KV获取登录信息
  let loginInfo = null;
  if (env.WEIBO_KV) {
    const loginInfoStr = await env.WEIBO_KV.get(`login:${body.username}`);
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
