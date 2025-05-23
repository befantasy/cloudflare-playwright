import { launch } from '@cloudflare/playwright';
import { expect } from '@cloudflare/playwright/test';

interface Env {
  MYBROWSER: any;
  WEIBO_KV: KVNamespace; // KV存储用于保存登录信息
}

interface LoginInfo {
  username: string;
  password: string;
  cookies?: string;
  loginTime?: number;
}

interface PostRequest {
  action: 'login' | 'post';
  username?: string;
  password?: string;
  content?: string;
  images?: string[]; // base64编码的图片
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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
        return await this.handlePost(request, env, corsHeaders);
      } else {
        return await this.handleGet(request, env, corsHeaders);
      }
    } catch (error) {
      console.error('Error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return new Response(JSON.stringify({ 
        success: false, 
        error: errorMessage 
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  },

  async handlePost(request: Request, env: Env, corsHeaders: any): Promise<Response> {
    const body: PostRequest = await request.json();
    
    if (body.action === 'login') {
      return await this.handleLogin(body, env, corsHeaders);
    } else if (body.action === 'post') {
      return await this.handlePostWeibo(body, env, corsHeaders);
    } else {
      return new Response(JSON.stringify({
        success: false,
        error: 'Invalid action. Use "login" or "post"'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
  },

  async handleLogin(body: PostRequest, env: Env, corsHeaders: any): Promise<Response> {
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
      await page.waitForTimeout(2000);

      // 输入用户名和密码
      await page.fill('input[name="username"]', body.username);
      await page.fill('input[name="password"]', body.password);
      
      // 点击登录按钮
      await page.click('a[node-type="submitBtn"]');
      await page.waitForTimeout(3000);

      // 检查是否需要验证码
      const captchaExists = await page.locator('.code').isVisible().catch(() => false);
      if (captchaExists) {
        await browser.close();
        return new Response(JSON.stringify({
          success: false,
          error: 'Captcha required. Please try again later.'
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // 检查登录是否成功
      await page.waitForURL('**/home**', { timeout: 10000 });
      
      // 获取cookies
      const cookies = await page.context().cookies();
      const cookieString = cookies.map(c => `${c.name}=${c.value}`).join('; ');

      // 保存登录信息到KV
      const loginInfo: LoginInfo = {
        username: body.username,
        password: body.password,
        cookies: cookieString,
        loginTime: Date.now()
      };

      await env.WEIBO_KV.put(`login:${body.username}`, JSON.stringify(loginInfo), {
        expirationTtl: 86400 * 7 // 7天过期
      });

      await browser.close();

      return new Response(JSON.stringify({
        success: true,
        message: 'Login successful'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } catch (error) {
      await browser.close();
      const errorMessage = error instanceof Error ? error.message : 'Login failed';
      throw new Error(errorMessage);
    }
  },

  async handlePostWeibo(body: PostRequest, env: Env, corsHeaders: any): Promise<Response> {
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
    const loginInfoStr = await env.WEIBO_KV.get(`login:${body.username}`);
    if (!loginInfoStr) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Not logged in. Please login first.'
      }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const loginInfo: LoginInfo = JSON.parse(loginInfoStr);
    
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
      if (!cookiesStr) {
        await browser.close();
        return new Response(JSON.stringify({
          success: false,
          error: 'No valid cookies found. Please login again.'
        }), {
          status: 401,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      const cookies = cookiesStr.split('; ').map(cookie => {
        const [name, value] = cookie.split('=');
        return { name, value, domain: '.weibo.com', path: '/' };
      });
      
      await page.context().addCookies(cookies);

      // 访问微博首页
      await page.goto('https://weibo.com');
      await page.waitForTimeout(2000);

      // 检查是否仍然登录
      const isLoggedIn = await page.locator('.Nav_username').isVisible().catch(() => false);
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

      // 点击发微博按钮
      await page.click('[node-type="compose"]');
      await page.waitForTimeout(1000);

      // 输入微博内容
      const textArea = page.locator('textarea[node-type="text"]');
      await textArea.fill(body.content);

      // 如果有图片，上传图片
      if (body.images && body.images.length > 0) {
        for (const base64Image of body.images) {
          // 将base64转换为Uint8Array (Worker环境中没有Buffer)
          const base64Data = base64Image.replace(/^data:image\/\w+;base64,/, '');
          const binaryString = atob(base64Data);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          
          // 创建File对象
          const fileName = `temp_image_${Date.now()}.jpg`;
          const file = new File([bytes], fileName, { type: 'image/jpeg' });
          
          await page.setInputFiles('input[type="file"]', file);
          await page.waitForTimeout(2000);
        }
      }

      // 发布微博
      await page.click('a[node-type="submit"]');
      await page.waitForTimeout(3000);

      // 检查是否发布成功
      const success = await page.locator('.layer_tips').isVisible().catch(() => false);

      await browser.close();

      return new Response(JSON.stringify({
        success: true,
        message: 'Weibo posted successfully'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } catch (error) {
      await browser.close();
      const errorMessage = error instanceof Error ? error.message : 'Post failed';
      throw new Error(errorMessage);
    }
  },

  async handleGet(request: Request, env: Env, corsHeaders: any): Promise<Response> {
    // 保留原来的截图功能
    const { searchParams } = new URL(request.url);
    const todos = searchParams.getAll('todo');
    const trace = searchParams.has('trace');

    const browser = await launch(env.MYBROWSER);
    const page = await browser.newPage();

    if (trace)
      await page.context().tracing.start({ screenshots: true, snapshots: true });

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

    if (trace) {
      await page.context().tracing.stop({ path: 'trace.zip' });
      await browser.close();
      
      // 注意：这里需要使用Worker的文件系统API
      return new Response('Trace functionality needs to be implemented with Worker filesystem', {
        status: 500,
        headers: corsHeaders
      });
    } else {
      const img = await page.screenshot();
      await browser.close();

      return new Response(img, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'image/png',
        },
      });
    }
  },
};
