/**
 * 知产管家 - 后端视觉服务 v2
 * 
 * Endpoints:
 *   GET  /api/health
 *   POST /api/vision/business-license
 * 
 * 图片传输链路：前端传 base64 data URL -> 后端校验 SHA256 -> 转发模型
 */
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const sharp = require('sharp');

const PORT = 3210;
const MINIMAX_API = 'https://api.minimaxi.com';
const API_KEY = process.env.MINIMAX_API_KEY || '';
const MODEL = 'MiniMax-M3';

// ============ Helpers ============

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(body);
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    const limit = maxBytes || 30 * 1024 * 1024;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) { reject(new Error('PAYLOAD_TOO_LARGE')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

// Extract base64 from data URL and compute SHA256 of the raw bytes
function analyzeDataUrl(dataUrl) {
  const m = dataUrl.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
  if (!m) return null;
  const mime = m[1];
  const b64 = m[2];
  const raw = Buffer.from(b64, 'base64');
  return {
    mime,
    b64Length: b64.length,
    rawSize: raw.length,
    sha256: sha256(raw),
    sha256Short: sha256(raw).substring(0, 8),
  };
}

function callMiniMaxChat(body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const url = new URL('/v1/chat/completions', MINIMAX_API);
    const options = {
      method: 'POST',
      hostname: url.hostname,
      path: url.pathname,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 90000,
    };
    const req = https.request(options, (resp) => {
      const chunks = [];
      resp.on('data', (c) => chunks.push(c));
      resp.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        let data;
        try { data = JSON.parse(raw); } catch { data = { raw }; }
        resolve({ status: resp.statusCode, data });
      });
    });
    req.on('error', (e) => reject(e));
    req.on('timeout', () => { req.destroy(); reject(new Error('TIMEOUT')); });
    req.write(payload);
    req.end();
  });
}

// ============ Prompt ============

const LICENSE_PROMPT = `这是一张中国营业执照图片。图片可能被旋转，请先在脑中旋转到正常方向。

请仔细识别并提取以下字段。看不清的字段返回 null，禁止猜测。

只返回 JSON，不要任何分析过程、解释或 markdown：
{"unified_social_credit_code":null,"company_name":null,"company_type":null,"legal_representative":null,"registered_capital":null,"established_date":null,"address":null,"business_scope":null}

要求：
- unified_social_credit_code: 18位字母数字
- established_date: 原始格式如"2026年06月29日"
- registered_capital: 原始格式如"壹拾万元整"
- 看不清就返回null，绝对不能编造`;

// ============ Result Validation ============

function validateFields(f) {
  const errors = [];
  
  // 统一社会信用代码: 18位
  if (f.unified_social_credit_code && f.unified_social_credit_code !== null) {
    const code = f.unified_social_credit_code.replace(/\s/g, '');
    if (!/^[0-9A-Z]{18}$/.test(code)) {
      errors.push(`信用代码格式不符: "${code}" (应为18位字母数字)`);
    }
  }
  
  // 检测是否全空（识别失败）
  const allEmpty = Object.values(f).every(v => !v || v === null || v === '');
  if (allEmpty) {
    errors.push('所有字段为空，识别失败');
  }
  
  return errors;
}

function normalizeFields(parsed) {
  // Support both new and old field names
  return {
    unified_social_credit_code: parsed.unified_social_credit_code || parsed.creditCode || null,
    company_name: parsed.company_name || parsed.companyName || null,
    company_type: parsed.company_type || parsed.companyType || null,
    legal_representative: parsed.legal_representative || parsed.legalRep || null,
    registered_capital: parsed.registered_capital || parsed.registeredCapital || null,
    established_date: parsed.established_date || parsed.establishedDate || null,
    address: parsed.address || null,
    business_scope: parsed.business_scope || parsed.businessScope || null,
  };
}

// ============ Handler ============

async function handleBusinessLicense(body) {
  let { image, clientHash } = body;
  
  if (!image) {
    return { status: 400, data: { error: 'BAD_REQUEST', message: '缺少 image 字段' } };
  }

  if (!image.startsWith('data:image/')) {
    return { status: 400, data: { error: 'BAD_REQUEST', message: 'image 必须是 data:image/... 格式' } };
  }

  // Analyze image
  const imgInfo = analyzeDataUrl(image);
  if (!imgInfo) {
    return { status: 400, data: { error: 'BAD_REQUEST', message: 'base64 解析失败' } };
  }

  // SHA256 verification
  if (clientHash && clientHash !== imgInfo.sha256) {
    console.log(`[WARN] SHA256 mismatch! client=${clientHash.substring(0,8)} server=${imgInfo.sha256.substring(0,8)}`);
    return { 
      status: 400, 
      data: { 
        error: 'HASH_MISMATCH', 
        message: `图片传输校验失败：前端SHA256=${clientHash.substring(0,8)} 后端SHA256=${imgInfo.sha256.substring(0,8)}`,
        clientHash: clientHash.substring(0, 8),
        serverHash: imgInfo.sha256.substring(0, 8),
      }
    };
  }

  console.log(`[VISION] image: ${imgInfo.mime} ${imgInfo.rawSize}B sha256=${imgInfo.sha256Short} b64len=${imgInfo.b64Length}`);

  // Auto-rotate: if image is portrait but license should be landscape, rotate 90° CCW
  try {
    const rawBuf = Buffer.from(image.split(',')[1], 'base64');
    const meta = await sharp(rawBuf).metadata();
    console.log(`[VISION] sharp: ${meta.width}x${meta.height} orient=${meta.orientation||'none'}`);
    
    // Debug: save last image
    const fs = require('fs');
    fs.writeFileSync('/tmp/last-license.jpg', rawBuf);
    
    if (meta.height > meta.width) {
      console.log('[VISION] auto-rotating 90° CCW (portrait -> landscape)');
      const rotated = await sharp(rawBuf).rotate(-90).jpeg({ quality: 95 }).toBuffer();
      image = 'data:image/jpeg;base64,' + rotated.toString('base64');
      console.log(`[VISION] rotated: ${rotated.length}B`);
    } else if (meta.orientation && meta.orientation !== 1) {
      const rotated = await sharp(rawBuf).rotate().jpeg({ quality: 95 }).toBuffer();
      image = 'data:image/jpeg;base64,' + rotated.toString('base64');
      console.log(`[VISION] EXIF rotated: orient=${meta.orientation}`);
    }
  } catch(e) { console.log('[VISION] rotation error:', e.message); }

  if (imgInfo.rawSize > 15 * 1024 * 1024) {
    return { status: 413, data: { error: 'IMAGE_TOO_LARGE', message: `图片 ${Math.round(imgInfo.rawSize/1024)}KB 超过 15MB 限制` } };
  }

  // Call MiniMax vision
  let result;
  try {
    // Verify we're sending a real image in the content array
    const contentArray = [
      { type: 'text', text: LICENSE_PROMPT },
      { type: 'image_url', image_url: { url: image } },
    ];
    
    console.log(`[VISION] Sending to MiniMax: model=${MODEL} content_items=${contentArray.length} has_image=${contentArray.some(c => c.type === 'image_url')}`);
    
    result = await callMiniMaxChat({
      model: MODEL,
      messages: [{ role: 'user', content: contentArray }],
      max_tokens: 1000,
      temperature: 0.1,
    });
  } catch (e) {
    if (e.message === 'TIMEOUT') {
      return { status: 504, data: { error: 'UPSTREAM_TIMEOUT', message: 'MiniMax API 请求超时 (90s)' } };
    }
    return { status: 502, data: { error: 'UPSTREAM_ERROR', message: '上游连接失败: ' + e.message } };
  }

  console.log(`[VISION] MiniMax response: status=${result.status} has_choices=${!!result.data?.choices}`);

  // Handle upstream errors
  if (result.status === 401 || (result.data?.error?.type === 'authorized_error')) {
    return { status: 401, data: { error: 'INVALID_API_KEY', message: 'MiniMax API Key 无效或已过期' } };
  }
  if (result.status === 429) {
    return { status: 429, data: { error: 'RATE_LIMITED', message: 'API 调用频率超限，请稍后重试' } };
  }
  if (result.status === 400) {
    const errMsg = result.data?.error?.message || result.data?.base_resp?.status_msg || '模型不支持图片或参数错误';
    return { status: 400, data: { error: 'MODEL_NOT_SUPPORTED', message: errMsg } };
  }
  if (result.status !== 200) {
    const errMsg = result.data?.error?.message || JSON.stringify(result.data).slice(0, 200);
    return { status: 502, data: { error: 'UPSTREAM_ERROR', message: `MiniMax ${result.status}: ${errMsg}` } };
  }

  // Parse response content
  const content = result.data?.choices?.[0]?.message?.content || '';
  if (!content) {
    return { status: 502, data: { error: 'EMPTY_RESPONSE', message: '模型返回空响应' } };
  }

  // Extract JSON from content
  let parsed;
  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]+?)\s*```/) || content.match(/\{[\s\S]+\}/);
  const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content;
  try {
    parsed = JSON.parse(jsonStr.trim());
  } catch (e) {
    return { status: 502, data: { error: 'PARSE_ERROR', message: 'JSON 解析失败', raw: content.slice(0, 500) } };
  }

  // Normalize and validate
  const fields = normalizeFields(parsed);
  const validationErrors = validateFields(fields);

  // Determine if we should auto-fill
  const shouldAutoFill = validationErrors.length === 0;
  
  return {
    status: 200,
    data: {
      success: true,
      model: MODEL,
      imageHash: imgInfo.sha256Short,
      imageSize: imgInfo.rawSize,
      imageMime: imgInfo.mime,
      fields,
      validationErrors,
      shouldAutoFill,
      rawText: content.slice(0, 2000),
    },
  };
}

// ============ LLM Extract ============

async function handleLlmExtract(body) {
  const { type, context } = body;
  
  if (!type || !context) {
    return { status: 400, data: { error: 'BAD_REQUEST', message: '缺少 type 或 context' } };
  }

  const systemPrompt = `你是专业的商标 / 软著申请顾问。根据用户提供的信息，提取并整理出 ${type === 'trademark' ? '商标' : '软件著作权'} 申请所需的所有字段。严格要求：1. 只输出 JSON，不要任何解释。2. 不要编造，找不到的字段填空字符串。3. 商标类型只能是 文字/图形/字母/数字/三维/组合 之一。4. 商标类别必须是 1-45 之间的整数。`;

  const schema = type === 'trademark' ? `{
  "trademarkName": "商标名称",
  "trademarkType": "文字/图形/字母/数字/三维/组合",
  "category": 1至45的整数,
  "categoryReason": "为什么选这个类别",
  "goods": "[XXXX] 商品1；商品2",
  "description": "商标含义/用途说明"
}` : `{
  "softwareName": "软件全称带V1.0后缀",
  "abbreviation": "软件简称",
  "version": "1.0.0",
  "completionDate": "YYYY-MM-DD",
  "firstPublishDate": "YYYY-MM-DD或留空",
  "publishStatus": "已发表/未发表",
  "language": "Python/JavaScript/Java等",
  "totalLines": 整数,
  "features": "技术特点/主要功能(150-300字)",
  "rightWay": "原始/继承/受让",
  "handleWay": "自办/代理"
}`;

  const userPrompt = `请根据以下信息，提取${type === 'trademark' ? '商标' : '软件著作权'}申请字段：\n\n${context}\n\n字段 schema：\n${schema}\n\n直接输出 JSON：`;

  let result;
  try {
    result = await callMiniMaxChat({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.2,
      max_tokens: 2000,
    });
  } catch (e) {
    if (e.message === 'TIMEOUT') return { status: 504, data: { error: 'UPSTREAM_TIMEOUT', message: '请求超时' } };
    return { status: 502, data: { error: 'UPSTREAM_ERROR', message: '上游连接失败: ' + e.message } };
  }

  if (result.status === 401) return { status: 401, data: { error: 'INVALID_API_KEY', message: 'API Key 无效' } };
  if (result.status === 429) return { status: 429, data: { error: 'RATE_LIMITED', message: '频率超限' } };
  if (result.status !== 200) return { status: 502, data: { error: 'UPSTREAM_ERROR', message: `MiniMax ${result.status}` } };

  const content = result.data?.choices?.[0]?.message?.content || '';
  if (!content) return { status: 502, data: { error: 'EMPTY_RESPONSE', message: '模型返回空' } };

  const jsonMatch = content.match(/```(?:json)?\s*([\s\S]+?)\s*```/) || content.match(/\{[\s\S]+\}/);
  const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : content;
  try {
    const parsed = JSON.parse(jsonStr.trim());
    return { status: 200, data: { success: true, model: MODEL, fields: parsed } };
  } catch (e) {
    return { status: 502, data: { error: 'PARSE_ERROR', message: 'JSON 解析失败', raw: content.slice(0, 500) } };
  }
}

// ============ Server ============

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    sendJSON(res, 200, {});
    return;
  }

  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Health check
  if (url.pathname === '/api/health' && req.method === 'GET') {
    try {
      const result = await callMiniMaxChat({
        model: MODEL,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 5,
      });
      if (result.status === 200) {
        sendJSON(res, 200, { status: 'ok', model: MODEL, supports_image: true });
      } else if (result.status === 401) {
        sendJSON(res, 401, { status: 'error', error: 'INVALID_API_KEY', message: 'API Key 无效' });
      } else {
        sendJSON(res, 502, { status: 'error', error: 'UPSTREAM_ERROR', message: `上游返回 ${result.status}` });
      }
    } catch (e) {
      sendJSON(res, 504, { status: 'error', error: 'TIMEOUT', message: '健康检查超时: ' + e.message });
    }
    return;
  }

  // Business license vision
  if (url.pathname === '/api/vision/business-license' && req.method === 'POST') {
    try {
      const raw = await readBody(req, 30 * 1024 * 1024);
      let body;
      try { body = JSON.parse(raw.toString('utf-8')); }
      catch { sendJSON(res, 400, { error: 'BAD_REQUEST', message: '请求体不是有效 JSON' }); return; }
      
      const result = await handleBusinessLicense(body);
      sendJSON(res, result.status, result.data);
    } catch (e) {
      if (e.message === 'PAYLOAD_TOO_LARGE') {
        sendJSON(res, 413, { error: 'IMAGE_TOO_LARGE', message: '请求体超过 30MB 限制' });
        return;
      }
      sendJSON(res, 500, { error: 'INTERNAL_ERROR', message: e.message });
    }
    return;
  }

  // LLM extract
  if (url.pathname === '/api/llm/extract' && req.method === 'POST') {
    try {
      const raw = await readBody(req, 5 * 1024 * 1024);
      let body;
      try { body = JSON.parse(raw.toString('utf-8')); }
      catch { sendJSON(res, 400, { error: 'BAD_REQUEST', message: '请求体不是有效 JSON' }); return; }
      const result = await handleLlmExtract(body);
      sendJSON(res, result.status, result.data);
    } catch (e) {
      sendJSON(res, 500, { error: 'INTERNAL_ERROR', message: e.message });
    }
    return;
  }

  // Auth endpoint
  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    try {
      const raw = await readBody(req, 1024 * 1024);
      const body = JSON.parse(raw.toString('utf-8'));
      const crypto = require('crypto');
      const hash = crypto.createHash('sha256').update(body.password || '').digest('hex');
      const expectedHash = process.env.LOGIN_PASSWORD_HASH || '';
      if (hash === expectedHash) {
        sendJSON(res, 200, { status: 'ok' });
      } else {
        sendJSON(res, 401, { error: 'AUTH_FAILED', message: '密码错误' });
      }
    } catch (e) {
      sendJSON(res, 400, { error: 'BAD_REQUEST', message: e.message });
    }
    return;
  }

  // Smart trademark: recommend categories based on GitHub repo
  if (url.pathname === '/api/trademark/recommend' && req.method === 'POST') {
    try {
      const raw = await readBody(req, 5 * 1024 * 1024);
      const body = JSON.parse(raw.toString('utf-8'));
      const repo = body.repo || {};
      
      // Build prompt from repo data
      const desc = '仓库：' + (repo.fullName||'') + '\n描述：' + (repo.description||'') + '\n主语言：' + (repo.language||'') + '\nTopics：' + (repo.topics||[]).join(', ') + '\n语言统计：' + JSON.stringify(repo.languages||{}) + '\n默认分支：' + (repo.defaultBranch||'') + '\n\nREADME摘要：\n' + (repo.readme||'').slice(0,2000) + '\n\n目录树：\n' + (repo.tree||[]).slice(0,50).join('\n');
      
      const prompt = '基于以下GitHub仓库的真实内容，推荐3-5个最合适的商标注册类别（Nice分类，1-45之间的整数）。\n\n' + desc + '\n\n只返回JSON：{"categories":[{"category":数字,"name":"类别名","reason":"推荐理由（30字内）","score":0-100}]}';
      
      const result = await callMiniMaxChat({
        model: MODEL,
        messages: [
          { role: 'system', content: '你是专业的商标代理人，熟悉中国《类似商品和服务区分表》基于NCL(11版)45个类别的详细说明。基于仓库实际内容而非描述，给出最相关的3-5个类别。' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.3,
        max_tokens: 1000
      });
      
      if (result.status !== 200) {
        return sendJSON(res, 502, { error: 'UPSTREAM_ERROR', message: '推荐失败' });
      }
      
      const content = result.data?.choices?.[0]?.message?.content || '';
      const jsonMatch = content.match(/\{[\s\S]+\}/);
      try {
        const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);
        return sendJSON(res, 200, { success: true, model: MODEL, categories: parsed.categories || [] });
      } catch(e) {
        return sendJSON(res, 502, { error: 'PARSE_ERROR', message: 'JSON 解析失败' });
      }
    } catch (e) {
      sendJSON(res, 500, { error: 'INTERNAL_ERROR', message: e.message });
    }
    return;
  }

  // Smart trademark: generate 20+ name candidates across multiple routes
  if (url.pathname === '/api/trademark/generate-names' && req.method === 'POST') {
    try {
      const raw = await readBody(req, 5 * 1024 * 1024);
      const body = JSON.parse(raw.toString('utf-8'));
      const repo = body.repo || {};
      const categories = body.categories || [];
      
      const desc = '仓库：' + (repo.fullName||'') + '\n描述：' + (repo.description||'') + '\n主语言：' + (repo.language||'') + '\n推荐类别：' + categories.map(c => c.category + '类(' + c.name + ')').join(', ') + '\n\nREADME摘要：\n' + (repo.readme||'').slice(0,1500);
      
      const prompt = '基于以下GitHub项目信息，生成至少20个商标名称候选，覆盖不同路线（中文、英文、谐音、缩写、造字等）。每个名称要：\n- 2-6字/字母\n- 有可注册性\n- 匹配项目调性\n\n' + desc + '\n\n只返回JSON：{"names":[{"name":"名称","type":"中文/英文/谐音/缩写/造字","meaning":"含义（10字内）","route":"路线","score":0-100可注册性,"risk":"风险提示","category":推荐类别数字}]}';
      
      const result = await callMiniMaxChat({
        model: MODEL,
        messages: [
          { role: 'system', content: '你是资深品牌策划师+商标代理人，擅长为中国市场创意商标名。20+候选覆盖多风格，避免描述性词、通用词、地名、行业词。' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.8,
        max_tokens: 2000
      });
      
      if (result.status !== 200) {
        return sendJSON(res, 502, { error: 'UPSTREAM_ERROR', message: '生成失败' });
      }
      
      const text = result.data?.choices?.[0]?.message?.content || '';
      const jsonMatch = text.match(/\{[\s\S]+\}/);
      try {
        const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text);
        return sendJSON(res, 200, { success: true, model: MODEL, names: parsed.names || [] });
      } catch(e) {
        return sendJSON(res, 502, { error: 'PARSE_ERROR', message: 'JSON 解析失败' });
      }
    } catch (e) {
      sendJSON(res, 500, { error: 'INTERNAL_ERROR', message: e.message });
    }
    return;
  }

  sendJSON(res, 404, { error: 'NOT_FOUND', message: `路径 ${url.pathname} 不存在` });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[知产管家] 视觉服务 v2 运行在 http://127.0.0.1:${PORT}`);
  console.log(`  Model: ${MODEL} (supports_image: true)`);
  console.log(`  API: ${MINIMAX_API}`);
});
