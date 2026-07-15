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
    var urls = ['/fonts/NotoSansSC-true.ttf', '/fonts/NotoSansSC.ttf'];
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

    const img = checkMarkImageDataUrl();
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

    // Cover page (not counted in 1-60 page numbering)
    drawCodeCover(doc, project, applicant, settings, totalLines, adoptedLines, meta);

    // Front code pages: page numbers 1-N
    var pageNum = 1;
    addCodePages(doc, frontLines, pageNum, linesPerPage, headerText, 1);
    pageNum += Math.ceil(frontLines.length / linesPerPage);

    // Separator page (not counted) + back code pages
    if (backLines.length > 0 && totalLines > 3000) {
      doc.addPage();
      drawCodeSeparator(doc, totalLines - adoptedLines);
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
    while (i < lines.length) {
      doc.addPage();
      // Header: software name + version (top left), page number (top right)
      setChineseFont(doc, 'normal', 8); doc.setTextColor(100);
      doc.text(headerText, 20, 10);
      doc.text(String(pageNum), 190, 10, { align: 'right' });
      doc.setTextColor(0);
      var pageLines = lines.slice(i, i + linesPerPage);
      var y = 20, pageLineNum = lineNum;
      for (var idx = 0; idx < pageLines.length; idx++) {
        doc.setTextColor(150); setChineseFont(doc, 'normal', 8);
        doc.text(String(pageLineNum).padStart(5, ' '), 20, y);
        doc.setTextColor(0);
        var ln = pageLines[idx] || ' ';
        var fs = 9; if (ln.length > 90) fs = 7; if (ln.length > 120) fs = 6;
        setChineseFont(doc, 'normal', fs);
        if (ln.length > 90) {
          var wr = ln.replace(/(.{70,}?[,;\s])/g, '$1\n').split('\n');
          for (var wi = 0; wi < wr.length; wi++) { if (y > 280) break; doc.text(wr[wi] || ' ', 30, y); y += fs * 0.5 + 1; }
        } else { doc.text(ln, 30, y); }
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

    // Cover
    setChineseFont(doc, 'bold', 22);
    doc.text(project.name || '软件', 105, 50, { align: 'center' });
    setChineseFont(doc, 'normal', 14);
    doc.text('用户操作说明书', 105, 65, { align: 'center' });
    setChineseFont(doc, 'normal', 11);
    doc.text('User Manual', 105, 73, { align: 'center' });

    var y = 100, labelX = 40, valueX = 85;
    setChineseFont(doc, 'normal', 11);
    function mRow(label, value) {
      setChineseFont(doc, 'bold', 11); doc.text(label, labelX, y);
      setChineseFont(doc, 'normal', 11);
      var l = doc.splitTextToSize(String(value || '-'), 110);
      doc.text(l, valueX, y); y += Math.max(8, l.length * 5 + 3);
    }
    mRow('软件全称：', project.name);
    mRow('版本号：', 'V' + (data.version || '1.0'));
    mRow('著作权人：', applicant.name);
    mRow('开发语言：', data.lang || '-');
    if (data.commitSha) mRow('版本标识：', 'commit ' + data.commitSha);

    function section(title) {
      if (y > 230) { doc.addPage(); y = 30; }
      y += 6;
      setChineseFont(doc, 'bold', 14); doc.text(title, 20, y); y += 8;
      setChineseFont(doc, 'normal', 10);
    }
    function text(t) { var l = doc.splitTextToSize(t, 170); doc.text(l, 20, y); y += l.length * 5 + 4; }
    function bullet(arr) { arr.forEach(function(s) { doc.text(s, 20, y); y += 6; }); }

    section('一、软件概述');
    text(data.features || data.description || project.name + '是一款基于' + (data.lang || '现代编程语言') + '开发的软件系统。');

    section('二、运行环境');
    bullet(['操作系统：Windows 10/11、macOS 12+、Ubuntu 20.04+', '开发语言：' + (data.lang || 'Python / JavaScript'), '依赖管理：npm / pip（按项目配置）', '浏览器：Chrome 90+（如含Web界面）']);

    section('三、安装部署');
    bullet(['1. 获取软件源代码包或安装包', '2. 安装运行环境依赖（见第二节）', '3. 执行初始化配置', '4. 启动主程序', '5. 验证服务正常运行']);

    section('四、主要功能');
    text(data.features || '本软件提供核心业务流程管理、数据处理和用户交互功能。');

    section('五、操作说明');
    bullet(['1. 登录系统：使用管理员分配的账号密码登录', '2. 进入主界面：系统将展示功能导航', '3. 选择功能模块：点击对应菜单进入操作', '4. 数据管理：可进行增删改查等操作', '5. 导出报表：支持数据导出和报表生成', '6. 系统设置：配置系统参数和用户权限']);

    section('六、注意事项');
    bullet(['1. 请定期备份系统数据', '2. 不要在非授权环境下运行本软件', '3. 如遇技术问题，请联系著作权人获取支持']);

    y = 275;
    setChineseFont(doc, 'normal', 8); doc.setTextColor(120);
    doc.text('本说明书由"知产管家"生成。著作权人：' + (applicant.name || ''), 105, y, { align: 'center' });
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
