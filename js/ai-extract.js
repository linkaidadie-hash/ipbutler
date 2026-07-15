/**
   * AI 提取模块
   * 包含：
   *   1. Tesseract.js OCR（识别营业执照 / 商标图样）+ 图片预处理
   *   2. AI 视觉识别（OpenAI/DeepSeek GPT-4V，识别倾斜反光图片）
   *   3. GitHub API 抓取（仓库元信息 + README）
   *   4. 本地文件读取（File API 拿源码）
   *   5. LLM 提取（OpenAI 兼容协议，结构化输出）
   */
const AiExtract = (() => {

  // ====== 1. OCR ======
  let _tesseractWorker = null;

  async function getWorker() {
    if (_tesseractWorker) return _tesseractWorker;
    if (!window.Tesseract) throw new Error('Tesseract.js 未加载');
    _tesseractWorker = await Tesseract.createWorker(['chi_sim', 'eng'], 1, {
      // 中文简体 + 英文，识别营业执照够用
      logger: m => { /* 可以接到 UI 进度 */ }
    });
    return _tesseractWorker;
  }

  /**
   * OCR 营业执照图片，提取关键字段
   * 返回: { rawText, fields: { companyName, creditCode, legalRep, address, ... } }
   */
  async function ocrBusinessLicense(imageBlob) {
    // 1. 始终优先用 AI 视觉 (key 在服务端)
    if (window.__showToast) window.__showToast('🤖 AI 视觉识别中...', 'info', 1500);
    try {
      const aiResult = await aiVisionBusinessLicense(imageBlob, null);
      if (aiResult && aiResult.fields) {
        // 即使部分字段为空也接受 (模型已返回结果)
        if (window.__showToast) window.__showToast('✓ AI 视觉识别成功', 'success');
        return aiResult;
      }
    } catch (e) {
      console.warn('[aiVision] failed', e.message);
      if (window.__showToast) window.__showToast('⚠️ AI 视觉失败: ' + e.message, 'error', 6000);
      // 不再降级到 Tesseract，直接返回错误
      throw e;
    }
  }

  // ============ 图片预处理 ============
  // Canvas:灰度 + 自适应阈值(去反光/去噪) + 高对比度
  async function preprocessImage(blob) {
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise(function (resolve, reject) {
        const i = new Image();
        i.onload = function () { resolve(i); };
        i.onerror = reject;
        i.src = url;
      });

      const w = img.naturalWidth, h = img.naturalHeight;
      if (w < 50 || h < 50) return blob;

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, w, h);
      const data = imageData.data;
      const len = w * h;

      // 1. 转灰度
      const gray = new Uint8ClampedArray(len);
      for (let i = 0; i < len; i++) {
        const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
        gray[i] = (r * 299 + g * 587 + b * 114) / 1000;
      }

      // 2. 自适应阈值(局部均值) — 去反光
      const winSize = 12;
      const result = new Uint8ClampedArray(len);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let sum = 0, count = 0;
          const yStart = Math.max(0, y - winSize);
          const yEnd = Math.min(h, y + winSize + 1);
          const xStart = Math.max(0, x - winSize);
          const xEnd = Math.min(w, x + winSize + 1);
          for (let yy = yStart; yy < yEnd; yy++) {
            for (let xx = xStart; xx < xEnd; xx++) {
              sum += gray[yy * w + xx];
              count++;
            }
          }
          const mean = sum / count;
          const threshold = mean * 0.82;
          result[y * w + x] = gray[y * w + x] < threshold ? 0 : 255;
        }
      }

      // 3. 写回 canvas
      for (let i = 0; i < len; i++) {
        const v = result[i];
        data[i * 4] = v;
        data[i * 4 + 1] = v;
        data[i * 4 + 2] = v;
        data[i * 4 + 3] = 255;
      }
      ctx.putImageData(imageData, 0, 0);

      // 4. 转 PNG(无损,适合文字)
      return await new Promise(function (resolve) {
        canvas.toBlob(function (b) { resolve(b || blob); }, 'image/png', 0.95);
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // ============ AI 视觉识别 (GPT-4V / DeepSeek-VL / Qwen-VL) ============
  // SHA256 helper using Web Crypto API
  async function computeSHA256(buffer) {
    const hash = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // EXIF orientation correction via canvas
  function getExifOrientation(arrayBuffer) {
    const view = new DataView(arrayBuffer);
    if (view.getUint16(0, false) !== 0xFFD8) return 1; // not JPEG
    let offset = 2;
    while (offset < view.buffer.byteLength) {
      const marker = view.getUint16(offset, false);
      offset += 2;
      if (marker === 0xFFE1) { // EXIF
        const exifOffset = offset + 6; // skip "Exif\0\0"
        view.getUint16(exifOffset, false); // byte order
        const isLittleEndian = view.getUint16(exifOffset, false) === 0x4949;
        const ifdOffset = exifOffset + view.getUint32(exifOffset + 4, isLittleEndian);
        const entries = view.getUint16(ifdOffset, isLittleEndian);
        for (let i = 0; i < entries; i++) {
          const entry = ifdOffset + 2 + i * 12;
          const tag = view.getUint16(entry, isLittleEndian);
          if (tag === 0x0112) { // orientation
            return view.getUint16(entry + 8, isLittleEndian);
          }
        }
        break;
      }
      offset += view.getUint16(offset, false);
    }
    return 1;
  }

  function applyOrientation(img, orientation) {
    const w = img.naturalWidth, h = img.naturalHeight;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    if (orientation >= 5 && orientation <= 8) {
      canvas.width = h; canvas.height = w;
    } else {
      canvas.width = w; canvas.height = h;
    }
    
    switch (orientation) {
      case 2: ctx.transform(-1, 0, 0, 1, w, 0); break;
      case 3: ctx.transform(-1, 0, 0, -1, w, h); break;
      case 4: ctx.transform(1, 0, 0, -1, 0, h); break;
      case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;
      case 6: ctx.transform(0, 1, -1, 0, h, 0); break;
      case 7: ctx.transform(0, -1, -1, 0, h, w); break;
      case 8: ctx.transform(0, -1, 1, 0, 0, w); break;
    }
    
    ctx.drawImage(img, 0, 0);
    return canvas;
  }

  // Load image, apply EXIF rotation, return original-quality blob
  async function loadImageWithOrientation(blob) {
    const arrayBuffer = await blob.arrayBuffer();
    const orientation = getExifOrientation(arrayBuffer.slice(0));
    
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise((resolve, reject) => {
        const i = new Image();
        i.onload = () => resolve(i);
        i.onerror = reject;
        i.src = url;
      });
      
      if (orientation !== 1) {
        const canvas = applyOrientation(img, orientation);
        // Export as high-quality JPEG
        const correctedBlob = await new Promise(resolve => 
          canvas.toBlob(resolve, 'image/jpeg', 0.95)
        );
        return correctedBlob;
      }
      return blob;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function aiVisionBusinessLicense(blob, settings) {
    // 1. Apply EXIF orientation correction
    var correctedBlob = blob;
    try {
      correctedBlob = await loadImageWithOrientation(blob);
    } catch (e) {
      console.warn('[EXIF] correction failed, using original', e);
      correctedBlob = blob;
    }

    // 2. Convert to base64 data URL
    const dataUrl = await new Promise(function (resolve, reject) {
      const r = new FileReader();
      r.onload = function () { resolve(r.result); };
      r.onerror = reject;
      r.readAsDataURL(correctedBlob);
    });

    // 3. Compute SHA256 of the original image bytes
    const arrayBuffer = await correctedBlob.arrayBuffer();
    const hash = await computeSHA256(arrayBuffer);
    console.log('[VISION] image sha256=' + hash.substring(0, 8) + ' size=' + arrayBuffer.byteLength + ' type=' + correctedBlob.type);

    // 4. Call backend proxy with hash verification
    const resp = await fetch('/api/vision/business-license', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataUrl, clientHash: hash })
    });

    const data = await resp.json();

    // 5. Log verification result
    if (data.imageHash) {
      console.log('[VISION] server hash=' + data.imageHash + ' match=' + (data.imageHash === hash.substring(0, 8)));
    }

    if (!resp.ok) {
      var msg = data.message || data.error || '未知错误';
      if (resp.status === 401) msg = 'API Key 无效或已过期，请在设置中检查 (401)';
      else if (resp.status === 400) msg = '模型不支持图片输入或参数错误 (400): ' + msg;
      else if (resp.status === 404) msg = '模型或接口地址错误 (404): ' + msg;
      else if (resp.status === 413) msg = '图片过大，请压缩到 15MB 以下后重试 (413)';
      else if (resp.status === 429) msg = 'API 调用频率超限，请稍后重试 (429)';
      else if (resp.status === 502) msg = '上游 AI 服务失败 (502): ' + msg;
      else if (resp.status === 504) msg = 'AI 请求超时 (504): ' + msg;
      else msg = '服务器错误 (' + resp.status + '): ' + msg;
      throw new Error(msg);
    }
    
    // Handle network errors (Failed to fetch)
    if (!resp.ok && !msg) {
      throw new Error('无法连接服务器，请检查网络连接');
    }

    if (!data.success || !data.fields) {
      throw new Error(data.message || 'AI 视觉识别返回异常');
    }

    // 6. Map new field names to old field names for compatibility
    var f = data.fields;
    return {
      rawText: data.rawText || '',
      fields: {
        companyName: f.company_name || '',
        creditCode: f.unified_social_credit_code || '',
        companyType: f.company_type || '',
        legalRep: f.legal_representative || '',
        address: f.address || '',
        registeredCapital: f.registered_capital || '',
        establishedDate: f.established_date || '',
        businessScope: f.business_scope || '',
        businessTerm: '',
      },
      meta: {
        model: data.model,
        imageHash: data.imageHash,
        validationErrors: data.validationErrors || [],
        shouldAutoFill: data.shouldAutoFill !== false,
      }
    };
  }

  function parseBusinessLicenseText(text) {
    const result = {
      companyName: '',
      creditCode: '',
      legalRep: '',
      address: '',
      registeredCapital: '',
      companyType: ''
    };

    // 统一社会信用代码：18 位字母数字组合
    const creditMatch = text.match(/[0-9A-Z]{18}/);
    if (creditMatch) result.creditCode = creditMatch[0];

    // 名称：含"有限公司" / "股份有限公司" / "有限责任公司" / "集团" 等
    const nameMatch = text.match(/名称[：:]\s*([^\n]+)/) ||
                      text.match(/([^\n]*?(?:有限公司|股份有限公司|有限责任公司|集团|公司))/);
    if (nameMatch) result.companyName = nameMatch[1].trim();

    // 法定代表人
    const repMatch = text.match(/法定代表人[：:]\s*([^\s\n]+)/) ||
                     text.match(/法人[：:]\s*([^\s\n]+)/) ||
                     text.match(/经营者[：:]\s*([^\s\n]+)/);
    if (repMatch) result.legalRep = repMatch[1].trim();

    // 住所 / 地址
    const addrMatch = text.match(/(?:住所|地址)[：:]\s*([^\n]+)/);
    if (addrMatch) result.address = addrMatch[1].trim();

    // 注册资本
    const capMatch = text.match(/注册资本[：:]\s*([^\n]+)/);
    if (capMatch) result.registeredCapital = capMatch[1].trim();

    return result;
  }

  // ====== 2. GitHub ======
  /**
   * 解析 GitHub URL：https://github.com/owner/repo
   */
  function parseGithubUrl(url) {
    const m = String(url).match(/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git|\/.*)?$/);
    if (!m) return null;
    return { owner: m[1], repo: m[2] };
  }

  /**
   * 拉取 GitHub 仓库元信息 + README
   */
  async function fetchGithub(url) {
    const parsed = parseGithubUrl(url);
    if (!parsed) throw new Error('GitHub URL 格式不对，应为 https://github.com/owner/repo');

    const headers = { 'Accept': 'application/vnd.github.v3+json' };
    // 如果用户配了 GitHub token，附上（提升 rate limit）
    // Read token from settings (set by app.js) or fallback to localStorage
    var token = '';
    if (window.__ipbutlerSettings && window.__ipbutlerSettings.githubToken) {
      token = window.__ipbutlerSettings.githubToken;
    } else {
      token = localStorage.getItem('ip-butler-github-token') || localStorage.getItem('githubToken') || '';
    }
    if (token) headers['Authorization'] = `token ${token}`;

    // 仓库元信息
    const repoResp = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}`, { headers });
    if (!repoResp.ok) throw new Error(`GitHub API 错误: ${repoResp.status}（私有仓库需要 token，请到设置配置）`);
    const repo = await repoResp.json();

    // README
    let readme = '';
    try {
      const readmeResp = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/readme`, { headers });
      if (readmeResp.ok) {
        const data = await readmeResp.json();
        if (data.content) {
          // Use TextDecoder for proper Chinese decoding
          try {
            const bytes = Uint8Array.from(atob(data.content.replace(/\n/g, '')), c => c.charCodeAt(0));
            readme = new TextDecoder('utf-8').decode(bytes);
          } catch(e) { readme = atob(data.content.replace(/\n/g, '')); }
        }
      }
    } catch (e) {}

    // 语言统计
    let languages = {};
    try {
      const langResp = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/languages`, { headers });
      if (langResp.ok) languages = await langResp.json();
    } catch (e) {}

    // 目录树
    let tree = [];
    try {
      const treeResp = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/git/trees/${repo.default_branch}?recursive=1`, { headers });
      if (treeResp.ok) {
        const treeData = await treeResp.json();
        tree = (treeData.tree || []).filter(t => t.type === 'blob' || t.type === 'tree').slice(0, 100).map(t => t.path);
      }
    } catch(e) {}

    // 分支列表
    let branches = [];
    try {
      const branchResp = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/branches?per_page=10`, { headers });
      if (branchResp.ok) branches = (await branchResp.json()).map(b => b.name);
    } catch(e) {}

    // 获取 HEAD commit SHA（版本冻结标识）
    let commitSha = '';
    try {
      const commitResp = await fetch(`https://api.github.com/repos/${parsed.owner}/${parsed.repo}/commits/${repo.default_branch}`, { headers });
      if (commitResp.ok) {
        const commitData = await commitResp.json();
        commitSha = commitData.sha ? commitData.sha.substring(0, 7) : '';
      }
    } catch(e) {}

    // Read source code files from the tree - only real executable/build-participating source code
    var codeExts = /\.(js|ts|jsx|tsx|py|java|go|rs|c|cpp|h|hpp|cs|rb|php|swift|kt|scala|sh|sql|vue|svelte|html|css|scss|less|yaml|yml|json|mjs|cjs)$/i;
    var excludePattern = /node_modules|\.git\/|dist\/|build\/|coverage\/|vendor\/|__pycache__\/|\.next\/|target\/|bower_components\/|\.cache\/|\.pytest_cache\/|\.vercel\/|\.nuxt\/|out\/|\.output\/|gen\/|generated\/|auto_generated\/|\.openapi\/|docs\/|doc\/|documentation\/|wiki\/|examples\/|samples\/|templates\/|mocks?\/|test\/|tests\/|__tests__\/|spec\/|e2e\//i;
    var excludeFiles = /\.min\.|\.bundle\.|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock|\.map$|\.gz$|\.zip$|\.tar|\.png$|\.jpg$|\.jpeg$|\.gif$|\.svg$|\.ico$|\.woff|\.ttf|\.eot|\.pdf$|\.env$|\.env\.|swagger\.json|openapi\.json|^README|^CHANGELOG|^LICENSE|^CONTRIBUTING|^NOTICE|^AUTHORS|验收|阶段|报告|安全|说明/i;
    var excludeFileNames = /README|CHANGELOG|LICENSE|CONTRIBUTING|NOTICE|AUTHORS|验收|阶段报告|安全说明/i;
    
    var codeFiles = tree.filter(function(p) {
      if (excludePattern.test(p)) return false;
      if (excludeFiles.test(p)) return false;
      // Exclude by base file name (without path)
      var baseName = p.split('/').pop().replace(/\.[^.]+$/, '');
      if (excludeFileNames.test(baseName)) return false;
      return codeExts.test(p);
    });
    
    // Limit: max 100 files, max 2MB total
    var MAX_FILES = 100;
    var MAX_BYTES = 2 * 1024 * 1024;
    var skipped = 0;
    var readFailed = 0;
    var totalBytes = 0;
    var sourceFiles = [];
    var totalLines = 0;
    
    for (var i = 0; i < codeFiles.length && sourceFiles.length < MAX_FILES; i++) {
      var filePath = codeFiles[i];
      // Check size limit
      if (totalBytes > MAX_BYTES) { skipped += codeFiles.length - i; break; }
      
      try {
        var contentResp = await fetch('https://api.github.com/repos/' + parsed.owner + '/' + parsed.repo + '/contents/' + encodeURIComponent(filePath) + '?ref=' + repo.default_branch, { headers });
        if (!contentResp.ok) { readFailed++; continue; }
        var fileData = await contentResp.json();
        if (!fileData.content) { readFailed++; continue; }
        
        // Decode using TextDecoder
        var rawBytes = Uint8Array.from(atob(fileData.content.replace(/\n/g, '')), function(c) { return c.charCodeAt(0); });
        var text = new TextDecoder('utf-8').decode(rawBytes);
        var lines = text.split('\n').length;
        
        sourceFiles.push({ name: filePath, size: fileData.size || rawBytes.length, text: text, lines: lines });
        totalLines += lines;
        totalBytes += rawBytes.length;
      } catch(e) { readFailed++; }
    }
    
    return {
      owner: parsed.owner,
      repo: parsed.repo,
      name: repo.name,
      fullName: repo.full_name,
      description: repo.description || '',
      stars: repo.stargazers_count,
      forks: repo.forks_count,
      language: repo.language,
      languages,
      license: repo.license ? (repo.license.spdx_id || repo.license.name) : '',
      homepage: repo.homepage || '',
      createdAt: repo.created_at,
      updatedAt: repo.updated_at,
      defaultBranch: repo.default_branch,
      commitSha: commitSha,
      topics: repo.topics || [],
      readme: readme.slice(0, 8000),
      tree, branches,
      private: repo.private,
      // Source code files
      sourceFiles: sourceFiles,
      sourceTotalLines: totalLines,
      stats: {
        discovered: codeFiles.length,
        read: sourceFiles.length,
        skipped: skipped,
        failed: readFailed,
        totalLines: totalLines,
        totalBytes: totalBytes,
        truncated: codeFiles.length > MAX_FILES || totalBytes > MAX_BYTES
      }
    };
  }

  // ====== 3. 本地文件 ======
  /**
   * 读取用户通过文件选择器选的源码文件夹
   * 返回 { files: [{name, size, text, lines}], totalLines, totalSize }
   */
  async function readSourceFiles(fileList) {
    const files = [];
    let totalLines = 0;
    let totalSize = 0;

    // 支持的源码后缀 - 排除 .md/.xml/.toml/.cfg/.ini/.conf 等文档和配置文件
    const codeExts = /\.(py|js|ts|jsx|tsx|java|cpp|c|h|hpp|cs|go|rs|php|rb|swift|kt|html|css|scss|less|yaml|yml|json|sh|sql|vue|svelte|mjs|cjs|dart|lua|r|graphql)$/i;

    for (const file of fileList) {
      if (!codeExts.test(file.name)) continue;
      // Skip node_modules, build artifacts, vendor libraries, docs
      var path = file.webkitRelativePath || file.name;
      if (/node_modules|\.git\/|dist\/|build\/|vendor\/|__pycache__\/|\.next\/|target\/|bower_components\/|docs\/|doc\/|test\/|tests\//.test(path)) continue;
      // Skip README, CHANGELOG, reports, docs by file name
      if (/README|CHANGELOG|LICENSE|CONTRIBUTING|NOTICE|验收|阶段|报告|安全|说明/i.test(file.name.replace(/\.[^.]+$/, ''))) continue;
      // Skip minified, compiled and lock files
      if (/\.min\.|\.bundle\.|package-lock\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock/i.test(file.name)) continue;
      // 跳过超大文件
      if (file.size > 2 * 1024 * 1024) continue; // > 2MB 跳过
      const text = await file.text();
      const lines = text.split(/\r?\n/).length;
      files.push({ name: file.webkitRelativePath || file.name, size: file.size, text, lines });
      totalLines += lines;
      totalSize += file.size;
    }
    return { files, totalLines, totalSize };
  }

  // ====== 4. LLM 提取 ======
  /**
   * 调用 LLM 提取结构化信息
   * userSettings: { baseUrl, apiKey, model }
   * input: { type: 'trademark'|'software', text, githubData, ocrData, sourceFilesData }
   */
  async function llmExtract(type, input, settings) {
    // Build context string
    const context = [];
    if (input.ocrText) context.push('【营业执照 OCR 识别结果】\n' + input.ocrText);
    if (input.github) {
      const g = input.github;
      context.push('【GitHub 仓库信息】\n仓库：' + g.fullName + '\n描述：' + g.description + '\n主语言：' + g.language + '\nLicense：' + (g.license||'') + '\n创建时间：' + g.createdAt + '\nREADME（前3000字）：\n' + (g.readme||'').slice(0,3000));
    }
    if (input.sourceFiles && input.sourceFiles.length > 0) {
      const summary = input.sourceFiles.slice(0,30).map(f => '- ' + f.name + ' (' + f.lines + ' 行)').join('\n');
      context.push('【源码文件】（共' + input.sourceFiles.length + '个，' + input.totalLines + '行）\n' + summary);
    }
    if (input.freeText) context.push('【用户自述】\n' + input.freeText);
    
    const resp = await fetch('/api/llm/extract', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: type, context: context.join('\n\n') })
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.message || data.error || 'LLM 请求失败 (' + resp.status + ')');
    return data.fields;
  }

  // ====== 5. 智能分类推荐（无 LLM 时的 fallback） ======
  /**
   * 基于关键词推荐商标 Nice 分类
   */
  function suggestCategory(text) {
    const lower = String(text || '').toLowerCase();
    const rules = [
      { kw: ['软件', 'app', '代码', '开发', '编程', 'saas', '系统', '平台', '网站', '小程序', '计算机', '云', '数据', '算法', 'ai', '人工智能', '科技'], cat: 42, label: '科技服务' },
      { kw: ['广告', '营销', '品牌', '推广', '策划'], cat: 35, label: '广告商业' },
      { kw: ['教育', '培训', '课程', '学校', '教学'], cat: 41, label: '教育娱乐' },
      { kw: ['食品', '零食', '饮料', '茶', '酒', '咖啡', '吃', '餐厅', '餐饮', '外卖'], cat: 30, label: '茶糖糕点' },
      { kw: ['服装', '衣服', '鞋子', '帽子', '袜', '时装'], cat: 25, label: '服装鞋帽' },
      { kw: ['家具', '沙发', '床', '桌椅'], cat: 20, label: '家具' },
      { kw: ['美妆', '化妆', '护肤', '香水', '美容', '面膜', '口红'], cat: 3, label: '日化用品' },
      { kw: ['玩具', '游戏', '体育', '健身'], cat: 28, label: '玩具用品' },
      { kw: ['首饰', '珠宝', '项链', '戒指', '手表'], cat: 14, label: '珠宝钟表' },
      { kw: ['书', '出版', '印刷', '文具'], cat: 16, label: '办公用品' },
      { kw: ['物流', '快递', '运输', '仓储', '货运'], cat: 39, label: '运输配送' },
      { kw: ['医疗', '医院', '诊所', '药品', '药', '健康'], cat: 5, label: '医药' },
      { kw: ['酒店', '民宿', '住宿', '旅馆'], cat: 43, label: '餐饮住宿' },
      { kw: ['金融', '银行', '贷款', '支付', '保险', '投资'], cat: 36, label: '金融保险' },
      { kw: ['电商', '零售', '批发', '销售', '商城', '店铺'], cat: 35, label: '广告商业' },
      { kw: ['建站', '装修', '建筑', '工程', '施工'], cat: 37, label: '建筑修理' }
    ];
    for (const r of rules) {
      if (r.kw.some(k => lower.includes(k))) return r;
    }
    return { cat: 42, label: '科技服务' }; // 默认
  }

  // ====== 6. 商标专业评估 ======
  /**
   * AI 商标创意生成：基于产品描述生成 5-10 个商标候选
   */
  async function generateTrademarkIdeas(input, settings) {
    if (!settings || !settings.apiKey) {
      throw new Error('请先配置 API Key');
    }
    const systemPrompt = `你是资深品牌策划师 + 商标代理人，擅长为中国市场创意商标名。要求：
1. **简短好记**：2-4 字最佳，最多 6 字
2. **初步显著性高**：避免描述性/通用词/地名/行业词
3. **多风格**：中文/英文/谐音/缩写/造字混搭
4. **可申请图形**：名字本身有视觉化潜力
5. **避开常见近似词**：避免"智""慧""云""数"等烂大街的字`;
    const userPrompt = `基于以下产品/服务描述，生成 8 个商标候选名字：

【产品/服务】${input.product || '（未提供）'}
【行业】${input.industry || '（未提供）'}
【目标客户】${input.target || '（未提供）'}
【品牌调性】${input.tone || '专业、简洁、现代'}
【已用名（如有）】${input.existing || '（无）'}
【希望的方向】${input.direction || '不限'}

按以下 JSON 输出：
{
  "ideas": [
    {
      "name": "商标名（2-6字）",
      "type": "中文 / 英文 / 谐音 / 缩写 / 造字",
      "meaning": "含义说明（10字内）",
      "suitable_for": "适合的产品/调性（10字内）",
      "distinctiveness_score": 0-100 初步显著性评分,
      "text_risk_score": 0-100 文字风险评分(越低越好)
    }
  ],
  "rationale": "整体命名策略说明（1-2句话）"
}`;

    const baseUrl = (settings.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
    const model = settings.model || 'gpt-4o-mini';
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.8,
        response_format: { type: 'json_object' }
      })
    });
    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`LLM API 错误 (${resp.status}): ${err.slice(0, 200)}`);
    }
    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('LLM 没返回有效 JSON：' + content.slice(0, 200));
    return JSON.parse(jsonMatch[0]);
  }

  /**
   * AI 商标专业评估：驳回风险 + 近似风险 + 类别建议 + 整体评分
   */
  async function analyzeTrademark(input, settings) {
    if (!settings || !settings.apiKey) {
      throw new Error('请先配置 API Key');
    }
    const systemPrompt = `你是资深中国商标代理人（10 年经验），熟悉商标局审查标准、《商标法》及尼斯分类。基于用户提供的商标信息，给出专业评估。严格只输出 JSON。`;
    const userPrompt = `请评估以下商标申请：

【商标名称】${input.name}
【商标类型】${input.type}
【已选类别】第 ${input.categories.join('、第 ')} 类（共 ${input.categories.length} 类）
【商品/服务项目】
${input.goods || '（未填）'}
【用途/描述】${input.description || '（未填）'}

按以下 schema 输出 JSON：
{
  "score": 0-100 综合评分（越高越容易通过）,
  "risk_level": "low/medium/high（驳回风险等级）",
  "risk_reasons": ["驳回原因1", "驳回原因2"],
  "similar_risk": "可能的近似/在先商标风险描述（基于名称特征）",
  "category_advice": "类别选择建议（是否需要增/删）",
  "goods_advice": "商品/服务选择建议（过宽/过窄/合理）",
  "priority_checklist": ["提交前必查项1", "必查项2"],
  "overall": "总体建议（1-2 句话）"
}`;

    const baseUrl = (settings.baseUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
    const model = settings.model || 'gpt-4o-mini';
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.3,
        response_format: { type: 'json_object' }
      })
    });
    if (!resp.ok) {
      const err = await resp.text();
      throw new Error(`LLM API 错误 (${resp.status}): ${err.slice(0, 200)}`);
    }
    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || '';
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('LLM 没返回有效 JSON：' + content.slice(0, 200));
    return JSON.parse(jsonMatch[0]);
  }

  return {
    ocrBusinessLicense,
    fetchGithub,
    parseGithubUrl,
    readSourceFiles,
    llmExtract,
    suggestCategory,
    analyzeTrademark,
    generateTrademarkIdeas
  };
})();

// 暴露到 window,方便 app.js 强制调用 OCR 等
if (typeof window !== 'undefined') {
  window.AiExtract = AiExtract;
}
