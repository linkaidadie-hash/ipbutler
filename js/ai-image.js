// ai-image.js - 商标图样生成器 v0.6
// 文字商标生成器(SVG + Canvas 转 PNG,纯前端 0 成本)
// 后续可扩展 AI 图形商标(MiniMax image API)
(function () {
  'use strict';

  // ============ 字体风格(覆盖 90% 商标场景) ============
  const FONT_STYLES = [
    { id: 'hei', name: '黑体(稳重)', cssFamily: '"Source Han Sans CN", "Noto Sans CJK SC", "PingFang SC", "Microsoft YaHei", sans-serif', weight: 900, spacing: '0.15em' },
    { id: 'kai', name: '楷体(传统)', cssFamily: '"Kaiti SC", "STKaiti", "FangSong", serif', weight: 400, spacing: '0.2em' },
    { id: 'song', name: '宋体(经典)', cssFamily: '"Source Han Serif CN", "Noto Serif CJK SC", "SimSun", serif', weight: 700, spacing: '0.18em' },
    { id: 'yuan', name: '圆体(亲和)', cssFamily: '"Source Han Sans CN", "PingFang SC", "Microsoft YaHei", sans-serif', weight: 700, spacing: '0.2em' },
    { id: 'sharp', name: '硬朗(科技)', cssFamily: 'Impact, "Arial Black", "Microsoft YaHei", sans-serif', weight: 900, spacing: '0.1em' },
    { id: 'elegant', name: '优雅(高端)', cssFamily: '"Didot", "Times New Roman", "STSong", serif', weight: 400, spacing: '0.3em', italic: true }
  ];

  // ============ 装饰样式 ============
  const DECORATIONS = [
    { id: 'none', name: '无', render: () => '' },
    { id: 'line_top', name: '顶横线', render: (w, h, color) => `<line x1="20%" y1="22%" x2="80%" y2="22%" stroke="${color}" stroke-width="${h * 0.012}"/>` },
    { id: 'line_bottom', name: '底横线', render: (w, h, color) => `<line x1="20%" y1="78%" x2="80%" y2="78%" stroke="${color}" stroke-width="${h * 0.012}"/>` },
    { id: 'frame', name: '边框', render: (w, h, color) => `<rect x="8%" y="14%" width="84%" height="72%" fill="none" stroke="${color}" stroke-width="${h * 0.008}"/>` },
    { id: 'circle', name: '椭圆框', render: (w, h, color) => `<ellipse cx="50%" cy="50%" rx="42%" ry="34%" fill="none" stroke="${color}" stroke-width="${h * 0.008}"/>` },
    { id: 'diamond', name: '菱形点', render: (w, h, color) => `<polygon points="${w/2},${h*0.18} ${w*0.92},${h/2} ${w/2},${h*0.82} ${w*0.08},${h/2}" fill="none" stroke="${color}" stroke-width="${h * 0.006}"/>` }
  ];

  // ============ 主色预设(常用商标主色) ============
  const COLOR_PRESETS = [
    { name: '墨黑', value: '#1a1a1a' },
    { name: '中国红', value: '#c0392b' },
    { name: '深海蓝', value: '#1e3a5f' },
    { name: '森林绿', value: '#2d5a3d' },
    { name: '暖橙', value: '#d35400' },
    { name: '奢华金', value: '#b8860b' },
    { name: '典雅紫', value: '#6c3483' },
    { name: '纯白底', value: '#ffffff' }
  ];

  // ============ 生成单个 SVG 商标 ============
  function makeSvg(name, opts) {
    opts = opts || {};
    var font = FONT_STYLES.find(function (f) { return f.id === opts.fontId; }) || FONT_STYLES[0];
    var deco = DECORATIONS.find(function (d) { return d.id === opts.decorationId; }) || DECORATIONS[0];
    var color = opts.color || '#1a1a1a';
    var bg = opts.bgColor || '#ffffff';
    var w = 600, h = 600;
    var fontSize = name.length <= 2 ? h * 0.40 : name.length <= 4 ? h * 0.28 : h * 0.20;

    var decorSvg = deco.render(w, h, color);

    var svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + ' ' + h + '" width="' + w + '" height="' + h + '">' +
      '<rect width="100%" height="100%" fill="' + bg + '"/>' +
      decorSvg +
      '<text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" ' +
      'font-family=\'' + font.cssFamily + '\' ' +
      'font-weight="' + (font.weight || 700) + '" ' +
      'font-size="' + fontSize + '" ' +
      (font.italic ? 'font-style="italic" ' : '') +
      'letter-spacing="' + (font.spacing || '0.1em') + '" ' +
      'fill="' + color + '">' +
      escapeXml(name) +
      '</text>' +
      '</svg>';
    return svg;
  }

  function escapeXml(s) {
    return String(s).replace(/[<>&'"]/g, function (c) {
      return { '<': '&lt;', '>': '&gt;', '&': '&amp;', '\'': '&apos;', '"': '&quot;' }[c];
    });
  }

  // ============ 批量生成(8 个候选) ============
  function makeLogoBatch(name) {
    if (!name || !name.trim()) return [];
    name = name.trim();
    var variants = [
      { fontId: 'hei', decorationId: 'none', color: '#1a1a1a', bgColor: '#ffffff' },
      { fontId: 'hei', decorationId: 'line_bottom', color: '#c0392b', bgColor: '#ffffff' },
      { fontId: 'yuan', decorationId: 'none', color: '#1e3a5f', bgColor: '#ffffff' },
      { fontId: 'song', decorationId: 'frame', color: '#2d5a3d', bgColor: '#ffffff' },
      { fontId: 'kai', decorationId: 'none', color: '#1a1a1a', bgColor: '#fdf6e3' },
      { fontId: 'sharp', decorationId: 'line_top', color: '#1a1a1a', bgColor: '#ffffff' },
      { fontId: 'elegant', decorationId: 'line_bottom', color: '#b8860b', bgColor: '#ffffff' },
      { fontId: 'hei', decorationId: 'circle', color: '#6c3483', bgColor: '#ffffff' }
    ];
    return variants.map(function (v) { return makeSvg(name, v); });
  }

  // ============ SVG → PNG(Canvas) ============
  function svgToPng(svgStr, size) {
    size = size || 800;
    return new Promise(function (resolve, reject) {
      var img = new Image();
      var blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      img.onload = function () {
        try {
          var canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          var ctx = canvas.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, size, size);
          ctx.drawImage(img, 0, 0, size, size);
          URL.revokeObjectURL(url);
          canvas.toBlob(function (b) { resolve(b); }, 'image/png');
        } catch (e) { reject(e); }
      };
      img.onerror = function (e) { URL.revokeObjectURL(url); reject(e); };
      img.src = url;
    });
  }

  // ============ SVG → DataURL ============
  function svgToDataUrl(svgStr) {
    return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgStr)));
  }

  // ============ AI 自动适配商标局标准 ============
  // 标准:5×5cm~10×10cm,800×800px(@200dpi),纯白底,JPG < 1MB
  // 智能:检测主体 bounding box → 加 padding → 居中缩放 → 转 JPG
  const TRADEMARK_STANDARD = {
    targetSize: 800,           // 输出像素(10×10cm @ 200dpi)
    minSize: 591,              // 5×5cm @ 300dpi
    maxSize: 1181,             // 10×10cm @ 300dpi
    paddingRatio: 0.10,        // 主体周围留 10% 空白
    bgColor: '#ffffff',         // 标准底色(白色)
    jpgQuality: 0.85,           // JPG 质量
    maxBytes: 1024 * 1024,     // < 1MB
    threshold: 240             // 检测主体的灰度阈值(>240 视为白底)
  };

  function loadImage(src) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function (e) { reject(e); };
      img.src = src;
    });
  }

  // 检测主体 bounding box(非白/非透明像素)
  function detectSubjectBBox(canvas, threshold) {
    threshold = threshold || TRADEMARK_STANDARD.threshold;
    var ctx = canvas.getContext('2d');
    var w = canvas.width, h = canvas.height;
    var data = ctx.getImageData(0, 0, w, h).data;
    var minX = w, minY = h, maxX = -1, maxY = -1;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        var i = (y * w + x) * 4;
        var r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
        // 透明 或 接近白色 → 视为背景
        if (a < 30) continue;
        // 用亮度判断(更鲁棒)
        var brightness = (r * 299 + g * 587 + b * 114) / 1000;
        if (brightness >= threshold) continue;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
    if (maxX < minX || maxY < minY) return null; // 全是白底
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  // 主函数:blob → 适配商标局标准的 Blob
  async function autoFitToStandard(blob) {
    var originalSize = blob.size;
    var url = URL.createObjectURL(blob);
    try {
      var img = await loadImage(url);
      var origW = img.naturalWidth;
      var origH = img.naturalHeight;

      // 第一步:检测主体(先把原图画到 canvas 上来读像素)
      var detectCanvas = document.createElement('canvas');
      detectCanvas.width = origW;
      detectCanvas.height = origH;
      var dctx = detectCanvas.getContext('2d');
      dctx.drawImage(img, 0, 0);
      var subject = detectSubjectBBox(detectCanvas);

      // 第二步:计算裁剪区域(主体 + padding,或全图)
      var cropX, cropY, cropW, cropH;
      if (subject && subject.w > 10 && subject.h > 10) {
        var pad = TRADEMARK_STANDARD.paddingRatio;
        var padX = Math.round(subject.w * pad);
        var padY = Math.round(subject.h * pad);
        cropX = Math.max(0, subject.x - padX);
        cropY = Math.max(0, subject.y - padY);
        cropW = Math.min(origW - cropX, subject.w + padX * 2);
        cropH = Math.min(origH - cropY, subject.h + padY * 2);
      } else {
        // 没检测到主体(可能全白),用全图
        cropX = 0; cropY = 0; cropW = origW; cropH = origH;
      }

      // 第三步:等比缩放到目标尺寸
      var target = TRADEMARK_STANDARD.targetSize;
      var scale = Math.min(target / cropW, target / cropH);
      var drawW = Math.round(cropW * scale);
      var drawH = Math.round(cropH * scale);
      var offsetX = Math.round((target - drawW) / 2);
      var offsetY = Math.round((target - drawH) / 2);

      // 第四步:输出 canvas
      var out = document.createElement('canvas');
      out.width = target;
      out.height = target;
      var octx = out.getContext('2d');
      // 白底
      octx.fillStyle = TRADEMARK_STANDARD.bgColor;
      octx.fillRect(0, 0, target, target);
      // 平滑缩放绘制
      octx.imageSmoothingEnabled = true;
      octx.imageSmoothingQuality = 'high';
      octx.drawImage(img, cropX, cropY, cropW, cropH, offsetX, offsetY, drawW, drawH);

      // 第五步:转 Blob(JPG),循环压缩直到 < 1MB
      var quality = TRADEMARK_STANDARD.jpgQuality;
      var finalBlob = await new Promise(function (resolve) {
        out.toBlob(function (b) { resolve(b); }, 'image/jpeg', quality);
      });

      // 如果太大,降质量重试
      var attempts = 0;
      while (finalBlob && finalBlob.size > TRADEMARK_STANDARD.maxBytes && quality > 0.5 && attempts < 3) {
        quality -= 0.1;
        attempts++;
        finalBlob = await new Promise(function (resolve) {
          out.toBlob(function (b) { resolve(b); }, 'image/jpeg', quality);
        });
      }

      // 第六步:dataURL 用于预览
      var dataUrl = out.toDataURL('image/jpeg', quality);

      return {
        blob: finalBlob,
        dataUrl: dataUrl,
        original: { w: origW, h: origH, size: originalSize },
        result: { w: target, h: target, size: finalBlob ? finalBlob.size : 0, format: 'image/jpeg', quality: quality },
        crop: { x: cropX, y: cropY, w: cropW, h: cropH, subjectDetected: !!subject },
        applied: origW !== target || origH !== target || originalSize !== (finalBlob ? finalBlob.size : 0)
      };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // 格式化字节
  function formatBytes(b) {
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1024 / 1024).toFixed(2) + ' MB';
  }

  // ============ Vue 渲染:AI 图样工具面板 ============
  function renderAITrademarkPanel(self, h) {
    // 状态
    if (!self.aiImage) {
      self.aiImage = {
        show: false,
        name: '',
        results: [],
        generating: false,
        picked: null,
        aiStatus: 'ready'  // ready / ai-pending / ai-error (预留 AI 图形生成)
      };
    }

    var open = function () {
      self.aiImage.show = true;
      self.aiImage.results = [];
    };
    var close = function () { self.aiImage.show = false; };

    var generate = function () {
      if (!self.aiImage.name.trim()) {
        alert('请输入品牌名');
        return;
      }
      self.aiImage.generating = true;
      self.aiImage.results = [];
      setTimeout(function () {
        try {
          self.aiImage.results = makeLogoBatch(self.aiImage.name);
        } catch (e) {
          alert('生成失败: ' + e.message);
        }
        self.aiImage.generating = false;
      }, 100);
    };

    var adopt = async function (svgStr, idx) {
      try {
        var blob = await svgToPng(svgStr, 800);
        var reader = new FileReader();
        reader.onload = function (e) {
          self.inputs.imageBlob = blob;
          self.inputs.imagePreview = e.target.result;
          self.inputs.imageDims = { w: 800, h: 800 };
          self.inputs.imageOcrText = self.aiImage.name;  // 把品牌名当 OCR 文本,后续分析用
          self.aiImage.picked = idx;
          self.aiImage.show = false;
          if (window.__showToast) window.__showToast('✓ 已采用: ' + self.aiImage.name + ' (' + (idx + 1) + ' 号候选)');
        };
        reader.readAsDataURL(blob);
      } catch (e) {
        alert('采用失败: ' + e.message);
      }
    };

    // 触发按钮(始终显示)
    var trigger = h('div', { class: 'ai-trigger-row' }, [
      h('button', { class: 'btn-ai-image', onClick: open }, '🤖 AI 生成商标图样'),
      h('span', { class: 'ai-trigger-hint' }, '无现成图样?输入品牌名 1 秒生成 8 种文字商标候选')
    ]);

    if (!self.aiImage.show) return trigger;

    // 已展开的面板
    var resultGrid = self.aiImage.results.length === 0 ? null :
      h('div', { class: 'ai-result-grid' },
        self.aiImage.results.map(function (svg, idx) {
          var dataUrl = svgToDataUrl(svg);
          return h('div', { class: 'ai-result-card' + (self.aiImage.picked === idx ? ' picked' : '') }, [
            h('img', { src: dataUrl, alt: '候选 ' + (idx + 1) }),
            h('div', { class: 'ai-result-actions' }, [
              h('button', {
                class: 'btn-mini',
                onClick: function () { adopt(svg, idx); }
              }, '✓ 采用')
              ,
              h('a', {
                class: 'btn-mini ghost',
                href: dataUrl,
                download: (self.aiImage.name || 'logo') + '_' + (idx + 1) + '.svg',
                target: '_blank'
              }, '下载 SVG')
            ])
          ]);
        })
      );

    var panel = h('div', { class: 'ai-image-panel' }, [
      h('div', { class: 'ai-panel-head' }, [
        h('h4', null, '🤖 AI 商标图样生成器'),
        h('button', { class: 'btn-ghost btn-mini', onClick: close }, '✕ 关闭')
      ]),
      h('div', { class: 'ai-panel-form' }, [
        h('div', { class: 'ai-form-row' }, [
          h('label', null, '品牌名*'),
          h('input', {
            class: 'ht-input',
            value: self.aiImage.name,
            placeholder: '例:梧炅、梧凤、知产管家、CloudTech',
            onInput: function (e) { self.aiImage.name = e.target.value; }
          })
        ]),
        h('div', { class: 'ai-form-row' }, [
          h('label', null, '字体风格'),
          h('select', {
            class: 'ht-input',
            value: self.aiImage.fontId || 'hei',
            onChange: function (e) { self.aiImage.fontId = e.target.value; }
          }, FONT_STYLES.map(function (f) { return h('option', { value: f.id }, f.name); }))
        ]),
        h('div', { class: 'ai-form-row' }, [
          h('label', null, '装饰'),
          h('select', {
            class: 'ht-input',
            value: self.aiImage.decorationId || 'none',
            onChange: function (e) { self.aiImage.decorationId = e.target.value; }
          }, DECORATIONS.map(function (d) { return h('option', { value: d.id }, d.name); }))
        ]),
        h('div', { class: 'ai-form-row' }, [
          h('label', null, '主色'),
          h('div', { class: 'ai-color-row' },
            COLOR_PRESETS.map(function (c) {
              return h('button', {
                class: 'ai-color-dot' + ((self.aiImage.color || '#1a1a1a') === c.value ? ' active' : ''),
                style: 'background:' + c.value,
                title: c.name,
                onClick: function () { self.aiImage.color = c.value; }
              });
            })
          )
        ]),
        h('div', { class: 'ai-form-row' }, [
          h('label', null, ' '),
          h('button', {
            class: 'btn btn-primary',
            disabled: self.aiImage.generating,
            onClick: generate
          }, self.aiImage.generating ? '⏳ 生成中...' : '🚀 生成 8 个候选')
        ])
      ]),
      resultGrid,
      h('div', { class: 'ai-panel-foot' }, [
        '💡 提示:文字商标占中国商标申请 80%以上,无需图形也能注册。点"采用"会把图样填到当前上传区,后续可直接做 OCR + 申请书生成。'
      ])
    ]);

    return h('div', null, [trigger, panel]);
  }

  // ============ 暴露 ============
  window.AITrademarkImage = {
    FONT_STYLES: FONT_STYLES,
    DECORATIONS: DECORATIONS,
    COLOR_PRESETS: COLOR_PRESETS,
    TRADEMARK_STANDARD: TRADEMARK_STANDARD,
    makeSvg: makeSvg,
    makeLogoBatch: makeLogoBatch,
    svgToPng: svgToPng,
    svgToDataUrl: svgToDataUrl,
    autoFitToStandard: autoFitToStandard,
    detectSubjectBBox: detectSubjectBBox,
    formatBytes: formatBytes,
    renderAITrademarkPanel: renderAITrademarkPanel
  };
})();