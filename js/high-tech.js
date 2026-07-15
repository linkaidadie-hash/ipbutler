// high-tech.js - 高新技术企业认定模块
// 高新认定评分规则参考《高新技术企业认定管理办法》《工作指引》(2024版)
// 通过线：总分 ≥71 分 且 满足所有硬性指标
(function () {
  'use strict';

  // ============ 评分规则 ============
  const SCORING = {
    PASS_SCORE: 71,
    MAX_SCORE: 100,

    // 硬性指标(不计入100分但必须满足)
    HARD: {
      techStaffRatio: { min: 0.10, label: '科技人员占比 ≥10%' },
      rdExpenseRatio: {
        // 按销售收入分档:5000万-2亿 = 4%, <5000万 = 5%, >2亿 = 3%
        low: { revenue: 50000000, ratio: 0.05 },
        mid: { revenue: 200000000, ratio: 0.04 },
        high: { ratio: 0.03 }
      },
      // 《工作指引》研发费用结构:其他费用 ≤ 研发费用总额 × 20%
      otherExpenseRatio: { max: 0.20, label: '"其他费用"占研发费用总额 ≤20%' },
      // 《管理办法》第十一条:境内研发费用 ≥ 60%
      domesticRdRatio: { min: 0.60, label: '境内研发费用占全部研发费用 ≥60%' },
      // 《工作指引》:三表差异率 ≤ 15% (财务账 vs 税务账 vs 专项审计)
      tripleMatchTolerance: { max: 0.15, label: '三表一致差异率 ≤15%' },
      hightechIncomeRatio: { min: 0.60, label: '高新技术产品(服务)收入占比 ≥60%' },
      noMajorAccident: { required: true, label: '无重大安全/质量/环保事故' },
      techFieldMatch: { required: true, label: '技术领域属《国家重点支持的高新技术领域》' }
    }
  };

  // ============ 题目定义(20题) ============
  const QUESTIONS = [
    // —— 知识产权(≤30分) ——
    {
      id: 'ip_class1',
      module: '知识产权',
      maxScore: 24,
      title: '拥有的 I 类知识产权数量(发明专利/国防专利/植物新品种/集成电路布图设计/新药证书)',
      type: 'number',
      unit: '项',
      score: function (v) {
        var n = Math.max(0, parseInt(v, 10) || 0);
        // 《工作指引》:知识产权总分 ≤30,I 类每项 8 分(II 类 6 分仅 1 项)
        return Math.min(24, n * 8);
      },
      hint: '每项 8 分,I 类封顶 24 分(知识产权总分 30 分上限 = I 类 24 + II 类 6)'
    },
    {
      id: 'ip_class2',
      module: '知识产权',
      maxScore: 6,
      title: '拥有的 II 类知识产权数量(实用新型/外观设计/软件著作权)',
      type: 'number',
      unit: '项',
      score: function (v) {
        var n = Math.max(0, parseInt(v, 10) || 0);
        // 《工作指引》:II 类每项 6 分,仅 1 项计入评分(总分上限 6)
        return Math.min(6, n * 6);
      },
      hint: '每项 6 分,II 类仅 1 项计入,封顶 6 分(《工作指引》)'
    },

    // —— 科技成果转化(≤30分) ——
    {
      id: 'transform_avg',
      module: '科技成果转化',
      maxScore: 30,
      title: '近 3 年平均每年的科技成果转化项数',
      type: 'select',
      options: [
        { value: '0', label: '0 项', score: 0 },
        { value: '1', label: '1 项', score: 6 },
        { value: '2', label: '2 项', score: 12 },
        { value: '3', label: '3 项', score: 18 },
        { value: '4', label: '4 项', score: 24 },
        { value: '5', label: '5 项', score: 28 },
        { value: '6+', label: '6 项及以上', score: 30 }
      ],
      hint: '5 项以上可拿满分,转化要附合同/发票'
    },

    // —— 研发组织管理(≤20分) ——
    {
      id: 'mgmt_rule',
      module: '研发组织管理',
      maxScore: 20,
      title: '以下研发组织管理制度是否齐全?(多选)',
      type: 'multicheck',
      subItems: [
        { id: 'rule', label: '研发组织管理制度(研发部组织架构、职责)', score: 3 },
        { id: 'accounting', label: '研发投入核算体系/辅助账制度', score: 4 },
        { id: 'collab', label: '产学研合作(与高校/科研院所签协议)', score: 3 },
        { id: 'kpi', label: '研发人员绩效考核制度', score: 3 },
        { id: 'ipm', label: '知识产权管理制度', score: 3 },
        { id: 'facility', label: '研发设备/场地/仪器配置', score: 2 },
        { id: 'culture', label: '研发活动文化建设(培训/交流/激励)', score: 2 }
      ],
      score: function (v) {
        if (!v) return 0;
        var sub = QUESTIONS.find(function (q) { return q.id === 'mgmt_rule'; }).subItems;
        return sub.reduce(function (s, item) {
          return s + (v[item.id] ? item.score : 0);
        }, 0);
      },
      hint: '共 7 项,满分 20 分,缺哪项减哪项'
    },

    // —— 企业成长性(≤20分) ——
    {
      id: 'growth_rev',
      module: '企业成长性',
      maxScore: 10,
      title: '销售收入年化增长率(近 1 年)',
      type: 'select',
      options: [
        { value: '-1', label: '下滑 (< 0%)', score: 0 },
        { value: '0.03', label: '0% - 5%', score: 2 },
        { value: '0.10', label: '5% - 15%', score: 4 },
        { value: '0.20', label: '15% - 25%', score: 6 },
        { value: '0.30', label: '25% - 35%', score: 8 },
        { value: '0.40', label: '≥ 35%', score: 10 }
      ],
      hint: '销售收入增长率,满分 10 分'
    },
    {
      id: 'growth_equity',
      module: '企业成长性',
      maxScore: 10,
      title: '净资产年化增长率(近 1 年)',
      type: 'select',
      options: [
        { value: '-1', label: '下滑 (< 0%)', score: 0 },
        { value: '0.03', label: '0% - 5%', score: 2 },
        { value: '0.10', label: '5% - 15%', score: 4 },
        { value: '0.20', label: '15% - 25%', score: 6 },
        { value: '0.30', label: '25% - 35%', score: 8 },
        { value: '0.40', label: '≥ 35%', score: 10 }
      ],
      hint: '净资产增长率,满分 10 分'
    },

    // —— 硬性指标(不计入100分,必须满足) ——
    { id: 'hard_tech_ratio', module: '硬性指标', title: '科技人员占企业当年职工总数比例(%)', type: 'number', unit: '%', hint: '≥10% 合格(管理办法第十一条)' },
    { id: 'hard_revenue', module: '硬性指标', title: '最近 1 年销售收入(元)', type: 'number', unit: '元', hint: '用于计算研发费用占比分档' },
    { id: 'hard_rd_expense', module: '硬性指标', title: '最近 1 年研发费用总额(元)', type: 'number', unit: '元', hint: '用于计算研发费用占比' },
    { id: 'hard_rd_other', module: '硬性指标', title: '其中"其他费用"金额(元)', type: 'number', unit: '元', hint: '《工作指引》:其他费用 ≤ 研发费用总额 × 20%(差旅/会议/培训/知识产权申请费等)' },
    { id: 'hard_rd_domestic', module: '硬性指标', title: '其中境内发生的研发费用(元)', type: 'number', unit: '元', hint: '《管理办法》第十一条:境内研发费用 ≥ 全部研发费用 × 60%' },
    { id: 'hard_ht_income', module: '硬性指标', title: '高新技术产品(服务)收入(元)', type: 'number', unit: '元', hint: '用于计算高新收入占比' },
    { id: 'hard_total_income', module: '硬性指标', title: '企业当年总收入(元)', type: 'number', unit: '元', hint: '分母,用于高新收入占比' },
    { id: 'hard_audit_tax', module: '硬性指标', title: '税务申报的研发费用加计扣除金额(元)', type: 'number', unit: '元', hint: '用于"三表一致"校验:财务辅助账 vs 税务加计扣除 vs 专项审计,差异率 ≤15%' },
    { id: 'hard_audit_special', module: '硬性指标', title: '专项审计报告中的研发费用金额(元)', type: 'number', unit: '元', hint: '审计师事务所出具的研发费用专项审计报告金额' },
    {
      id: 'hard_field',
      module: '硬性指标',
      title: '技术领域是否属《国家重点支持的高新技术领域》',
      type: 'select',
      options: [
        { value: 'yes', label: '属于(电子信息/生物医药/航空航天/新材料/先进制造/新能源/节能环保/资源与环境/高技术服务)' },
        { value: 'no', label: '不属于' }
      ],
      hint: '8 大领域之一'
    },
    {
      id: 'hard_accident',
      module: '硬性指标',
      title: '近 1 年是否有重大安全/质量/环保事故',
      type: 'select',
      options: [
        { value: 'no', label: '无' },
        { value: 'yes', label: '有' }
      ],
      hint: '一旦有重大事故,一票否决'
    },
    {
      id: 'hard_ip_support',
      module: '硬性指标',
      title: '知识产权是否对主要产品(服务)在技术上发挥核心支持作用',
      type: 'select',
      options: [
        { value: 'yes', label: '是(核心技术由自有 IP 保护)' },
        { value: 'partial', label: '部分(部分 IP,部分其他)' },
        { value: 'no', label: '否(IP 与主营业务无关)' }
      ]
    },
    {
      id: 'hard_ip_origin',
      module: '硬性指标',
      title: '知识产权获取方式',
      type: 'select',
      options: [
        { value: 'all_self', label: '全部自主研发' },
        { value: 'mostly_self', label: '大部分自主,少量受让' },
        { value: 'mix', label: '自主 + 受让/许可混合' },
        { value: 'mostly_transfer', label: '大部分受让/许可,少量自主' }
      ],
      hint: '受让/许可需在 3 年内'
    },
    {
      id: 'hard_industry',
      module: '硬性指标',
      title: '企业注册成立年限',
      type: 'select',
      options: [
        { value: 'lt1', label: '< 1 年(刚注册,无法申报)' },
        { value: '1to3', label: '1-3 年' },
        { value: '3to15', label: '3-15 年(最佳)' },
        { value: 'gt15', label: '> 15 年(需要更多证明持续研发)' }
      ]
    },
    {
      id: 'hard_field_count',
      module: '硬性指标',
      title: '核心技术是否属于 1 个技术领域(高新按领域分)',
      type: 'select',
      options: [
        { value: 'one', label: '聚焦 1 个领域(推荐)' },
        { value: 'two', label: '跨 2 个领域' },
        { value: 'multi', label: '跨 3 个及以上领域(复杂)' }
      ]
    },
    {
      id: 'hard_audit',
      module: '硬性指标',
      title: '是否有年度研发费用专项审计报告',
      type: 'select',
      options: [
        { value: 'yes', label: '有(每年由审计师事务所出具)' },
        { value: 'partial', label: '部分年度有' },
        { value: 'no', label: '没有' }
      ],
      hint: '专项审计报告必备材料'
    }
  ];

  // ============ 计算总分 ============
  function calcScore(answers) {
    var total = 0;
    var breakdown = {};
    QUESTIONS.forEach(function (q) {
      var s = 0;
      if (q.score) {
        // 函数式评分(number / multicheck)
        s = q.score(answers[q.id]);
      } else if (q.type === 'select' && q.options) {
        // select 题型:从 options 里取对应 score
        var opt = q.options.find(function (o) { return String(o.value) === String(answers[q.id]); });
        s = opt && typeof opt.score === 'number' ? opt.score : 0;
      }
      if (q.maxScore) {
        breakdown[q.id] = { score: s, max: q.maxScore };
        total += s;
      }
    });
    return { total: total, breakdown: breakdown };
  }

  // ============ 检查硬性指标 ============
  function checkHard(answers) {
    var issues = [];
    var ok = true;

    // 科技人员占比
    var ratio = parseFloat(answers.hard_tech_ratio) || 0;
    if (ratio < 10) {
      issues.push('科技人员占比 ' + ratio + '% < 10%,需要补充研发人员');
      ok = false;
    }

    // 研发费用占比
    var rev = parseFloat(answers.hard_revenue) || 0;
    var rd = parseFloat(answers.hard_rd_expense) || 0;
    if (rev > 0 && rd > 0) {
      var rdRatio = rd / rev;
      var need;
      if (rev < 50000000) need = 0.05;
      else if (rev < 200000000) need = 0.04;
      else need = 0.03;
      if (rdRatio < need) {
        issues.push('研发费用占比 ' + (rdRatio * 100).toFixed(2) + '% < ' + (need * 100).toFixed(1) + '%(按规模分档)');
        ok = false;
      }
    }

    // 高新收入占比
    var htInc = parseFloat(answers.hard_ht_income) || 0;
    var totInc = parseFloat(answers.hard_total_income) || 0;
    if (totInc > 0 && htInc > 0) {
      var htRatio = htInc / totInc;
      if (htRatio < 0.60) {
        issues.push('高新收入占比 ' + (htRatio * 100).toFixed(1) + '% < 60%');
        ok = false;
      }
    }

    // 重大事故
    if (answers.hard_accident === 'yes') {
      issues.push('近 1 年有重大安全/质量/环保事故 → 一票否决');
      ok = false;
    }

    // 领域
    if (answers.hard_field === 'no') {
      issues.push('技术领域不属于《国家重点支持的高新技术领域》');
      ok = false;
    }

    // 成立年限
    if (answers.hard_industry === 'lt1') {
      issues.push('企业成立 < 1 年,不符合申报条件');
      ok = false;
    }

    // 研发费用结构:其他费用 ≤ 20%
    var rdOther = parseFloat(answers.hard_rd_other) || 0;
    if (rd > 0 && rdOther > 0) {
      var otherRatio = rdOther / rd;
      if (otherRatio > 0.20) {
        issues.push('"其他费用"占研发费用比例 ' + (otherRatio * 100).toFixed(2) + '% > 20%(《工作指引》研发费用结构明细表)');
        ok = false;
      }
    }

    // 境内研发费用 ≥ 60%
    var rdDomestic = parseFloat(answers.hard_rd_domestic) || 0;
    if (rd > 0 && rdDomestic > 0) {
      var domesticRatio = rdDomestic / rd;
      if (domesticRatio < 0.60) {
        issues.push('境内研发费用占比 ' + (domesticRatio * 100).toFixed(2) + '% < 60%(管理办法第十一条)');
        ok = false;
      }
    }

    // 三表一致:差异率 ≤ 15%
    var tax = parseFloat(answers.hard_audit_tax) || 0;
    var special = parseFloat(answers.hard_audit_special) || 0;
    if (rd > 0 && tax > 0 && special > 0) {
      var values = [rd, tax, special];
      var maxV = Math.max.apply(null, values);
      var minV = Math.min.apply(null, values);
      var diffRate = maxV > 0 ? (maxV - minV) / maxV : 0;
      if (diffRate > 0.15) {
        issues.push('三表差异率 ' + (diffRate * 100).toFixed(1) + '% > 15%(财务辅助账 vs 税务加计扣除 vs 专项审计)');
        ok = false;
      }
    }

    return { ok: ok, issues: issues };
  }

  // ============ 生成报告 ============
  function generateReport(answers) {
    var s = calcScore(answers);
    var hard = checkHard(answers);
    var pass = s.total >= SCORING.PASS_SCORE && hard.ok;

    var recommendations = [];
    if (s.total < SCORING.PASS_SCORE) {
      var gap = SCORING.PASS_SCORE - s.total;
      // 按模块给出建议
      var modScore = {};
      QUESTIONS.forEach(function (q) {
        if (q.module !== '硬性指标' && q.module !== '企业成长性') {
          modScore[q.module] = modScore[q.module] || { score: 0, max: 0 };
          modScore[q.module].score += s.breakdown[q.id] ? s.breakdown[q.id].score : 0;
          modScore[q.module].max += q.maxScore || 0;
        }
      });

      Object.keys(modScore).forEach(function (m) {
        var ms = modScore[m];
        if (ms.score < ms.max * 0.7) {
          recommendations.push('【' + m + '】当前 ' + ms.score + ' / ' + ms.max + ' 分,有提升空间');
        }
      });
      recommendations.push('总分差距 ' + gap + ' 分,建议补足:');
      if (s.breakdown.ip_class1 && s.breakdown.ip_class1.score < 16) recommendations.push('• 申请 1-2 项发明专利(I 类,每项 8 分)');
      if (s.breakdown.transform_avg && s.breakdown.transform_avg.score < 18) recommendations.push('• 增加科技成果转化项数(每年 ≥3 项,合同 + 发票)');
      if (s.breakdown.mgmt_rule && s.breakdown.mgmt_rule.score < 14) recommendations.push('• 补齐研发组织管理制度文件(7 项制度)');
    }
    if (!hard.ok) {
      recommendations.push('【硬性指标】必须解决:');
      hard.issues.forEach(function (i) { recommendations.push('• ' + i); });
    }
    if (pass) {
      recommendations.push('✅ 评分达标,可准备申报材料');
    }

    return { total: s.total, breakdown: s.breakdown, hard: hard, pass: pass, recommendations: recommendations };
  }

  // ============ Vue 渲染 ============
  function renderHighTechTab(self, h) {
    // 子 tab 切换:自评打分 / 研发台账
    if (!self.htMainTab) self.htMainTab = 'assess';
    var setMain = function (k) { self.htMainTab = k; };

    var subBtn = function (key, label) {
      return h('button', {
        class: 'ht-mainsubtab' + (self.htMainTab === key ? ' active' : ''),
        onClick: () => { setMain(key); }
      }, label);
    };

    var subTabs = h('div', { class: 'ht-mainsubtabs' }, [
      subBtn('assess', '📋 自评打分'),
      subBtn('ledger', '💼 研发台账')
    ]);

    var content = self.htMainTab === 'ledger'
      ? (window.HTLedger ? window.HTLedger.renderLedgerTab(self, h) : h('div', { class: 'card' }, '台账模块加载中...'))
      : renderSelfAssessmentTab(self, h);

    return h('div', { class: 'hightech-wrap' }, [
      h('div', { class: 'ht-top' }, [
        h('h2', null, '高新技术企业认定'),
        h('p', { class: 'sub' }, '高新认定评分 · 知识产权清点 · 复审倒计时 · 申报材料清单 · 研发台账管理')
      ]),
      subTabs,
      content
    ]);
  }

  function renderSelfAssessmentTab(self, h) {
    // 顶层卡片:标题 + 操作按钮
    var card = function (title, body, opts) {
      opts = opts || {};
      return h('div', { class: 'card ht-card' + (opts.highlight ? ' ht-highlight' : '') }, [
        opts.icon ? h('h3', null, [opts.icon, ' ', title]) : h('h3', null, title),
        opts.sub ? h('p', { class: 'sub' }, opts.sub) : null,
        body
      ]);
    };

    // 答案 storage key
    var storeKey = 'zc_hightech_answers';
    // 关键:不要 self.highTechAnswers = {...} 整体覆盖(会丢失 setup 的 reactive)
    // 改为只在空时从 localStorage sync 进 reactive
    if (Object.keys(self.highTechAnswers || {}).length === 0) {
      try {
        var saved = localStorage.getItem(storeKey);
        if (saved) {
          var obj = JSON.parse(saved);
          Object.keys(obj).forEach(function (k) { self.highTechAnswers[k] = obj[k]; });
        }
      } catch (e) {}
    }
    var setAns = function (id, v) {
      self.highTechAnswers[id] = v;  // 写入 reactive 字段,触发响应式
      try { localStorage.setItem(storeKey, JSON.stringify(self.highTechAnswers)); } catch (e) {}
      self.highTechScore = null; // 触发重新计算
    };

    // 计算当前报告(每次 render 都算)
    var report = generateReport(self.highTechAnswers);

    // —— 评估仪表盘 ——
    var dashboard = card('评估仪表盘', null, { icon: '🎯' });
    var passBadge = report.pass
      ? h('div', { class: 'ht-badge ht-pass' }, ['✅ 可申报 (', report.total, ' / 100 分)'])
      : h('div', { class: 'ht-badge ht-fail' }, ['⚠️ 未达标 (', report.total, ' / 100 分,差 ', 71 - report.total, ' 分)']);
    var hardBadge = report.hard.ok
      ? h('div', { class: 'ht-badge ht-hard-ok' }, '✓ 硬性指标达标')
      : h('div', { class: 'ht-badge ht-hard-fail' }, '✗ 硬性指标 ' + report.hard.issues.length + ' 项不达标');

    var modBars = ['知识产权', '科技成果转化', '研发组织管理', '企业成长性'].map(function (m) {
      var score = 0, max = 0;
      QUESTIONS.forEach(function (q) {
        if (q.module === m && q.maxScore) {
          score += report.breakdown[q.id] ? report.breakdown[q.id].score : 0;
          max += q.maxScore;
        }
      });
      var pct = max > 0 ? Math.round((score / max) * 100) : 0;
      var color = pct >= 70 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444';
      return h('div', { class: 'ht-module-bar' }, [
        h('div', { class: 'ht-module-label' }, [m, h('span', { class: 'ht-module-score' }, score + ' / ' + max)]),
        h('div', { class: 'ht-bar-bg' }, [
          h('div', { class: 'ht-bar-fg', style: 'width:' + pct + '%;background:' + color })
        ])
      ]);
    });

    var dashboardContent = h('div', null, [
      h('div', { class: 'ht-badges' }, [passBadge, hardBadge]),
      h('div', { class: 'ht-modules' }, modBars)
    ]);

    // —— 自评打分器 ——
    var renderQ = function (q) {
      var v = self.highTechAnswers[q.id];
      var input;
      if (q.type === 'select') {
        input = h('select', {
          class: 'ht-input',
          value: v || '',
          onChange: function (e) { setAns(q.id, e.target.value); }
        }, [
          h('option', { value: '' }, '请选择...'),
          (q.options || []).map(function (o) {
            return h('option', { value: o.value }, o.label);
          })
        ]);
      } else if (q.type === 'number') {
        input = h('input', {
          class: 'ht-input',
          type: 'number',
          value: v || '',
          placeholder: q.unit || '',
          onInput: function (e) { setAns(q.id, e.target.value); }
        });
      } else if (q.type === 'multicheck') {
        var mc = v || {};
        input = h('div', { class: 'ht-multicheck' },
          (q.subItems || []).map(function (sub) {
            return h('label', { class: 'ht-check-item' }, [
              h('input', {
                type: 'checkbox',
                checked: !!mc[sub.id],
                onChange: function (e) {
                  var next = Object.assign({}, mc);
                  next[sub.id] = e.target.checked;
                  setAns(q.id, next);
                }
              }),
              h('span', null, [sub.label, h('span', { class: 'ht-check-score' }, '+' + sub.score)])
            ]);
          })
        );
      }
      return h('div', { class: 'ht-q' }, [
        h('div', { class: 'ht-q-title' }, [
          h('span', { class: 'ht-q-module ht-mod-' + q.module }, q.module),
          q.title
        ]),
        h('div', { class: 'ht-q-body' }, input),
        q.hint ? h('div', { class: 'ht-q-hint' }, q.hint) : null
      ]);
    };

    // 按模块分组
    var modules = ['知识产权', '科技成果转化', '研发组织管理', '企业成长性', '硬性指标'];
    var sections = modules.map(function (m) {
      var qs = QUESTIONS.filter(function (q) { return q.module === m; });
      return h('div', { class: 'ht-section' }, [
        h('h4', null, m + ' (' + qs.length + ' 项)'),
        qs.map(renderQ)
      ]);
    });

    var quizCard = card('自评打分器', h('div', null, sections), {
      icon: '📋',
      sub: '逐项填写,实时计算分数。通过线:71 分,且所有硬性指标达标。'
    });

    // —— 改进建议 ——
    var recommendContent = report.recommendations.length === 0
      ? h('div', { class: 'ht-empty' }, '请先填写自评打分器')
      : h('ul', { class: 'ht-recs' },
          report.recommendations.map(function (r) {
            return h('li', null, r);
          })
        );

    var recommendCard = card('改进建议', recommendContent, { icon: '💡' });

    // —— 复审倒计时 ——
    var reviewDateKey = 'zc_hightech_review_date';
    if (!self.highTechReviewDate) {
      try { self.highTechReviewDate = localStorage.getItem(reviewDateKey) || ''; } catch (e) { self.highTechReviewDate = ''; }
    }
    var setReviewDate = function (v) {
      self.highTechReviewDate = v;
      try { localStorage.setItem(reviewDateKey, v); } catch (e) {}
    };

    var daysLeft = null;
    if (self.highTechReviewDate) {
      var target = new Date(self.highTechReviewDate);
      var now = new Date();
      daysLeft = Math.ceil((target - now) / (24 * 3600 * 1000));
    }
    var countdownEl = daysLeft === null
      ? h('div', { class: 'ht-countdown-empty' }, '请填写复审截止日期')
      : daysLeft > 0
        ? h('div', { class: 'ht-countdown ht-warn' }, ['⏳ 距离复审还有 ', h('strong', null, daysLeft), ' 天'])
        : h('div', { class: 'ht-countdown ht-danger' }, ['⚠️ 已过期 ', Math.abs(daysLeft), ' 天,立即准备复审']);

    var reviewCard = card('复审倒计时', h('div', null, [
      h('div', { class: 'ht-row' }, [
        h('label', null, '高新证书复审日期'),
        h('input', {
          type: 'date',
          class: 'ht-input',
          value: self.highTechReviewDate || '',
          onInput: function (e) { setReviewDate(e.target.value); }
        })
      ]),
      countdownEl,
      h('div', { class: 'ht-hint-line' }, '高新证书有效期 3 年,提前 3 个月准备复审材料')
    ]), { icon: '⏰' });

    // —— 申报材料清单(知识库) ——
    var materials = [
      { cat: '基础材料', items: ['营业执照副本', '公司章程', '股东会决议', '企业信用代码证'] },
      { cat: '知识产权', items: ['知识产权证书(发明/实用新型/软著)', '知识产权摘要', '知识产权对主营产品支持说明', '近 3 年知识产权获取台账'] },
      { cat: '科技成果转化', items: ['科技成果转化清单(每年 ≥5 项)', '转化合同 / 发票 / 用户报告', '转化成效证明', '技术应用证明'] },
      { cat: '研发组织管理', items: ['研发组织架构图', '研发投入核算体系文件', '产学研合作协议', '研发人员考核制度', '知识产权管理制度', '研发设备清单', '研发场地证明'] },
      { cat: '研发人员', items: ['科技人员名单(占比 ≥10%)', '学历 / 职称证明', '社保缴纳证明', '劳动合同 / 岗位证明'] },
      { cat: '研发费用', items: ['研发费用辅助账', '研发费用专项审计报告(年度)', '研发费用归集说明', '研发费用预算 / 决算'] },
      { cat: '高新技术产品', items: ['高新技术产品(服务)清单', '技术说明文档', '产品技术属于高新领域证明', '收入与产品对应台账'] },
      { cat: '企业成长性', items: ['近 3 年财务报表(资产负债 / 利润)', '销售收入与净资产增长率说明', '审计报告'] }
    ];

    var materialsCard = card('申报材料清单', h('div', { class: 'ht-materials' },
      materials.map(function (m) {
        return h('div', { class: 'ht-mat-cat' }, [
          h('div', { class: 'ht-mat-cat-title' }, m.cat + ' (' + m.items.length + ')'),
          h('ul', null, m.items.map(function (it) { return h('li', null, it); }))
        ]);
      })
    ), { icon: '📑', sub: '完整申报材料清单,按需准备' });

    return [
      dashboardContent,
      quizCard,
      recommendCard,
      reviewCard,
      materialsCard,
      h('div', { class: 'ht-export-row' }, [
        h('button', {
          class: 'btn',
          onClick: function () {
            var text = JSON.stringify({ answers: self.highTechAnswers, report: report, ts: Date.now() }, null, 2);
            var blob = new Blob([text], { type: 'application/json' });
            var url = URL.createObjectURL(blob);
            var a = document.createElement('a');
            a.href = url;
            a.download = '高新评估_' + new Date().toISOString().slice(0, 10) + '.json';
            a.click();
            URL.revokeObjectURL(url);
          }
        }, '📥 导出评估结果(JSON)'),
        h('button', {
          class: 'btn btn-ghost',
          onClick: function () {
            if (!confirm('清空所有自评答案?此操作不可恢复。')) return;
            self.highTechAnswers = {};
            try { localStorage.removeItem(storeKey); } catch (e) {}
            self.highTechScore = null;
          }
        }, '🗑️ 清空答案')
      ])
    ];
  }

  // ============ 暴露 ============
  window.HighTech = {
    SCORING: SCORING,
    QUESTIONS: QUESTIONS,
    calcScore: calcScore,
    checkHard: checkHard,
    generateReport: generateReport,
    renderHighTechTab: renderHighTechTab
  };
})();