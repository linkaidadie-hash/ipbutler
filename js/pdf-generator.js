/**
 * 知产管家 - PDF 生成器
 * 用 jsPDF 生成符合商标局 / 版权中心格式的 PDF
 */
const PdfGenerator = (() => {
  const { jsPDF } = window.jspdf;
  const autoTable = window.jspdfAutotable || window['jspdf-autotable'];
  
  // Chinese font support - load once and cache
  let _chineseFontBase64 = null;
  let _chineseFontError = '';
  
  async function loadChineseFont() {
    if (_chineseFontBase64) return _chineseFontBase64;
    if (_chineseFontError) return null;
    var urls = ['/fonts/NotoSansSC-true.ttf'];
    var lastErr = null;
    for (var u = 0; u < urls.length; u++) {
      try {
        var resp = await fetch(urls[u]);
        if (!resp.ok) { lastErr = urls[u] + ' HTTP ' + resp.status; continue; }
        var ct = resp.headers.get('content-type') || '';
        if (ct.indexOf('text/html') >= 0) { lastErr = urls[u] + ' returned HTML'; continue; }
        var buf = await resp.arrayBuffer();
        if (buf.byteLength < 10000) { lastErr = urls[u] + ' too small: ' + buf.byteLength; continue; }
        var bytes = new Uint8Array(buf);
        var binary = '';
        var chunkSize = 8192;
        for (var i = 0; i < bytes.length; i += chunkSize) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunkSize, bytes.length)));
        }
        _chineseFontBase64 = btoa(binary);
        return _chineseFontBase64;
      } catch(e) {
        lastErr = urls[u] + ': ' + e.message;
        continue;
      }
    }
    _chineseFontError = lastErr || 'all font sources failed';
    return null;
  }
  
  function applyChineseFont(doc) {
    if (!_chineseFontBase64) throw new Error('font not loaded');
    doc.addFileToVFS('NotoSansSC.ttf', _chineseFontBase64);
    doc.addFont('NotoSansSC.ttf', 'NotoSansSC', 'normal');
    doc.addFont('NotoSansSC.ttf', 'NotoSansSC', 'bold');
    doc.setFont('NotoSansSC', 'normal');
  }
  
  function setChineseFont(doc, style, size) {
    doc.setFont('NotoSansSC', style || 'normal');
    if (size) doc.setFontSize(size);
  }

  function checkMarkImageDataUrl(project) {
    if (project && project.data && project.data.markImage) return project.data.markImage;
    if (project && project.markImage) return project.markImage;
    if (window._currentMarkImage) return window._currentMarkImage;
    return null;
  }
  function setMarkImage(dataUrl) { window._currentMarkImage = dataUrl; }
  function clearMarkImage() { window._currentMarkImage = null; }

  function validateFields(project, applicant, type) {
    const errors = [];
    if (!applicant.name) errors.push('申请人名称未填');
    if (!applicant.creditCode && applicant.type === 'company') errors.push('统一社会信用代码未填');
    if (type === 'trademark') {
      if (!project.trademarkName) errors.push('商标名称未填');
      if (!project.category || project.category < 1) errors.push('商标类别未选');
    } else if (type === 'software') {
      if (!project.softwareName) errors.push('软件名称未填');
    }
    return errors;
  }
  
  // ====== 1. 商标申请书 ======
  async function generateTrademarkApplication(project, applicant) {
    var font = await loadChineseFont();
    if (!font) throw new Error('中文字体加载失败: ' + _chineseFontError);
    const errors = validateFields(project, applicant, 'trademark');
    if (errors.length) {
      return { error: true, message: '字段不完整：' + errors.join('、') };
    }
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    applyChineseFont(doc);
    doc.setFont('NotoSansSC', 'bold');
    doc.setFontSize(20);
    doc.text('商标注册申请书', 105, 25, { align: 'center' });
    doc.setFontSize(9);
    doc.setFont('NotoSansSC', 'normal');
    doc.setTextColor(100);
    doc.text('Application for Trademark Registration', 105, 32, { align: 'center' });
    doc.setTextColor(0);

    let y = 50;
    const leftX = 25;
    const labelW = 30;
    const valueX = leftX + labelW;

    doc.setFontSize(11);
    doc.setFont('NotoSansSC', 'bold');
    doc.text('一、申请人信息', leftX, y);
    y += 8;

    doc.setFont('NotoSansSC', 'normal');
    doc.setFontSize(10);

    function row(label, value) {
      doc.setFont('NotoSansSC', 'bold');
      doc.text(label, leftX, y);
      doc.setFont('NotoSansSC', 'normal');
      const lines = doc.splitTextToSize(String(value || '-'), 130);
      doc.text(lines, valueX, y);
      y += Math.max(6, lines.length * 5);
    }

    const apTypeLabel = applicant.type === 'individual' ? '个人' : '企业';
    row('申请人类型：', apTypeLabel);
    row('申请人名称：', applicant.name);
    row('证件号码：', applicant.creditCode);
    row('联系电话：', applicant.phone);
    if (applicant.email) row('电子邮箱：', applicant.email);
    row('通讯地址：', applicant.address);

    y += 6;
    doc.setFontSize(11);
    doc.setFont('NotoSansSC', 'bold');
    doc.text('二、商标信息', leftX, y);
    y += 8;
    doc.setFontSize(10);

    const data = project.data || {};
    row('商标名称：', project.name);
    const typeMap = {
      '文字': '文字商标', '图形': '图形商标', '字母': '字母商标',
      '数字': '数字商标', '三维': '三维标志商标', '组合': '图文组合商标'
    };
    row('商标类型：', typeMap[data.markType] || data.markType || '-');
    row('商标图样：', '另附（5 份，长和宽不超 10cm×10cm，不少于 5cm×5cm）');

    const img = checkMarkImageDataUrl(project);
    if (img && (data.markType === '图形' || data.markType === '组合')) {
      try {
        doc.addImage(img, 'PNG', valueX, y - 4, 30, 30);
        y += 32;
      } catch (e) { console.warn('图样插入失败', e); }
    }

    y += 4;
    row('商标类别：', `第 ${data.category || '-'} 类（共 45 类，Nice 分类）`);

    if (data.goods && data.goods.trim()) {
      doc.setFont('NotoSansSC', 'bold');
      doc.text('商品/服务项目：', leftX, y);
      y += 6;
      doc.setFont('NotoSansSC', 'normal');
      const lines = doc.splitTextToSize(data.goods.trim(), 160);
      doc.text(lines, leftX, y);
      y += lines.length * 5 + 4;
    }

    y += 4;
    doc.setFontSize(11);
    doc.setFont('NotoSansSC', 'bold');
    doc.text('三、申请声明', leftX, y);
    y += 8;
    doc.setFontSize(10);
    doc.setFont('NotoSansSC', 'normal');
    const claims = [
      '☑ 基于真实使用意图申请',
      '☑ 商标图样清晰，申请类别准确'
    ];
    if (data.priorityClaim) claims.push('☑ 要求优先权');
    claims.forEach(c => { doc.text(c, leftX, y); y += 6; });

    y += 4;
    doc.setFontSize(11);
    doc.setFont('NotoSansSC', 'bold');
    doc.text('四、规费说明', leftX, y);
    y += 8;
    doc.setFontSize(10);
    doc.setFont('NotoSansSC', 'normal');
    doc.text('商标局规费 ¥270/类（含 10 个商品/服务项），超出每项 ¥30。', leftX, y);
    y += 10;

    doc.setFontSize(10);
    doc.text('申请人签字 / 盖章：____________________', leftX, y);
    y += 10;
    doc.text('申请日期：____ 年 ____ 月 ____ 日', leftX, y);

    y = 270;
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text('本申请书由"知产管家"生成草稿。请以商标局网上系统提交信息为准。', 105, y, { align: 'center' });
    doc.text('商标局网上服务系统：sbj.cnipa.gov.cn/sbj', 105, y + 5, { align: 'center' });

    clearMarkImage();
    return doc;
  }

  // ====== 2. 软件著作权申请表 ======
  async function generateSoftwareApplication(project, applicant) {
    var font = await loadChineseFont();
    if (!font) throw new Error('中文字体加载失败: ' + _chineseFontError);
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    applyChineseFont(doc);
    doc.setFont('NotoSansSC', 'bold');
    doc.setFontSize(18);
    doc.text('计算机软件著作权登记申请表', 105, 20, { align: 'center' });

    doc.setFontSize(9);
    doc.setFont('NotoSansSC', 'normal');
    doc.text('Application for Copyright Registration of Computer Software', 105, 27, { align: 'center' });

    let y = 42;
    const leftX = 20;
    const labelW = 38;
    const valueX = leftX + labelW;

    doc.setFontSize(10);

    function row2(label1, value1, label2, value2) {
      doc.setFont('NotoSansSC', 'bold');
      doc.text(label1, leftX, y);
      doc.setFont('NotoSansSC', 'normal');
      doc.text(String(value1 || '-'), leftX + labelW, y);
      if (label2) {
        doc.setFont('NotoSansSC', 'bold');
        doc.text(label2, 110, y);
        doc.setFont('NotoSansSC', 'normal');
        doc.text(String(value2 || '-'), 148, y);
      }
      y += 7;
    }
    function row(label, value) {
      doc.setFont('NotoSansSC', 'bold');
      doc.text(label, leftX, y);
      doc.setFont('NotoSansSC', 'normal');
      var lines = doc.splitTextToSize(String(value || '-'), 130);
      doc.text(lines, valueX, y);
      y += Math.max(7, lines.length * 5);
    }

    doc.setFontSize(12);
    doc.setFont('NotoSansSC', 'bold');
    doc.text('软件基本信息', leftX, y);
    y += 8;

    const data = project.data || {};
    doc.setFontSize(10);
    row('软件全称：', project.name);
    row2('软件简称：', data.abbr || '-', '版本号：', data.version ? 'V' + data.version : '-');
    row2('开发完成日期：', data.completionDate || '-', '首次发表日期：', data.publishDate || '未发表');
    row2('发表状态：', data.publishStatus || '未发表', '开发语言：', data.lang || '-');
    row2('代码行数：', data.lines ? data.lines + ' 行' : '-', '', '');

    y += 2;
    doc.setFont('NotoSansSC', 'bold');
    doc.text('技术特点 / 用途：', leftX, y);
    y += 6;
    doc.setFont('NotoSansSC', 'normal');
    const features = doc.splitTextToSize(data.features || '（软件说明）', 170);
    doc.text(features, leftX, y);
    y += features.length * 5 + 4;

    if (y > 230) { doc.addPage(); y = 20; }
    doc.setFontSize(12);
    doc.setFont('NotoSansSC', 'bold');
    doc.text('著作权人信息', leftX, y);
    y += 8;
    doc.setFontSize(10);
    row('著作权人类型：', applicant.type === 'individual' ? '个人' : '法人（企业）');
    row('姓名 / 名称：', applicant.name);
    row('证件号码：', applicant.creditCode);
    row('通讯地址：', applicant.address);
    row('联系电话：', applicant.phone);
    if (applicant.email) row('电子邮箱：', applicant.email);

    if (y > 230) { doc.addPage(); y = 20; }
    y += 4;
    doc.setFontSize(12);
    doc.setFont('NotoSansSC', 'bold');
    doc.text('权利取得方式', leftX, y);
    y += 8;
    doc.setFontSize(10);
    doc.setFont('NotoSansSC', 'normal');
    const rightMark = data.rightWay === '继承' ? '○' : data.rightWay === '受让' ? '○' : '●';
    const transferMark = data.rightWay === '受让' ? '●' : '○';
    const inheritMark = data.rightWay === '继承' ? '●' : '○';
    doc.text(`${inheritMark} 继承  ${transferMark} 受让  ${rightMark} 原始`, leftX, y);
    y += 8;

    row('权利范围：', '● 全部权利   ○ 部分权利');

    if (y > 230) { doc.addPage(); y = 20; }
    y += 4;
    doc.setFontSize(12);
    doc.setFont('NotoSansSC', 'bold');
    doc.text('申请办理方式', leftX, y);
    y += 8;
    doc.setFontSize(10);
    doc.setFont('NotoSansSC', 'normal');
    doc.text(data.handleWay === '代理' ? '○ 自办  ● 委托代理' : '● 自办  ○ 委托代理', leftX, y);
    y += 8;

    if (data.agentName) row('代理人姓名：', data.agentName);

    if (y > 200) { doc.addPage(); y = 20; }
    y += 4;
    doc.setFontSize(12);
    doc.setFont('NotoSansSC', 'bold');
    doc.text('提交材料核对清单', leftX, y);
    y += 8;
    doc.setFontSize(10);
    doc.setFont('NotoSansSC', 'normal');
    const checks = [
      '☑ 软件著作权登记申请表（本表）',
      '☑ 软件源程序鉴别材料（前 30 页 + 后 30 页，每页 50 行，共 60 页）',
      '☑ 软件文档鉴别材料（用户操作说明书，不少于 60 页 / 不少于 6 张）',
      '☑ 著作权人身份证明（个人身份证 / 企业营业执照副本）',
      '☑ 委托办理的，应提交代理人授权书'
    ];
    checks.forEach(c => { doc.text(c, leftX, y); y += 6; });

    y += 6;
    doc.setFontSize(9);
    const declaration = '本人（本单位）郑重声明：所填写内容及所附材料真实、合法。如有不实之处，愿承担相应法律责任。';
    const decl = doc.splitTextToSize(declaration, 170);
    doc.text(decl, leftX, y);
    y += decl.length * 5 + 10;

    doc.setFontSize(10);
    doc.text('申请人签字 / 盖章：______________________', leftX, y);
    y += 8;
    doc.text('申请日期：________ 年 ______ 月 ______ 日', leftX, y);

    y = 275;
    doc.setFontSize(8);
    doc.setTextColor(120);
    doc.text('本申请表由"知产管家"生成草稿。请以版权保护中心系统提交信息为准。', 105, y, { align: 'center' });
    doc.text('中国版权保护中心：yjpx.ccopyright.com.cn', 105, y + 5, { align: 'center' });

    return doc;
  }

  // ====== 3. 源程序鉴别材料 ======
  async function generateSourceCodeDocument(project, applicant) {
    var font = await loadChineseFont();
    if (!font) throw new Error('中文字体加载失败: ' + _chineseFontError);
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    applyChineseFont(doc);

    const settings = project.data.sourceCodeSettings || { linesPerPage: 50 };
    const frontText = project.data.sourceCodeText || '';
    const backText = project.data.sourceCodeBackText || '';
    const meta = project.data.sourceMeta || {};
    const linesPerPage = settings.linesPerPage || 50;
    const headerText = (project.name || '软件') + ' V' + (project.data.version || '1.0');

    const frontLines = frontText.split(/\r?\n/);
    const backLines = backText ? backText.split(/\r?\n/) : [];
    const totalLines = meta.totalLines || frontLines.length + backLines.length;
    const adoptedLines = meta.adoptedLines || frontLines.length + backLines.length;

    // No cover page, no separator - directly output 60 code pages (1-60)
    var pageNum = 1;
    addCodePages(doc, frontLines, pageNum, linesPerPage, headerText, 1);
    pageNum += Math.ceil(frontLines.length / linesPerPage);

    if (backLines.length > 0 && totalLines > 3000) {
      var backStartLine = totalLines - backLines.length + 1;
      addCodePages(doc, backLines, pageNum, linesPerPage, headerText, backStartLine);
    }
    return doc;
  }

  function drawCodeCover(doc, project, applicant, settings, totalLines, adoptedLines, meta) {
    setChineseFont(doc, 'bold', 20);
    doc.text('软件源程序鉴别材料', 105, 40, { align: 'center' });
    setChineseFont(doc, 'normal', 11);
    doc.text('Software Source Code Dispositive Material', 105, 50, { align: 'center' });

    var y = 75, labelX = 40, valueX = 85;
    setChineseFont(doc, 'bold', 11); doc.text('软件全称：', labelX, y);
    setChineseFont(doc, 'normal', 11); doc.text(project.name, valueX, y); y += 8;
    setChineseFont(doc, 'bold', 11); doc.text('版本号：', labelX, y);
    setChineseFont(doc, 'normal', 11); doc.text('V' + (project.data.version || '1.0'), valueX, y); y += 8;
    setChineseFont(doc, 'bold', 11); doc.text('著作权人：', labelX, y);
    setChineseFont(doc, 'normal', 11); doc.text(applicant.name, valueX, y); y += 8;
    setChineseFont(doc, 'bold', 11); doc.text('代码总行数：', labelX, y);
    setChineseFont(doc, 'normal', 11); doc.text(totalLines + ' 行', valueX, y); y += 8;
    setChineseFont(doc, 'bold', 11); doc.text('本次采用行数：', labelX, y);
    setChineseFont(doc, 'normal', 11); doc.text(adoptedLines + ' 行', valueX, y); y += 8;
    setChineseFont(doc, 'bold', 11); doc.text('每页行数：', labelX, y);
    setChineseFont(doc, 'normal', 11); doc.text((settings.linesPerPage || 50) + ' 行', valueX, y); y += 8;
    setChineseFont(doc, 'bold', 11); doc.text('制取方式：', labelX, y);
    setChineseFont(doc, 'normal', 10);
    doc.text(totalLines <= 3000 ? '全量提交（' + totalLines + '行）' : '前1500行 + 后1500行（跳过' + (totalLines - 3000) + '行）', valueX, y); y += 10;
    if (meta.commitSha) {
      setChineseFont(doc, 'bold', 11); doc.text('版本标识：', labelX, y);
      setChineseFont(doc, 'normal', 10); doc.text('commit ' + meta.commitSha, valueX, y); y += 10;
    }
    if (meta.frontFiles && meta.frontFiles.length > 0) {
      setChineseFont(doc, 'bold', 10); doc.text('前段文件（' + meta.frontFiles.length + '个）：', labelX, y); y += 5;
      setChineseFont(doc, 'normal', 8);
      var fw = doc.splitTextToSize(meta.frontFiles.slice(0, 8).join(', ') + (meta.frontFiles.length > 8 ? ' ...' : ''), 130);
      doc.text(fw, valueX, y); y += fw.length * 4 + 4;
    }
    if (meta.backFiles && meta.backFiles.length > 0) {
      setChineseFont(doc, 'bold', 10); doc.text('后段文件（' + meta.backFiles.length + '个）：', labelX, y); y += 5;
      setChineseFont(doc, 'normal', 8);
      var bw = doc.splitTextToSize(meta.backFiles.slice(0, 8).join(', ') + (meta.backFiles.length > 8 ? ' ...' : ''), 130);
      doc.text(bw, valueX, y); y += bw.length * 4 + 4;
    }
    y = Math.max(y + 10, 230);
    setChineseFont(doc, 'normal', 9);
    var decl = doc.splitTextToSize('本程序是 ' + project.name + ' 的完整、真实、准确的源代码，与提交登记的软件版本完全一致。', 130);
    doc.text(decl, 40, y);
    y = 265;
    setChineseFont(doc, 'bold', 10);
    doc.text('著作权人签字 / 盖章：', 40, y); doc.text('________________________', 95, y); y += 10;
    doc.text('日期：', 40, y); doc.text('________ 年 ______ 月 ______ 日', 60, y);
  }

  function drawCodeSeparator(doc, skippedLineCount) {
    setChineseFont(doc, 'normal', 14); doc.setTextColor(150);
    doc.text('（此处跳过中间部分）', 105, 100, { align: 'center' });
    setChineseFont(doc, 'normal', 11);
    doc.text('共跳过 ' + skippedLineCount + ' 行源代码', 105, 115, { align: 'center' });
    doc.setTextColor(0);
  }

  // Code pages: unified header + page numbers 1-60 (cover/separator excluded)
  function addCodePages(doc, lines, startPageNum, linesPerPage, headerText, startLineNum) {
    var i = 0, pageNum = startPageNum, lineNum = startLineNum || 1;
    var isFirst = true;
    while (i < lines.length) {
      if (isFirst) {
        isFirst = false; // use existing first page, no addPage
      } else {
        doc.addPage();
      }
      // Header: software name + version (top left), page number (top right)
      setChineseFont(doc, 'normal', 8); doc.setTextColor(100);
      doc.text(headerText, 20, 10);
      doc.text(String(pageNum), 190, 10, { align: 'right' });
      doc.setTextColor(0);
      var pageLines = lines.slice(i, i + linesPerPage);
      var y = 20, pageLineNum = lineNum;
      for (var idx = 0; idx < pageLines.length; idx++) {
        if (y > 280) break;
        doc.setTextColor(150); setChineseFont(doc, 'normal', 8);
        doc.text(String(pageLineNum).padStart(5, ' '), 20, y);
        doc.setTextColor(0);
        var ln = pageLines[idx] || ' ';
        // Truncate long lines instead of wrapping to keep line numbering correct
        var maxChars = 120;
        if (ln.length > maxChars) ln = ln.substring(0, maxChars);
        var fs = 9; if (ln.length > 80) fs = 7; if (ln.length > 100) fs = 6;
        setChineseFont(doc, 'normal', fs);
        doc.text(ln, 30, y);
        y += 5; pageLineNum++;
      }
      setChineseFont(doc, 'normal', 8); doc.setTextColor(150);
      doc.text('- ' + pageNum + ' -', 105, 287, { align: 'center' });
      doc.setTextColor(0);
      i += linesPerPage; lineNum = pageLineNum; pageNum++;
    }
  }

  // ====== 4. 用户操作说明书 ======
  async function generateUserManual(project, applicant) {
    var font = await loadChineseFont();
    if (!font) throw new Error('中文字体加载失败: ' + _chineseFontError);
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    applyChineseFont(doc);
    var data = project.data || {};
    var swName = project.name || '软件';
    var ver = 'V' + (data.version || '1.0');
    var commitSha = data.commitSha || '';
    var page = 1;

    function newPage() { doc.addPage(); page++; }
    function header() {
      setChineseFont(doc, 'normal', 8); doc.setTextColor(120);
      doc.text(swName + ' ' + ver + ' - 用户操作说明书', 20, 10);
      doc.text(String(page), 190, 10, { align: 'right' });
      doc.setTextColor(0); doc.setDrawColor(200); doc.setLineWidth(0.2);
      doc.line(20, 12, 190, 12);
    }
    function h1(title) {
      if (page > 1) newPage();
      header();
      setChineseFont(doc, 'bold', 16);
      var y = 25; doc.text(title, 20, y); y += 8;
      setChineseFont(doc, 'normal', 10);
      return y;
    }
    function h2(title, y) {
      y += 4; setChineseFont(doc, 'bold', 12); doc.text(title, 20, y); y += 6;
      setChineseFont(doc, 'normal', 10); return y;
    }
    function p(text, y) {
      var l = doc.splitTextToSize(text, 170); doc.text(l, 20, y); y += l.length * 5 + 2; return y;
    }
    function steps(arr, y) {
      arr.forEach(function(s) {
        if (y > 275) { newPage(); header(); y = 20; }
        setChineseFont(doc, 'normal', 10);
        var l = doc.splitTextToSize(s, 165); doc.text(l, 25, y); y += l.length * 5 + 2;
      });
      return y;
    }
    function screenshot(label, y) {
      if (y > 230) { newPage(); header(); y = 20; }
      y += 4;
      doc.setDrawColor(150); doc.setLineWidth(0.3);
      doc.setFillColor(245, 247, 250); doc.roundedRect(25, y, 155, 50, 2, 2, 'FD');
      setChineseFont(doc, 'normal', 9); doc.setTextColor(120);
      doc.text('【截图位置】' + label, 102, y + 28, { align: 'center' });
      doc.setTextColor(0); y += 56;
      return y;
    }

    // ===== 封面 =====
    setChineseFont(doc, 'bold', 26); doc.text(swName, 105, 60, { align: 'center' });
    setChineseFont(doc, 'normal', 16); doc.text(ver, 105, 72, { align: 'center' });
    setChineseFont(doc, 'normal', 14); doc.text('用户操作说明书', 105, 90, { align: 'center' });
    setChineseFont(doc, 'normal', 10); doc.setTextColor(120);
    doc.text('User Manual', 105, 98, { align: 'center' });
    doc.setTextColor(0);
    var cy = 130;
    function coverRow(label, value) {
      setChineseFont(doc, 'bold', 11); doc.text(label, 50, cy);
      setChineseFont(doc, 'normal', 11); doc.text(String(value || '-'), 90, cy); cy += 8;
    }
    coverRow('软件全称：', swName);
    coverRow('版本号：', ver);
    coverRow('著作权人：', applicant.name);
    coverRow('开发语言：', 'Python、TypeScript');
    coverRow('运行平台：', '1688.com (Alibaba Wholesale)');
    if (commitSha) coverRow('版本标识：', 'commit ' + commitSha);
    cy += 10;
    setChineseFont(doc, 'normal', 9); doc.setTextColor(120);
    doc.text('本说明书配套计算机软件著作权登记申请使用。', 105, cy, { align: 'center' });
    doc.setTextColor(0);

    // ===== 目录 =====
    newPage(); header();
    setChineseFont(doc, 'bold', 16); doc.text('目录', 20, 25);
    setChineseFont(doc, 'normal', 10);
    var toc = [
      '第一章  软件概述',
      '第二章  运行环境',
      '第三章  安装部署',
      '第四章  登录系统',
      '第五章  数据看板',
      '第六章  店铺管理',
      '第七章  商品管理',
      '第八章  订单管理',
      '第九章  库存管理',
      '第十章  AI智能诊断',
      '第十一章  图片处理',
      '第十二章  草稿发布',
      '第十三章  竞品分析',
      '第十四章  系统日志',
      '第十五章  数据备份',
      '第十六章  系统设置'
    ];
    var ty = 35;
    toc.forEach(function(t) { doc.text(t, 25, ty); ty += 7; });

    // ===== 第一章 软件概述 =====
    var y = h1('第一章  软件概述');
    y = p(swName + '是一款面向1688平台的智能商品运营系统，基于Python后端（FastAPI）和TypeScript前端（Vue 3）构建。系统通过AI能力辅助商家完成商品发布、图片处理、竞品分析、库存管理等核心运营环节，提升运营效率。', y + 5);
    y = h2('1.1 核心能力', y);
    y = steps([
      '商品管理：批量导入、编辑、发布1688商品，支持类目匹配和属性自动填充',
      'AI智能诊断：基于商品数据分析，自动识别标题、主图、详情页优化空间',
      '图片处理：AI抠图、主图生成、白底图制作、图片质量检测',
      '订单与库存：同步1688订单数据，实时管理多店铺库存',
      '竞品分析：采集竞品商品信息，对比价格、销量、评分维度',
      '草稿发布：商品草稿集中管理，一键发布到1688平台'
    ], y);
    y = h2('1.2 技术架构', y);
    y = p('后端采用Python 3.11 + FastAPI框架，提供RESTful API。前端采用Vue 3 + TypeScript + Ant Design Vue。数据库使用PostgreSQL，图片处理集成Pillow和AI视觉模型。系统通过1688开放API与平台交互。', y);

    // ===== 第二章 运行环境 =====
    y = h1('第二章  运行环境');
    y = h2('2.1 服务器端要求', y);
    y = steps([
      '操作系统：Ubuntu 22.04 LTS 或 CentOS 8+',
      'Python：3.11 或以上',
      'Node.js：18 LTS 或以上（前端构建）',
      'PostgreSQL：15 或以上',
      'Redis：7.0 或以上（缓存和任务队列）',
      'Docker：24.0+（推荐容器化部署）'
    ], y);
    y = h2('2.2 客户端要求', y);
    y = steps([
      '浏览器：Chrome 90+ / Edge 90+ / Firefox 88+',
      '分辨率：1366x768 或以上',
      '网络：可访问1688开放平台API'
    ], y);
    y = h2('2.3 第三方依赖', y);
    y = p('系统依赖1688开放平台API（商品、订单、库存、图片上传接口）、AI视觉模型API（图片生成和优化）、以及PostgreSQL数据库。', y);

    // ===== 第三章 安装部署 =====
    y = h1('第三章  安装部署');
    y = h2('3.1 Docker部署（推荐）', y);
    y = steps([
      '步骤1：拉取镜像  docker pull registry.cn-hangzhou.aliyuncs.com/ops1688/backend:latest',
      '步骤2：配置环境变量  复制 .env.example 为 .env，填写1688 AppKey/AppSecret、数据库连接、AI模型密钥',
      '步骤3：启动服务  docker-compose up -d，系统将启动后端(API)、前端(Nginx)、数据库(PostgreSQL)、缓存(Redis)四个容器',
      '步骤4：初始化数据库  docker exec -it backend python -m alembic upgrade head',
      '步骤5：创建管理员  docker exec -it backend python -m ops.cli create-admin --username admin --password <密码>',
      '步骤6：验证  浏览器访问 http://<服务器IP>:18001，显示登录页即部署成功'
    ], y);
    y = screenshot('部署完成后浏览器访问的登录页面', y);
    y = h2('3.2 手动部署', y);
    y = p('如不使用Docker，需手动安装Python依赖（pip install -r requirements.txt）、构建前端（npm run build）、配置Nginx反向代理。详细步骤参考项目README中的手动部署章节。', y);

    // ===== 第四章 登录系统 =====
    y = h1('第四章  登录系统');
    y = h2('4.1 登录流程', y);
    y = steps([
      '步骤1：在浏览器地址栏输入系统URL，进入登录页面',
      '步骤2：输入管理员分配的用户名和密码',
      '步骤3：点击「登录」按钮，系统验证身份后跳转至数据看板',
      '步骤4：如忘记密码，点击「忘记密码」链接，通过注册邮箱重置'
    ], y);
    y = screenshot('登录页面，输入用户名密码', y);
    y = h2('4.2 多店铺授权', y);
    y = p('首次登录后需绑定1688店铺。进入「店铺管理」页面，点击「绑定新店铺」，系统将跳转至1688 OAuth授权页面。授权成功后，系统自动同步该店铺的商品、订单和库存数据。', y);

    // ===== 第五章 数据看板 =====
    y = h1('第五章  数据看板');
    y = p('登录后默认进入数据看板页面，展示已绑定店铺的核心运营指标。', y + 3);
    y = h2('5.1 看板指标', y);
    y = steps([
      '今日订单数：展示当天所有绑定店铺的订单总数',
      '商品总数：当前在售商品数量',
      '库存预警：低于安全库存阈值的商品数',
      '待处理任务：草稿池中待发布商品数量',
      '店铺健康分：基于商品质量、订单转化、响应速度的综合评分'
    ], y);
    y = screenshot('数据看板主界面，展示店铺核心指标', y);
    y = h2('5.2 运营分析', y);
    y = p('点击「运营分析」进入详细分析页面，可按日期范围查看GMV趋势、商品转化率排行、类目销售分布等图表。支持导出Excel报表。', y);

    // ===== 第六章 店铺管理 =====
    y = h1('第六章  店铺管理');
    y = p('店铺管理模块用于管理已绑定的1688店铺，支持多店铺切换和数据同步。', y + 3);
    y = h2('6.1 绑定新店铺', y);
    y = steps([
      '步骤1：点击左侧导航「店铺管理」进入店铺列表',
      '步骤2：点击右上角「绑定新店铺」按钮',
      '步骤3：在弹出窗口中点击「前往1688授权」，跳转至1688 OAuth页面',
      '步骤4：使用1688账号登录并授权',
      '步骤5：授权完成后系统自动返回，店铺列表中显示新绑定的店铺'
    ], y);
    y = screenshot('店铺管理列表，显示已绑定店铺和授权状态', y);
    y = h2('6.2 店铺配置', y);
    y = p('每个店铺可独立配置：默认运费模板、发货地址、客服自动回复模板、库存同步频率（默认每30分钟）、商品类目映射规则。', y);

    // ===== 第七章 商品管理 =====
    y = h1('第七章  商品管理');
    y = p('商品管理是系统的核心模块，支持批量导入、编辑、类目匹配和发布。', y + 3);
    y = h2('7.1 商品导入', y);
    y = steps([
      '步骤1：点击「商品管理」>「导入商品」',
      '步骤2：下载Excel模板，按模板填写商品信息（标题、价格、库存、类目等）',
      '步骤3：上传填写好的Excel文件',
      '步骤4：系统自动解析并匹配1688类目，显示类目匹配结果',
      '步骤5：确认类目后，商品进入草稿池等待编辑和发布'
    ], y);
    y = screenshot('商品导入页面，Excel上传和类目匹配结果', y);
    y = h2('7.2 商品编辑', y);
    y = p('在商品列表中点击任意商品可进入编辑页面。编辑页面支持：标题修改（带AI优化建议）、主图替换、详情页编辑、属性调整、价格和库存修改、类目属性补充。', y);
    y = screenshot('商品编辑页面，左侧商品信息，右侧预览', y);

    // ===== 第八章 订单管理 =====
    y = h1('第八章  订单管理');
    y = p('订单管理模块同步1688平台订单数据，支持多店铺统一查看和处理。', y + 3);
    y = h2('8.1 订单列表', y);
    y = steps([
      '步骤1：点击「订单管理」进入订单列表',
      '步骤2：可通过店铺、状态（待付款/待发货/已发货/已完成）、日期范围筛选',
      '步骤3：点击订单号可查看订单详情，包括买家信息、商品明细、物流信息'
    ], y);
    y = screenshot('订单管理列表，支持多店铺筛选和状态过滤', y);
    y = h2('8.2 批量发货', y);
    y = p('选中多个待发货订单，点击「批量发货」，填写物流公司和运单号（支持顺丰、圆通、中通等），系统将物流信息同步至1688平台。', y);

    // ===== 第九章 库存管理 =====
    y = h1('第九章  库存管理');
    y = p('库存管理模块实时同步商品库存，支持安全库存预警和批量调整。', y + 3);
    y = h2('9.1 库存列表', y);
    y = steps([
      '步骤1：点击「库存管理」进入库存列表',
      '步骤2：可按店铺、SKU、库存状态（正常/不足/缺货）筛选',
      '步骤3：每条记录显示商品名称、SKU、当前库存、安全库存阈值、库存状态'
    ], y);
    y = screenshot('库存管理列表，显示各商品库存和预警状态', y);
    y = h2('9.2 安全库存设置', y);
    y = p('点击商品行的「设置」按钮，可为每个SKU设置安全库存阈值。当库存低于阈值时，系统在看板和列表中标红预警。', y);
    y = h2('9.3 批量库存调整', y);
    y = p('选中多个商品，点击「批量调整」，输入增减数量或设置绝对值，系统更新本地库存并同步至1688平台。', y);

    // ===== 第十章 AI智能诊断 =====
    y = h1('第十章  AI智能诊断');
    y = p('AI诊断模块利用大语言模型和视觉模型，对商品信息进行自动分析和优化建议。', y + 3);
    y = h2('10.1 商品诊断', y);
    y = steps([
      '步骤1：在商品列表中选择需要诊断的商品，点击「AI诊断」',
      '步骤2：系统调用AI模型分析商品标题、主图、详情页、价格',
      '步骤3：诊断结果展示各项评分（0-100分）和具体优化建议',
      '步骤4：可一键应用AI建议（如优化后的标题、生成的主图）'
    ], y);
    y = screenshot('AI诊断结果页面，显示商品各维度评分和优化建议', y);
    y = h2('10.2 标题优化', y);
    y = p('AI根据商品类目、热词和竞品数据，生成多个优化标题方案。每个方案展示预计搜索曝光提升百分比。用户选择后可一键替换原标题。', y);
    y = h2('10.3 价格分析', y);
    y = p('系统采集同类目竞品价格分布，结合商品成本和利润率，给出定价建议区间。', y);

    // ===== 第十一章 图片处理 =====
    y = h1('第十一章  图片处理');
    y = p('图片处理模块提供AI驱动的图片编辑能力，包括抠图、主图生成、白底图制作和质量检测。', y + 3);
    y = h2('11.1 AI抠图', y);
    y = steps([
      '步骤1：进入「图片处理」模块，上传需要抠图的商品图片',
      '步骤2：选择抠图模式（自动/手动标记前景）',
      '步骤3：点击「开始处理」，系统调用AI模型自动去除背景',
      '步骤4：处理完成后可下载透明背景PNG或替换为指定背景色'
    ], y);
    y = screenshot('图片处理界面，左侧原图，右侧抠图结果', y);
    y = h2('11.2 主图生成', y);
    y = p('上传商品图后，系统自动生成符合1688主图规范的图片（800x800px，白底，居中）。支持批量处理，一次生成多个商品的主图。', y);
    y = h2('11.3 图片质量检测', y);
    p('系统自动检测图片分辨率、文件大小、白底合规性、水印情况，不符合规范的图片会标红提示。', 20);

    // ===== 第十二章 草稿发布 =====
    y = h1('第十二章  草稿发布');
    y = p('草稿发布模块集中管理待发布商品，支持审核流程和批量发布。', y + 3);
    y = h2('12.1 草稿池', y);
    y = steps([
      '步骤1：点击「草稿发布」进入草稿池',
      '步骤2：草稿池显示所有待发布商品，可按店铺、类目、状态筛选',
      '步骤3：点击商品进入预览，检查商品信息是否完整'
    ], y);
    y = screenshot('草稿发布池，显示待发布商品列表', y);
    y = h2('12.2 发布到1688', y);
    y = p('选中一个或多个草稿商品，点击「发布」。系统将通过1688 API提交商品信息，发布结果（成功/失败/需修改）实时显示。失败的商品会附带1688返回的错误原因。', y);

    // ===== 第十三章 竞品分析 =====
    y = h1('第十三章  竞品分析');
    y = p('竞品分析模块采集1688平台竞品商品数据，辅助定价和运营决策。', y + 3);
    y = h2('13.1 竞品采集', y);
    y = steps([
      '步骤1：进入「竞品分析」>「采集竞品」',
      '步骤2：输入竞品1688商品链接或关键词',
      '步骤3：系统自动采集商品标题、价格、销量、评价数、主图',
      '步骤4：采集结果存入竞品库，可随时查看和对比'
    ], y);
    y = screenshot('竞品采集结果，显示竞品商品信息和价格趋势', y);
    y = h2('13.2 价格对比', y);
    y = p('选择自己的商品和对应竞品，系统生成价格对比表格，展示差价、销量对比、评分对比。', y);

    // ===== 第十四章 系统日志 =====
    y = h1('第十四章  系统日志');
    y = p('系统日志模块记录所有关键操作，便于审计和问题排查。', y + 3);
    y = h2('14.1 操作日志', y);
    y = steps([
      '步骤1：点击「系统日志」进入操作日志页面',
      '步骤2：可按操作类型（登录/商品/订单/库存/发布）、操作人、时间范围筛选',
      '步骤3：每条记录显示操作时间、操作人、操作类型、目标对象、操作结果'
    ], y);
    y = screenshot('系统日志页面，显示操作记录列表', y);
    y = h2('14.2 登录日志', y);
    y = p('单独的登录日志页面，记录所有登录尝试（成功/失败），包括IP地址、浏览器、地理位置。异常登录会标红预警。', y);

    // ===== 第十五章 数据备份 =====
    y = h1('第十五章  数据备份');
    y = p('数据备份模块支持手动和定时备份，确保商品和订单数据安全。', y + 3);
    y = h2('15.1 手动备份', y);
    y = steps([
      '步骤1：点击「数据备份」进入备份管理页面',
      '步骤2：点击「创建备份」，选择备份范围（全部/按店铺）',
      '步骤3：系统生成备份文件（PostgreSQL dump格式），下载到本地'
    ], y);
    y = screenshot('数据备份页面，显示备份列表和创建按钮', y);
    y = h2('15.2 恢复备份', y);
    y = p('在备份列表中选择历史备份，点击「恢复」，系统将数据还原至备份时间点。恢复前会自动创建当前状态的快照。', y);
    y = h2('15.3 定时备份', y);
    p('在系统设置中可配置定时备份计划，支持每日/每周自动备份，备份文件保留最近30天。', 20);

    // ===== 第十六章 系统设置 =====
    y = h1('第十六章  系统设置');
    y = p('系统设置模块管理全局配置和用户权限。', y + 3);
    y = h2('16.1 用户管理', y);
    y = steps([
      '步骤1：点击「系统设置」>「用户管理」',
      '步骤2：可新增用户、编辑角色（管理员/运营/只读）、重置密码',
      '步骤3：每个角色对应不同的功能权限，管理员可配置全部模块'
    ], y);
    y = screenshot('用户管理页面，显示用户列表和角色配置', y);
    y = h2('16.2 Provider配置', y);
    y = p('配置1688开放平台API凭证（AppKey/AppSecret）和AI模型API密钥。系统支持多套Provider配置，可按店铺指定不同的API凭证。', y);
    y = h2('16.3 系统参数', y);
    y = p('配置库存同步频率、日志保留天数、备份保留数量、AI模型选择等全局参数。修改后即时生效。', y);

    return doc;
  }

  return {
    generateTrademarkApplication,
    generateSoftwareApplication,
    generateSourceCodeDocument,
    generateUserManual,
    setMarkImage,
    savePdf(doc, filename) { doc.save(filename); },
    outputPdf(doc, filename) {
      const blob = doc.output('blob');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      URL.revokeObjectURL(url);
    }
  };
})();
