// ht-ledger.js - 高新认定台账管理 v0.5
// 依据《高新技术企业认定管理工作指引》(国科发火[2016]195号) 附件2
// 含:研发项目台账、研发费用辅助账(7大类别)、研发人员工时、高新产品(服务)收入
(function () {
  'use strict';

  // ============ 研发费用 7 大类别(《工作指引》附件2) ============
  // 严格按官方口径定义,每类的核算范围见《工作指引》
  const RD_CATEGORIES = [
    {
      code: 'staff',
      name: '人员人工费用',
      icon: '👥',
      desc: '研发人员工资薪金、五险一金、外聘研发人员劳务费(不含非全时研发人员的非研发工时部分)',
      examples: ['研发人员工资', '研发人员奖金', '研发人员社保', '研发人员公积金', '外聘研发人员劳务费'],
      // 注意: 非全时研发人员需按工时分摊(见 workHours 模块)
      ratioNote: '非全时人员按工时占比分摊'
    },
    {
      code: 'material',
      name: '直接投入费用',
      icon: '🧪',
      desc: '研发活动直接消耗的材料、燃料、动力费;用于研发的仪器设备租赁/维护/调整/检验费;试制产品检验费',
      examples: ['研发用材料', '研发用燃料动力', '研发设备租赁', '仪器维护', '试制检验费']
    },
    {
      code: 'depreciation',
      name: '折旧费用',
      icon: '🏭',
      desc: '用于研发活动的仪器、设备、房屋的折旧费(与生产共用的按工时/面积分摊)',
      examples: ['研发设备折旧', '研发场地折旧', '研发仪器折旧']
    },
    {
      code: 'amortization',
      name: '无形资产摊销',
      icon: '📜',
      desc: '用于研发活动的软件、专利权、非专利技术的摊销费用',
      examples: ['研发用软件摊销', '专利权摊销', '非专利技术摊销']
    },
    {
      code: 'design',
      name: '新产品设计费等',
      icon: '🎨',
      desc: '新产品设计费、新工艺规程制定费、新药研制的临床试验费、勘探开发技术的现场试验费',
      examples: ['新产品设计费', '新工艺规程制定费', '新药临床试验', '勘探现场试验']
    },
    {
      code: 'outsource',
      name: '委托外部研究开发费用',
      icon: '🤝',
      desc: '委托境内外机构进行研发活动发生的费用(委托方按 80% 计入研发费用,受托方不得重复计入)',
      examples: ['委托研发合同', '委托测试', '委托设计'],
      ratioNote: '委托方按 80% 计入(《工作指引》)'
    },
    {
      code: 'other',
      name: '其他相关费用',
      icon: '📋',
      desc: '与研发活动相关的其他费用,如:技术图书资料费、资料翻译费、会议费、差旅费、办公费、研发人员培训费、专家咨询费、知识产权申请费、高新科技研发保险费、研发成果检索/分析/论证/鉴定/评审/验收费用',
      examples: ['技术图书', '翻译费', '差旅费', '会议费', '专家咨询', '知识产权申请', '研发培训'],
      // 关键规则:其他费用 ≤ 研发费用总额 × 20%
      ratioLimit: 0.20,
      ratioNote: '⚠️ 其他费用合计不得超过研发费用总额的 20%(《工作指引》)'
    }
  ];

  // ============ 科技人员统计口径 ============
  const TECH_STAFF_RATIO_MIN = 0.10;  // 科技人员占职工总数 ≥10%

  // ============ 高新技术领域(电子信息/高技术服务/先进制造等) ============
  const HT_FIELDS = [
    { code: 'EI', name: '电子信息', desc: '软件/集成电路/云计算/人工智能/大数据/物联网/工业软件' },
    { code: 'BT', name: '生物医药', desc: '创新药/医疗器械/生物制品' },
    { code: 'AR', name: '航空航天', desc: '航空装备/卫星应用/航天技术' },
    { code: 'NM', name: '新材料', desc: '金属/无机非金属/高分子/复合材料' },
    { code: 'AM', name: '先进制造与自动化', desc: '工业自动化/智能装备/工业软件' },
    { code: 'NE', name: '新能源与节能', desc: '新能源/可再生能源/节能技术' },
    { code: 'EP', name: '资源与环境', desc: '环保/资源利用/环境监测' },
    { code: 'HT', name: '高技术服务', desc: '信息技术服务/研发设计/检验检测/技术咨询/知识产权' }
  ];

  // ============ 数据库 ============
  let db = null;
  let dbReady = false;
  let dbError = null;
  function initDB() {
    if (db) return db;
    try {
      // 单独 db 名,避免和 app.js 主库冲突
      db = new Dexie('ipbutler_ht');
      db.version(1).stores({
        // 研发项目
        ht_projects: '++id, code, name, status, startDate, endDate, leader, fieldCode, budget, ts',
        // 研发费用 - 按项目按月按类别
        ht_expenses: '++id, projectId, yearMonth, category, amount, note, hasInvoice, ts',
        // 研发人员(含职工总数,用于算科技人员占比)
        ht_staff: '++id, name, isFullTime, isTech, role, education, joinedAt, ts',
        // 工时分配(每人每月每项目的研发工时)
        ht_hours: '++id, staffId, projectId, yearMonth, hours, ts',
        // 高新收入台账
        ht_income: '++id, yearMonth, product, fieldCode, amount, hasContract, hasInvoice, ts'
      });
      dbReady = true;
      dbError = null;
      // 不订阅 db.on('error') — Dexie 3.x API 行为变化,默认 promise reject 已足够
      // 主动 open 一次,失败时更新 dbError
      db.open().catch(function (e) {
        dbReady = false;
        dbError = e.message || String(e);
        console.error('[HTLedger db.open() FAIL]', e);
      });
    } catch (e) {
      dbError = e.message || String(e);
      console.error('[HTLedger initDB FAIL]', e);
      if (window.__showError) window.__showError('ht-init', e);
    }
    return db;
  }
  // 同步触发初始化,确保 dbReady 状态尽早确定
  initDB();

  // ============ CRUD: 项目 ============
  async function listProjects() {
    initDB();
    return db.ht_projects.orderBy('ts').reverse().toArray();
  }
  async function getProject(id) {
    initDB();
    return db.ht_projects.get(id);
  }
  async function saveProject(p) {
    initDB();
    p.ts = Date.now();
    if (p.id) {
      await db.ht_projects.put(p);
      return p.id;
    } else {
      delete p.id;
      return db.ht_projects.add(p);
    }
  }
  async function deleteProject(id) {
    initDB();
    await db.transaction('rw', [db.ht_projects, db.ht_expenses, db.ht_hours], async () => {
      await db.ht_projects.delete(id);
      await db.ht_expenses.where('projectId').equals(id).delete();
      await db.ht_hours.where('projectId').equals(id).delete();
    });
  }

  // ============ CRUD: 费用 ============
  async function listExpenses(filter) {
    initDB();
    filter = filter || {};
    if (!db) return [];
    try {
      let all;
      if (filter.projectId) {
        all = await db.ht_expenses.where('projectId').equals(filter.projectId).toArray();
      } else if (filter.yearMonth) {
        all = await db.ht_expenses.where('yearMonth').equals(filter.yearMonth).toArray();
      } else {
        all = await db.ht_expenses.toArray();
      }
      return all.sort(function (a, b) { return (b.ts || 0) - (a.ts || 0); });
    } catch (e) {
      console.error('[listExpenses]', e);
      return [];
    }
  }
  async function saveExpense(e) {
    initDB();
    e.ts = Date.now();
    if (e.id) {
      await db.ht_expenses.put(e);
      return e.id;
    } else {
      delete e.id;
      return db.ht_expenses.add(e);
    }
  }
  async function deleteExpense(id) {
    initDB();
    await db.ht_expenses.delete(id);
  }

  // ============ CRUD: 人员 ============
  async function listStaff() {
    initDB();
    return db.ht_staff.orderBy('ts').reverse().toArray();
  }
  async function saveStaff(s) {
    initDB();
    s.ts = Date.now();
    if (s.id) {
      await db.ht_staff.put(s);
      return s.id;
    } else {
      delete s.id;
      return db.ht_staff.add(s);
    }
  }
  async function deleteStaff(id) {
    initDB();
    await db.transaction('rw', [db.ht_staff, db.ht_hours], async () => {
      await db.ht_staff.delete(id);
      await db.ht_hours.where('staffId').equals(id).delete();
    });
  }

  // ============ CRUD: 工时 ============
  async function listHours(filter) {
    initDB();
    filter = filter || {};
    if (filter.staffId) return db.ht_hours.where('staffId').equals(filter.staffId).toArray();
    if (filter.projectId) return db.ht_hours.where('projectId').equals(filter.projectId).toArray();
    if (filter.yearMonth) return db.ht_hours.where('yearMonth').equals(filter.yearMonth).toArray();
    return db.ht_hours.toArray();
  }
  async function saveHour(h) {
    initDB();
    h.ts = Date.now();
    if (h.id) {
      await db.ht_hours.put(h);
      return h.id;
    } else {
      delete h.id;
      return db.ht_hours.add(h);
    }
  }
  async function deleteHour(id) {
    initDB();
    await db.ht_hours.delete(id);
  }

  // ============ CRUD: 高新收入 ============
  async function listIncome() {
    initDB();
    return db.ht_income.orderBy('ts').reverse().toArray();
  }
  async function saveIncome(i) {
    initDB();
    i.ts = Date.now();
    if (i.id) {
      await db.ht_income.put(i);
      return i.id;
    } else {
      delete i.id;
      return db.ht_income.add(i);
    }
  }
  async function deleteIncome(id) {
    initDB();
    await db.ht_income.delete(id);
  }

  // ============ 计算: 项目年度研发费用合计 ============
  async function projectTotalByYear(projectId, year) {
    const expenses = await listExpenses({ projectId: projectId });
    let total = 0;
    expenses.forEach(e => {
      if (e.yearMonth && e.yearMonth.startsWith(String(year))) {
        total += parseFloat(e.amount) || 0;
      }
    });
    return total;
  }

  // ============ 计算: 项目类别合计(辅助账基础) ============
  async function projectCategoryTotals(projectId, year) {
    const expenses = await listExpenses({ projectId: projectId });
    const totals = {};
    RD_CATEGORIES.forEach(c => totals[c.code] = 0);
    expenses.forEach(e => {
      if (e.yearMonth && e.yearMonth.startsWith(String(year))) {
        if (totals[e.category] !== undefined) {
          totals[e.category] += parseFloat(e.amount) || 0;
        }
      }
    });
    return totals;
  }

  // ============ 计算: 全部研发费用结构(用于"附件2"汇总表) ============
  async function rdStructureByYear(year) {
    const projects = await listProjects();
    const result = {
      year: year,
      categories: {},   // 按类别汇总
      byProject: [],    // 按项目汇总
      total: 0,
      otherRatio: 0,
      domestic: 0,
      domesticRatio: 0,
      warnings: []
    };

    // 初始化
    RD_CATEGORIES.forEach(c => result.categories[c.code] = 0);

    for (const p of projects) {
      const cat = await projectCategoryTotals(p.id, year);
      const ptot = Object.values(cat).reduce((s, v) => s + v, 0);
      const byProj = {
        id: p.id, code: p.code, name: p.name,
        leader: p.leader, fieldCode: p.fieldCode,
        categories: cat,
        total: ptot
      };
      result.byProject.push(byProj);

      // 累加到类别汇总
      Object.keys(cat).forEach(k => {
        result.categories[k] += cat[k];
      });
    }
    result.total = Object.values(result.categories).reduce((s, v) => s + v, 0);

    // 其他费用占比校验
    if (result.total > 0) {
      result.otherRatio = result.categories.other / result.total;
      if (result.otherRatio > 0.20) {
        result.warnings.push('"其他费用"占研发费用 ' + (result.otherRatio * 100).toFixed(2) + '% > 20%,违反《工作指引》规定');
      }
    }

    return result;
  }

  // ============ 计算: 科技人员占比 ============
  async function techStaffRatio(year) {
    const staff = await listStaff();
    if (staff.length === 0) return { total: 0, tech: 0, ratio: 0 };
    // 当年职工总数 = 截止到该年仍在职的所有人员(简化:用总数,因为没维护离职时间)
    // 实际应用应该按月或按年维护在岗状态
    const yearStr = String(year);
    const total = staff.filter(s => s.joinedAt && s.joinedAt <= yearStr + '-12-31').length;
    const tech = staff.filter(s => s.isTech && s.joinedAt && s.joinedAt <= yearStr + '-12-31').length;
    return {
      total: total,
      tech: tech,
      ratio: total > 0 ? tech / total : 0,
      ok: total > 0 && tech / total >= TECH_STAFF_RATIO_MIN
    };
  }

  // ============ 计算: 高新收入占比 ============
  async function hightechIncomeByYear(year) {
    const all = await listIncome();
    const ym = String(year);
    let total = 0;
    let htTotal = 0;
    all.forEach(i => {
      if (i.yearMonth && i.yearMonth.startsWith(ym)) {
        htTotal += parseFloat(i.amount) || 0;
      }
    });
    // 总收入需要从外部传入(财务账),暂用 ht_total 作为参考
    return {
      year: year,
      htIncome: htTotal,
      totalIncome: 0,  // 需要用户从财务账录入
      ratio: 0,
      warnings: []
    };
  }

  // ============ 校验: 三表一致 ============
  // 三表: 财务辅助账(rdStructure.total) vs 税务加计扣除金额 vs 专项审计报告金额
  function checkTripleMatch(values) {
    const v = values.filter(x => x > 0);
    if (v.length < 2) return { ok: true, diffRate: 0, max: 0, min: 0, msg: '数据不足' };
    const max = Math.max.apply(null, v);
    const min = Math.min.apply(null, v);
    const diffRate = max > 0 ? (max - min) / max : 0;
    return {
      ok: diffRate <= 0.15,
      diffRate: diffRate,
      max: max,
      min: min,
      msg: diffRate <= 0.15
        ? '✓ 三表一致(差异率 ' + (diffRate * 100).toFixed(2) + '% ≤ 15%)'
        : '⚠️ 三表差异率 ' + (diffRate * 100).toFixed(1) + '% > 15%,需统一调整'
    };
  }

  // ============ Vue 渲染 ============
  function renderLedgerTab(self, h) {
    var subTabKey = 'ht_ledger_subtab';
    if (!self.htSubTab) {
      try { self.htSubTab = localStorage.getItem(subTabKey) || 'overview'; } catch (e) { self.htSubTab = 'overview'; }
    }

    // DB 完全不可用时,所有子 tab 都显示错误
    if (dbError && !db) {
      return h('div', null, [
        h('div', { class: 'ht-top' }, [
          h('h2', null, '研发台账管理'),
          h('p', { class: 'sub' }, '数据库连接失败')
        ]),
        h('div', { class: 'card ht-card ht-db-error', style: 'border-left:4px solid #ef4444' }, [
          h('h3', { style: 'color:#991b1b;margin-top:0' }, '⚠️ IndexedDB 不可用'),
          h('p', null, '研发台账需要本地数据库支持,但当前环境无法访问。'),
          h('p', { style: 'font-size:13px;color:#666' }, '可能原因:'),
          h('ul', { style: 'font-size:13px;color:#666' }, [
            h('li', null, '• 浏览器隐私/无痕模式(IndexedDB 在该模式下被禁用)'),
            h('li', null, '• 浏览器禁用了第三方 Cookie 或本站点存储'),
            h('li', null, '• 之前的数据库 schema 与当前版本不匹配(请清除本站点数据)')
          ]),
          h('p', { style: 'font-size:13px;color:#666' }, '错误: ' + (dbError || 'unknown')),
          h('p', { style: 'font-size:13px;color:#666' }, '解决:用普通模式打开,或 F12 → Application → IndexedDB → 删除 "ipbutler_ht" → 刷新。')
        ])
      ]);
    }
    var setSub = function (k) {
      self.htSubTab = k;
      try { localStorage.setItem(subTabKey, k); } catch (e) {}
    };

    var card = function (title, body, opts) {
      opts = opts || {};
      return h('div', { class: 'card ht-card' }, [
        opts.icon ? h('h3', null, [opts.icon, ' ', title]) : h('h3', null, title),
        opts.sub ? h('p', { class: 'sub' }, opts.sub) : null,
        body
      ]);
    };

    var subBtn = function (key, label) {
      return h('button', {
        class: 'ht-subtab' + (self.htSubTab === key ? ' active' : ''),
        onClick: () => { setSub(key); }
      }, label);
    };

    var tabs = h('div', { class: 'ht-subtabs' }, [
      subBtn('overview', '📊 总览'),
      subBtn('projects', '📁 研发项目台账'),
      subBtn('expenses', '💰 研发费用辅助账'),
      subBtn('staff', '👥 研发人员'),
      subBtn('income', '💵 高新收入'),
      subBtn('export', '📤 导出审计材料')
    ]);

    var content;
    if (self.htSubTab === 'overview') content = renderOverview(self, h);
    else if (self.htSubTab === 'projects') content = renderProjects(self, h, card);
    else if (self.htSubTab === 'expenses') content = renderExpenses(self, h, card);
    else if (self.htSubTab === 'staff') content = renderStaff(self, h, card);
    else if (self.htSubTab === 'income') content = renderIncome(self, h, card);
    else if (self.htSubTab === 'export') content = renderExport(self, h, card);

    return h('div', null, [
      h('div', { class: 'ht-top', style: 'margin-bottom:12px' }, [
        h('h2', null, '研发台账管理'),
        h('p', { class: 'sub' }, '研发项目 + 费用辅助账 + 人员工时 + 高新收入,符合《高新技术企业认定管理工作指引》(国科发火[2016]195号)')
      ]),
      tabs,
      content
    ]);
  }

  // ============ 子页面: 总览 ============
  function renderOverview(self, h) {
    var card = function (title, body, opts) {
      opts = opts || {};
      return h('div', { class: 'card ht-card' }, [
        opts.icon ? h('h3', null, [opts.icon, ' ', title]) : h('h3', null, title),
        body
      ]);
    };

    // DB 不可用时显示降级 UI
    if (!db || dbError) {
      return card('总览', h('div', { class: 'ht-db-error' }, [
        h('div', { style: 'color:#991b1b;font-weight:600;margin-bottom:8px' }, '⚠️ 本地数据库不可用'),
        h('p', { style: 'font-size:13px;color:#666' }, '可能原因:浏览器禁用了 IndexedDB(隐私模式/第三方 Cookie 屏蔽),或数据库版本不匹配。'),
        h('p', { style: 'font-size:13px;color:#666' }, '错误详情: ' + (dbError || 'Dexie 未初始化')),
        h('p', { style: 'font-size:13px;color:#666' }, '解决:请用正常模式打开(非隐私窗口),或清除浏览器本站点数据后刷新。')
      ]), { icon: '📊' });
    }

    if (!self.htOverview.year) { self.htOverview.year = new Date().getFullYear(); self.htOverview.data = null; self.htOverview.loading = false; }

    var loadData = async function () {
      try {
        self.htOverview.loading = true;
        self.htOverview.data = await rdStructureByYear(self.htOverview.year);
        var techR = await techStaffRatio(self.htOverview.year);
        self.htOverview.techRatio = techR;
      } catch (e) {
        console.error('[renderOverview loadData]', e);
        if (window.__showError) window.__showError('overview', e);
        self.htOverview.error = e.message || String(e);
      } finally {
        self.htOverview.loading = false;
      }
    };

    var loadData = async function () {
      self.htOverview.loading = true;
      self.htOverview.data = await rdStructureByYear(self.htOverview.year);
      var techR = await techStaffRatio(self.htOverview.year);
      self.htOverview.techRatio = techR;
      self.htOverview.loading = false;
    };

    if (!self.htOverview.loaded) {
      self.htOverview.loaded = true;
      setTimeout(loadData, 0);
    }

    var yearInput = h('div', { class: 'ht-row' }, [
      h('label', null, '统计年份'),
      h('input', {
        type: 'number',
        class: 'ht-input',
        value: self.htOverview.year,
        onInput: (e) => { self.htOverview.year = parseInt(e.target.value) || new Date().getFullYear(); },
        onChange: () => { self.htOverview.loaded = false; }
      }),
      h('button', { class: 'btn btn-primary', onClick: () => { self.htOverview.loaded = false; } }, '🔄 刷新')
    ]);

    var body = h('div', null, [yearInput]);

    if (self.htOverview.data) {
      var d = self.htOverview.data;
      var categoryCards = RD_CATEGORIES.map(function (c) {
        var amount = d.categories[c.code] || 0;
        var pct = d.total > 0 ? (amount / d.total * 100) : 0;
        var isOther = c.code === 'other';
        var warn = isOther && d.otherRatio > 0.20;
        return h('div', { class: 'ht-cat-card' + (warn ? ' ht-warn' : '') }, [
          h('div', { class: 'ht-cat-icon' }, c.icon),
          h('div', { class: 'ht-cat-name' }, c.name),
          h('div', { class: 'ht-cat-amount' }, '¥ ' + amount.toLocaleString()),
          h('div', { class: 'ht-cat-pct' }, pct.toFixed(1) + '%'),
          warn ? h('div', { class: 'ht-cat-warn' }, '⚠️ >20% 违规') : null
        ]);
      });

      var warnList = h('ul', { class: 'ht-warn-list' }, d.warnings.map(function (w) {
        return h('li', null, w);
      }));

      var totalCard = h('div', { class: 'ht-total-card' }, [
        h('div', { class: 'ht-total-label' }, self.htOverview.year + ' 年研发费用总额'),
        h('div', { class: 'ht-total-amount' }, '¥ ' + d.total.toLocaleString())
      ]);

      var techCard = self.htOverview.techRatio ? h('div', { class: 'ht-tech-card ' + (self.htOverview.techRatio.ok ? 'ht-ok' : 'ht-warn-card') }, [
        h('div', { class: 'ht-tech-label' }, '科技人员占比'),
        h('div', { class: 'ht-tech-value' }, (self.htOverview.techRatio.ratio * 100).toFixed(1) + '%'),
        h('div', { class: 'ht-tech-detail' }, [
          h('span', null, '科技人员 ' + self.htOverview.techRatio.tech + ' 人 / 职工总数 ' + self.htOverview.techRatio.total + ' 人'),
          self.htOverview.techRatio.ok
            ? h('div', { class: 'ht-tech-ok' }, '✓ 满足 ≥10%')
            : h('div', { class: 'ht-tech-fail' }, '⚠️ 低于 10%,需补充研发人员')
        ])
      ]) : null;

      body = h('div', null, [
        yearInput,
        h('div', { class: 'ht-overview-top' }, [totalCard, techCard]),
        h('h4', null, '研发费用结构(《工作指引》附件2 口径)'),
        h('div', { class: 'ht-cat-grid' }, categoryCards),
        d.warnings.length > 0 ? h('div', null, [
          h('h4', { style: 'color:#991b1b' }, '⚠️ 校验警告'),
          warnList
        ]) : h('div', { class: 'ht-ok-banner' }, '✓ 研发费用结构合规')
      ]);
    }

    return card('总览', body, { icon: '📊' });
  }

  // ============ 子页面: 项目台账 ============
  function renderProjects(self, h, card) {
    if (!self.htProjects.list) { self.htProjects.list = []; self.htProjects.loading = false; self.htProjects.loaded = false; self.htProjects.editing = null; }

    var load = async function () {
      try {
        self.htProjects.loading = true;
        self.htProjects.list = await listProjects();
      } catch (e) {
        console.error('[renderProjects load]', e);
        if (window.__showError) window.__showError('projects', e);
        self.htProjects.list = [];
      } finally {
        self.htProjects.loading = false;
        self.htProjects.loaded = true;
      }
    };

    if (!self.htProjects.loaded) {
      self.htProjects.loaded = true;
      setTimeout(load, 0);
    }

    var newProj = function () {
      self.htProjects.editing = {
        code: 'RD' + String(new Date().getFullYear()).slice(-2) + '-' + String(Math.floor(Math.random() * 999)).padStart(3, '0'),
        name: '',
        status: 'ongoing',
        startDate: '',
        endDate: '',
        leader: '',
        fieldCode: 'EI',
        budget: 0,
        purpose: '',
        techRoute: '',
        expectedResult: ''
      };
    };

    var save = async function () {
      if (!self.htProjects.editing.name) {
        alert('项目名称必填');
        return;
      }
      await saveProject(Object.assign({}, self.htProjects.editing));
      self.htProjects.editing = null;
      self.htProjects.loaded = false;
    };

    var editBtn = async function (id) {
      var p = await getProject(id);
      self.htProjects.editing = Object.assign({}, p);
    };

    var delBtn = async function (id) {
      if (!confirm('删除项目会同时删除关联的费用和工时数据,确定?')) return;
      await deleteProject(id);
      self.htProjects.loaded = false;
    };

    var form = self.htProjects.editing ? h('div', { class: 'ht-form' }, [
      h('h4', null, self.htProjects.editing.id ? '编辑项目' : '新增项目'),
      h('div', { class: 'ht-form-row' }, [
        h('label', null, '项目编号'),
        h('input', { class: 'ht-input', value: self.htProjects.editing.code, onInput: (e) => { self.htProjects.editing.code = e.target.value; } })
      ]),
      h('div', { class: 'ht-form-row' }, [
        h('label', null, '项目名称*'),
        h('input', { class: 'ht-input', value: self.htProjects.editing.name, onInput: (e) => { self.htProjects.editing.name = e.target.value; } })
      ]),
      h('div', { class: 'ht-form-row' }, [
        h('label', null, '技术领域'),
        h('select', { class: 'ht-input', value: self.htProjects.editing.fieldCode, onChange: (e) => { self.htProjects.editing.fieldCode = e.target.value; } },
          HT_FIELDS.map(function (f) { return h('option', { value: f.code }, f.name + ' - ' + f.desc); })
        )
      ]),
      h('div', { class: 'ht-form-row' }, [
        h('label', null, '状态'),
        h('select', { class: 'ht-input', value: self.htProjects.editing.status, onChange: (e) => { self.htProjects.editing.status = e.target.value; } }, [
          h('option', { value: 'planning' }, '计划中'),
          h('option', { value: 'ongoing' }, '进行中'),
          h('option', { value: 'finished' }, '已结题')
        ])
      ]),
      h('div', { class: 'ht-form-row' }, [
        h('label', null, '开始日期'),
        h('input', { class: 'ht-input', type: 'date', value: self.htProjects.editing.startDate, onInput: (e) => { self.htProjects.editing.startDate = e.target.value; } })
      ]),
      h('div', { class: 'ht-form-row' }, [
        h('label', null, '结束日期'),
        h('input', { class: 'ht-input', type: 'date', value: self.htProjects.editing.endDate, onInput: (e) => { self.htProjects.editing.endDate = e.target.value; } })
      ]),
      h('div', { class: 'ht-form-row' }, [
        h('label', null, '负责人'),
        h('input', { class: 'ht-input', value: self.htProjects.editing.leader, onInput: (e) => { self.htProjects.editing.leader = e.target.value; } })
      ]),
      h('div', { class: 'ht-form-row' }, [
        h('label', null, '预算(元)'),
        h('input', { class: 'ht-input', type: 'number', value: self.htProjects.editing.budget, onInput: (e) => { self.htProjects.editing.budget = parseFloat(e.target.value) || 0; } })
      ]),
      h('div', { class: 'ht-form-row' }, [
        h('label', null, '立项目的'),
        h('textarea', { class: 'ht-input', rows: 2, value: self.htProjects.editing.purpose, onInput: (e) => { self.htProjects.editing.purpose = e.target.value; } })
      ]),
      h('div', { class: 'ht-form-row' }, [
        h('label', null, '技术路线'),
        h('textarea', { class: 'ht-input', rows: 2, value: self.htProjects.editing.techRoute, onInput: (e) => { self.htProjects.editing.techRoute = e.target.value; } })
      ]),
      h('div', { class: 'ht-form-row' }, [
        h('label', null, '预期成果'),
        h('textarea', { class: 'ht-input', rows: 2, value: self.htProjects.editing.expectedResult, onInput: (e) => { self.htProjects.editing.expectedResult = e.target.value; } })
      ]),
      h('div', { class: 'ht-form-actions' }, [
        h('button', { class: 'btn btn-primary', onClick: save }, '💾 保存'),
        h('button', { class: 'btn-ghost', onClick: () => { self.htProjects.editing = null; } }, '取消')
      ])
    ]) : null;

    var tableRows = self.htProjects.list.map(function (p) {
      return h('tr', null, [
        h('td', null, p.code),
        h('td', null, p.name),
        h('td', null, (HT_FIELDS.find(f => f.code === p.fieldCode) || {}).name || '-'),
        h('td', null, p.status === 'planning' ? '计划中' : p.status === 'ongoing' ? '进行中' : '已结题'),
        h('td', null, p.startDate || '-'),
        h('td', null, p.leader || '-'),
        h('td', null, '¥ ' + (p.budget || 0).toLocaleString()),
        h('td', null, [
          h('button', { class: 'btn-mini', onClick: () => editBtn(p.id) }, '编辑'),
          h('button', { class: 'btn-mini danger', onClick: () => delBtn(p.id) }, '删除')
        ])
      ]);
    });

    var table = self.htProjects.list.length === 0
      ? h('div', { class: 'ht-empty' }, '暂无项目,点击右上角"➕ 新增项目"创建')
      : h('table', { class: 'ht-table' }, [
          h('thead', null, [
            h('tr', null, [
              h('th', null, '编号'),
              h('th', null, '名称'),
              h('th', null, '技术领域'),
              h('th', null, '状态'),
              h('th', null, '开始日期'),
              h('th', null, '负责人'),
              h('th', null, '预算'),
              h('th', null, '操作')
            ])
          ]),
          h('tbody', null, tableRows)
        ]);

    return card('研发项目台账', h('div', null, [
      h('div', { class: 'ht-toolbar' }, [
        h('span', { class: 'ht-hint-inline' }, '共 ' + self.htProjects.list.length + ' 个研发项目'),
        h('button', { class: 'btn btn-primary', onClick: newProj }, '➕ 新增项目')
      ]),
      form,
      table
    ]), { icon: '📁', sub: '研发项目立项台账,需含:项目编号/名称/起止时间/负责人/技术领域/预算/技术路线/预期成果' });
  }

  // ============ 子页面: 费用辅助账 ============
  function renderExpenses(self, h, card) {
    if (!self.htExpenses.list) { self.htExpenses.list = []; self.htExpenses.projects = []; self.htExpenses.loading = false; self.htExpenses.loaded = false; self.htExpenses.editing = null; self.htExpenses.filterProject = 'all'; self.htExpenses.filterYear = new Date().getFullYear(); }

    var load = async function () {
      self.htExpenses.loading = true;
      self.htExpenses.projects = await listProjects();
      var all = [];
      for (var p of self.htExpenses.projects) {
        var exps = await listExpenses({ projectId: p.id });
        exps.forEach(function (e) {
          e._projectName = p.name;
          e._projectCode = p.code;
          all.push(e);
        });
      }
      all.sort(function (a, b) { return b.ts - a.ts; });
      self.htExpenses.list = all;
      self.htExpenses.loading = false;
      self.htExpenses.loaded = true;
    };

    if (!self.htExpenses.loaded) {
      self.htExpenses.loaded = true;
      setTimeout(load, 0);
    }

    var newExp = function () {
      if (self.htExpenses.projects.length === 0) {
        alert('请先在【研发项目台账】中创建项目');
        return;
      }
      var d = new Date();
      var ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      self.htExpenses.editing = {
        projectId: self.htExpenses.projects[0].id,
        yearMonth: ym,
        category: 'staff',
        amount: 0,
        note: '',
        hasInvoice: false,
        isDomestic: true
      };
    };

    var save = async function () {
      var e = self.htExpenses.editing;
      if (!e.projectId) { alert('请选项目'); return; }
      if (!e.yearMonth) { alert('请填年月'); return; }
      if (!e.amount || e.amount <= 0) { alert('请填金额'); return; }
      // 委托外部研发 × 80%
      if (e.category === 'outsource') {
        e.amount = e.amount * 0.8;
      }
      await saveExpense(Object.assign({}, e));
      self.htExpenses.editing = null;
      self.htExpenses.loaded = false;
    };

    var editBtn = function (exp) {
      self.htExpenses.editing = Object.assign({}, exp);
    };

    var delBtn = async function (id) {
      if (!confirm('删除此条费用记录?')) return;
      await deleteExpense(id);
      self.htExpenses.loaded = false;
    };

    // 过滤
    var filtered = self.htExpenses.list.filter(function (e) {
      if (self.htExpenses.filterProject !== 'all' && e.projectId !== parseInt(self.htExpenses.filterProject)) return false;
      if (self.htExpenses.filterYear !== 'all' && !e.yearMonth.startsWith(String(self.htExpenses.filterYear))) return false;
      return true;
    });

    var filteredTotal = filtered.reduce(function (s, e) { return s + (parseFloat(e.amount) || 0); }, 0);

    var form = self.htExpenses.editing ? h('div', { class: 'ht-form' }, [
      h('h4', null, self.htExpenses.editing.id ? '编辑费用' : '新增费用'),
      h('div', { class: 'ht-form-row' }, [
        h('label', null, '所属项目*'),
        h('select', { class: 'ht-input', value: self.htExpenses.editing.projectId, onChange: (e) => { self.htExpenses.editing.projectId = parseInt(e.target.value); } },
          self.htExpenses.projects.map(function (p) { return h('option', { value: p.id }, p.code + ' - ' + p.name); })
        )
      ]),
      h('div', { class: 'ht-form-row' }, [
        h('label', null, '年月*'),
        h('input', { class: 'ht-input', type: 'month', value: self.htExpenses.editing.yearMonth, onInput: (e) => { self.htExpenses.editing.yearMonth = e.target.value; } })
      ]),
      h('div', { class: 'ht-form-row' }, [
        h('label', null, '费用类别*'),
        h('select', { class: 'ht-input', value: self.htExpenses.editing.category, onChange: (e) => { self.htExpenses.editing.category = e.target.value; } },
          RD_CATEGORIES.map(function (c) { return h('option', { value: c.code }, c.name); })
        )
      ]),
      h('div', { class: 'ht-form-row' }, [
        h('label', null, '金额(元)*'),
        h('input', { class: 'ht-input', type: 'number', step: '0.01', value: self.htExpenses.editing.amount, onInput: (e) => { self.htExpenses.editing.amount = parseFloat(e.target.value) || 0; } })
      ]),
      self.htExpenses.editing.category === 'outsource' ? h('div', { class: 'ht-hint-line' }, '⚠️ 委托外部研发按 80% 计入研发费用(《工作指引》口径)') : null,
      h('div', { class: 'ht-form-row' }, [
        h('label', null, '境内发生'),
        h('select', { class: 'ht-input', value: self.htExpenses.editing.isDomestic ? 'yes' : 'no', onChange: (e) => { self.htExpenses.editing.isDomestic = e.target.value === 'yes'; } }, [
          h('option', { value: 'yes' }, '境内'),
          h('option', { value: 'no' }, '境外')
        ])
      ]),
      h('div', { class: 'ht-form-row' }, [
        h('label', null, '有发票/凭证'),
        h('select', { class: 'ht-input', value: self.htExpenses.editing.hasInvoice ? 'yes' : 'no', onChange: (e) => { self.htExpenses.editing.hasInvoice = e.target.value === 'yes'; } }, [
          h('option', { value: 'no' }, '无'),
          h('option', { value: 'yes' }, '有')
        ])
      ]),
      h('div', { class: 'ht-form-row' }, [
        h('label', null, '说明'),
        h('textarea', { class: 'ht-input', rows: 2, value: self.htExpenses.editing.note, onInput: (e) => { self.htExpenses.editing.note = e.target.value; } })
      ]),
      h('div', { class: 'ht-form-actions' }, [
        h('button', { class: 'btn btn-primary', onClick: save }, '💾 保存'),
        h('button', { class: 'btn-ghost', onClick: () => { self.htExpenses.editing = null; } }, '取消')
      ])
    ]) : null;

    var tableRows = filtered.slice(0, 100).map(function (e) {
      var cat = RD_CATEGORIES.find(c => c.code === e.category);
      return h('tr', null, [
        h('td', null, e.yearMonth),
        h('td', null, e._projectCode + ' - ' + e._projectName),
        h('td', null, cat ? cat.name : e.category),
        h('td', null, '¥ ' + (parseFloat(e.amount) || 0).toLocaleString()),
        h('td', null, e.isDomestic ? '境内' : '境外'),
        h('td', null, e.hasInvoice ? '✓' : '-'),
        h('td', null, e.note || '-'),
        h('td', null, [
          h('button', { class: 'btn-mini', onClick: () => editBtn(e) }, '编辑'),
          h('button', { class: 'btn-mini danger', onClick: () => delBtn(e.id) }, '删除')
        ])
      ]);
    });

    var filterBar = h('div', { class: 'ht-filter-bar' }, [
      h('select', { class: 'ht-input', value: self.htExpenses.filterProject, onChange: (e) => { self.htExpenses.filterProject = e.target.value; } }, [
        h('option', { value: 'all' }, '全部项目'),
        self.htExpenses.projects.map(function (p) { return h('option', { value: p.id }, p.code + ' - ' + p.name); })
      ]),
      h('select', { class: 'ht-input', value: self.htExpenses.filterYear, onChange: (e) => { self.htExpenses.filterYear = e.target.value; } }, [
        h('option', { value: 'all' }, '全部年份'),
        [0, 1, 2].map(function (i) { var y = new Date().getFullYear() - i; return h('option', { value: y }, y + ' 年'); })
      ]),
      h('span', { class: 'ht-hint-inline' }, '当前显示 ' + filtered.length + ' 条 / 合计 ¥ ' + filteredTotal.toLocaleString())
    ]);

    var table = filtered.length === 0
      ? h('div', { class: 'ht-empty' }, '暂无费用记录,点击"➕ 新增费用"录入')
      : h('div', null, [
          h('div', { style: 'overflow-x:auto' }, [
            h('table', { class: 'ht-table' }, [
              h('thead', null, [
                h('tr', null, [
                  h('th', null, '年月'),
                  h('th', null, '项目'),
                  h('th', null, '类别'),
                  h('th', null, '金额'),
                  h('th', null, '境内/境外'),
                  h('th', null, '凭证'),
                  h('th', null, '说明'),
                  h('th', null, '操作')
                ])
              ]),
              h('tbody', null, tableRows)
            ])
          ]),
          filtered.length > 100 ? h('div', { class: 'ht-hint-line' }, '仅显示前 100 条,完整数据请通过"导出"获取') : null
        ]);

    return card('研发费用辅助账', h('div', null, [
      h('div', { class: 'ht-toolbar' }, [
        h('span', { class: 'ht-hint-inline' }, '按 7 大类别按月按项目归集,符合《工作指引》附件 2'),
        h('button', { class: 'btn btn-primary', onClick: newExp }, '➕ 新增费用')
      ]),
      filterBar,
      form,
      table
    ]), { icon: '💰' });
  }

  // ============ 子页面: 人员 ============
  function renderStaff(self, h, card) {
    if (!self.htStaff.list) { self.htStaff.list = []; self.htStaff.loading = false; self.htStaff.loaded = false; self.htStaff.editing = null; self.htStaff.hours = []; self.htStaff.hoursLoaded = false; }

    var load = async function () {
      try {
        self.htStaff.loading = true;
        self.htStaff.list = await listStaff();
      } catch (e) {
        console.error('[render load]', e);
        if (window.__showError) window.__showError('htStaff', e);
        self.htStaff.list = [];
      } finally {
        self.htStaff.loading = false;
        self.htStaff.loaded = true;
      }
    };

    if (!self.htStaff.loaded) {
      self.htStaff.loaded = true;
      setTimeout(load, 0);
    }

    var newStaff = function () {
      self.htStaff.editing = {
        name: '',
        role: '',
        education: 'bachelor',
        isTech: true,
        isFullTime: true,
        joinedAt: new Date().toISOString().slice(0, 10),
        monthlySalary: 0
      };
    };

    var save = async function () {
      if (!self.htStaff.editing.name) { alert('姓名必填'); return; }
      await saveStaff(Object.assign({}, self.htStaff.editing));
      self.htStaff.editing = null;
      self.htStaff.loaded = false;
    };

    var delBtn = async function (id) {
      if (!confirm('删除该人员会同时删除其工时记录?')) return;
      await deleteStaff(id);
      self.htStaff.loaded = false;
    };

    var form = self.htStaff.editing ? h('div', { class: 'ht-form' }, [
      h('h4', null, self.htStaff.editing.id ? '编辑人员' : '新增人员'),
      h('div', { class: 'ht-form-row' }, [
        h('label', null, '姓名*'),
        h('input', { class: 'ht-input', value: self.htStaff.editing.name, onInput: (e) => { self.htStaff.editing.name = e.target.value; } })
      ]),
      h('div', { class: 'ht-form-row' }, [
        h('label', null, '岗位'),
        h('input', { class: 'ht-input', value: self.htStaff.editing.role, onInput: (e) => { self.htStaff.editing.role = e.target.value; }, placeholder: '研发工程师 / 算法工程师 / 技术总监' })
      ]),
      h('div', { class: 'ht-form-row' }, [
        h('label', null, '学历'),
        h('select', { class: 'ht-input', value: self.htStaff.editing.education, onChange: (e) => { self.htStaff.editing.education = e.target.value; } }, [
          h('option', { value: 'doctor' }, '博士'),
          h('option', { value: 'master' }, '硕士'),
          h('option', { value: 'bachelor' }, '本科'),
          h('option', { value: 'college' }, '大专'),
          h('option', { value: 'other' }, '其他')
        ])
      ]),
      h('div', { class: 'ht-form-row' }, [
        h('label', null, '科技人员'),
        h('select', { class: 'ht-input', value: self.htStaff.editing.isTech ? 'yes' : 'no', onChange: (e) => { self.htStaff.editing.isTech = e.target.value === 'yes'; } }, [
          h('option', { value: 'yes' }, '是(计入科技人员)'),
          h('option', { value: 'no' }, '否(非科技岗)')
        ])
      ]),
      h('div', { class: 'ht-form-row' }, [
        h('label', null, '是否全时'),
        h('select', { class: 'ht-input', value: self.htStaff.editing.isFullTime ? 'yes' : 'no', onChange: (e) => { self.htStaff.editing.isFullTime = e.target.value === 'yes'; } }, [
          h('option', { value: 'yes' }, '全时研发(100% 工时)'),
          h('option', { value: 'no' }, '兼职研发(按工时分摊)')
        ])
      ]),
      h('div', { class: 'ht-form-row' }, [
        h('label', null, '入职日期'),
        h('input', { class: 'ht-input', type: 'date', value: self.htStaff.editing.joinedAt, onInput: (e) => { self.htStaff.editing.joinedAt = e.target.value; } })
      ]),
      h('div', { class: 'ht-form-row' }, [
        h('label', null, '月薪(元,用于估算人工成本)'),
        h('input', { class: 'ht-input', type: 'number', value: self.htStaff.editing.monthlySalary, onInput: (e) => { self.htStaff.editing.monthlySalary = parseFloat(e.target.value) || 0; } })
      ]),
      h('div', { class: 'ht-form-actions' }, [
        h('button', { class: 'btn btn-primary', onClick: save }, '💾 保存'),
        h('button', { class: 'btn-ghost', onClick: () => { self.htStaff.editing = null; } }, '取消')
      ])
    ]) : null;

    var techCount = self.htStaff.list.filter(s => s.isTech).length;
    var totalCount = self.htStaff.list.length;
    var ratio = totalCount > 0 ? techCount / totalCount : 0;

    var summaryCard = h('div', { class: 'ht-summary-bar' }, [
      h('span', null, '职工总数: ' + totalCount + ' 人'),
      h('span', null, '科技人员: ' + techCount + ' 人'),
      h('span', { class: ratio >= 0.10 ? 'ht-ok-text' : 'ht-warn-text' },
        '占比: ' + (ratio * 100).toFixed(1) + '% ' + (ratio >= 0.10 ? '✓' : '⚠️ 不足 10%')
      )
    ]);

    var tableRows = self.htStaff.list.map(function (s) {
      return h('tr', null, [
        h('td', null, s.name),
        h('td', null, s.role || '-'),
        h('td', null, { doctor: '博士', master: '硕士', bachelor: '本科', college: '大专', other: '其他' }[s.education] || '-'),
        h('td', null, s.isTech ? '✓ 科技' : '-'),
        h('td', null, s.isFullTime ? '全时' : '兼职'),
        h('td', null, s.joinedAt || '-'),
        h('td', null, '¥ ' + (s.monthlySalary || 0).toLocaleString()),
        h('td', null, [
          h('button', { class: 'btn-mini danger', onClick: () => delBtn(s.id) }, '删除')
        ])
      ]);
    });

    var table = self.htStaff.list.length === 0
      ? h('div', { class: 'ht-empty' }, '暂无人员,点击"➕ 新增人员"录入')
      : h('table', { class: 'ht-table' }, [
          h('thead', null, [
            h('tr', null, [
              h('th', null, '姓名'),
              h('th', null, '岗位'),
              h('th', null, '学历'),
              h('th', null, '科技人员'),
              h('th', null, '工时'),
              h('th', null, '入职日期'),
              h('th', null, '月薪'),
              h('th', null, '操作')
            ])
          ]),
          h('tbody', null, tableRows)
        ]);

    return card('研发人员', h('div', null, [
      h('div', { class: 'ht-toolbar' }, [
        h('span', { class: 'ht-hint-inline' }, '科技人员占比需 ≥10%(《管理办法》第十一条)'),
        h('button', { class: 'btn btn-primary', onClick: newStaff }, '➕ 新增人员')
      ]),
      summaryCard,
      form,
      table
    ]), { icon: '👥', sub: '兼职研发人员需按工时记录分摊人工成本(《工作指引》)' });
  }

  // ============ 子页面: 高新收入 ============
  function renderIncome(self, h, card) {
    if (!self.htIncome.list) { self.htIncome.list = []; self.htIncome.loading = false; self.htIncome.loaded = false; self.htIncome.editing = null; self.htIncome.totalIncome = 0; }

    var load = async function () {
      try {
        self.htIncome.loading = true;
        self.htIncome.list = await listIncome();
      } catch (e) {
        console.error('[render load]', e);
        if (window.__showError) window.__showError('htIncome', e);
        self.htIncome.list = [];
      } finally {
        self.htIncome.loading = false;
        self.htIncome.loaded = true;
      }
    };

    if (!self.htIncome.loaded) {
      self.htIncome.loaded = true;
      setTimeout(load, 0);
    }

    var newInc = function () {
      var d = new Date();
      var ym = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      self.htIncome.editing = {
        yearMonth: ym,
        product: '',
        fieldCode: 'EI',
        amount: 0,
        hasContract: false,
        hasInvoice: false,
        note: ''
      };
    };

    var save = async function () {
      var i = self.htIncome.editing;
      if (!i.product) { alert('请填产品/服务名称'); return; }
      if (!i.amount || i.amount <= 0) { alert('请填金额'); return; }
      await saveIncome(Object.assign({}, i));
      self.htIncome.editing = null;
      self.htIncome.loaded = false;
    };

    var delBtn = async function (id) {
      if (!confirm('删除?')) return;
      await deleteIncome(id);
      self.htIncome.loaded = false;
    };

    var totalHt = self.htIncome.list.reduce(function (s, i) { return s + (parseFloat(i.amount) || 0); }, 0);
    var totalAll = parseFloat(self.htIncome.totalIncome) || 0;
    var ratio = totalAll > 0 ? totalHt / totalAll : 0;

    var summaryCard = h('div', { class: 'ht-summary-bar' }, [
      h('span', null, '高新收入合计: ¥ ' + totalHt.toLocaleString()),
      h('span', { style: 'margin-left:12px' }, [
        h('label', null, '总收入(元,用于算占比): '),
        h('input', {
          type: 'number',
          class: 'ht-input',
          style: 'width:140px;display:inline-block',
          value: self.htIncome.totalIncome || '',
          onInput: (e) => { self.htIncome.totalIncome = parseFloat(e.target.value) || 0; }
        })
      ]),
      h('span', { class: ratio >= 0.60 ? 'ht-ok-text' : 'ht-warn-text', style: 'margin-left:12px' },
        '占比: ' + (ratio * 100).toFixed(1) + '% ' + (ratio >= 0.60 ? '✓' : '⚠️ <60%')
      )
    ]);

    var form = self.htIncome.editing ? h('div', { class: 'ht-form' }, [
      h('h4', null, self.htIncome.editing.id ? '编辑高新收入' : '新增高新收入'),
      h('div', { class: 'ht-form-row' }, [
        h('label', null, '年月*'),
        h('input', { class: 'ht-input', type: 'month', value: self.htIncome.editing.yearMonth, onInput: (e) => { self.htIncome.editing.yearMonth = e.target.value; } })
      ]),
      h('div', { class: 'ht-form-row' }, [
        h('label', null, '产品/服务名称*'),
        h('input', { class: 'ht-input', value: self.htIncome.editing.product, onInput: (e) => { self.htIncome.editing.product = e.target.value; } })
      ]),
      h('div', { class: 'ht-form-row' }, [
        h('label', null, '技术领域'),
        h('select', { class: 'ht-input', value: self.htIncome.editing.fieldCode, onChange: (e) => { self.htIncome.editing.fieldCode = e.target.value; } },
          HT_FIELDS.map(function (f) { return h('option', { value: f.code }, f.name); })
        )
      ]),
      h('div', { class: 'ht-form-row' }, [
        h('label', null, '金额(元)*'),
        h('input', { class: 'ht-input', type: 'number', value: self.htIncome.editing.amount, onInput: (e) => { self.htIncome.editing.amount = parseFloat(e.target.value) || 0; } })
      ]),
      h('div', { class: 'ht-form-row' }, [
        h('label', null, '有合同'),
        h('select', { class: 'ht-input', value: self.htIncome.editing.hasContract ? 'yes' : 'no', onChange: (e) => { self.htIncome.editing.hasContract = e.target.value === 'yes'; } }, [
          h('option', { value: 'no' }, '无'),
          h('option', { value: 'yes' }, '有')
        ])
      ]),
      h('div', { class: 'ht-form-row' }, [
        h('label', null, '有发票'),
        h('select', { class: 'ht-input', value: self.htIncome.editing.hasInvoice ? 'yes' : 'no', onChange: (e) => { self.htIncome.editing.hasInvoice = e.target.value === 'yes'; } }, [
          h('option', { value: 'no' }, '无'),
          h('option', { value: 'yes' }, '有')
        ])
      ]),
      h('div', { class: 'ht-form-row' }, [
        h('label', null, '技术说明'),
        h('textarea', { class: 'ht-input', rows: 2, value: self.htIncome.editing.note, onInput: (e) => { self.htIncome.editing.note = e.target.value; } })
      ]),
      h('div', { class: 'ht-form-actions' }, [
        h('button', { class: 'btn btn-primary', onClick: save }, '💾 保存'),
        h('button', { class: 'btn-ghost', onClick: () => { self.htIncome.editing = null; } }, '取消')
      ])
    ]) : null;

    var tableRows = self.htIncome.list.map(function (i) {
      return h('tr', null, [
        h('td', null, i.yearMonth),
        h('td', null, i.product),
        h('td', null, (HT_FIELDS.find(f => f.code === i.fieldCode) || {}).name || '-'),
        h('td', null, '¥ ' + (parseFloat(i.amount) || 0).toLocaleString()),
        h('td', null, [i.hasContract ? '合同' : '', i.hasInvoice ? '发票' : ''].filter(Boolean).join('+') || '-'),
        h('td', null, [
          h('button', { class: 'btn-mini danger', onClick: () => delBtn(i.id) }, '删除')
        ])
      ]);
    });

    var table = self.htIncome.list.length === 0
      ? h('div', { class: 'ht-empty' }, '暂无高新收入,点击"➕ 新增"录入')
      : h('table', { class: 'ht-table' }, [
          h('thead', null, [
            h('tr', null, [
              h('th', null, '年月'),
              h('th', null, '产品/服务'),
              h('th', null, '技术领域'),
              h('th', null, '金额'),
              h('th', null, '凭证'),
              h('th', null, '操作')
            ])
          ]),
          h('tbody', null, tableRows)
        ]);

    return card('高新技术产品(服务)收入', h('div', null, [
      h('div', { class: 'ht-toolbar' }, [
        h('span', { class: 'ht-hint-inline' }, '高新收入占企业总收入 ≥60%(《管理办法》第十一条)'),
        h('button', { class: 'btn btn-primary', onClick: newInc }, '➕ 新增收入')
      ]),
      summaryCard,
      form,
      table
    ]), { icon: '💵', sub: '需与核心知识产权对应,合同 + 发票齐全' });
  }

  // ============ 子页面: 导出审计材料 ============
  function renderExport(self, h, card) {
    var exportYear = self.htExportYear || new Date().getFullYear();

    var exportAll = async function () {
      try {
        // 动态加载 SheetJS
        if (!window.XLSX) {
          await new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
            s.onload = resolve;
            s.onerror = reject;
            document.head.appendChild(s);
          });
        }
        var XLSX = window.XLSX;

        var structure = await rdStructureByYear(exportYear);
        var projects = await listProjects();
        var expenses = [];
        for (var p of projects) {
          var exps = await listExpenses({ projectId: p.id });
          exps.forEach(function (e) { e._project = p; expenses.push(e); });
        }
        var staff = await listStaff();
        var incomes = await listIncome();
        var techR = await techStaffRatio(exportYear);

        // ---- Sheet 1: 研发项目台账 ----
        var projectRows = projects.map(function (p) {
          return {
            '项目编号': p.code,
            '项目名称': p.name,
            '技术领域': (HT_FIELDS.find(f => f.code === p.fieldCode) || {}).name || '',
            '状态': p.status === 'planning' ? '计划中' : p.status === 'ongoing' ? '进行中' : '已结题',
            '开始日期': p.startDate || '',
            '结束日期': p.endDate || '',
            '负责人': p.leader || '',
            '预算(元)': p.budget || 0,
            '立项目的': p.purpose || '',
            '技术路线': p.techRoute || '',
            '预期成果': p.expectedResult || ''
          };
        });
        var wsProjects = XLSX.utils.json_to_sheet(projectRows.length ? projectRows : [{}]);
        wsProjects['!cols'] = [{ wch: 12 }, { wch: 24 }, { wch: 18 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 30 }, { wch: 30 }, { wch: 30 }];

        // ---- Sheet 2: 研发费用结构明细表(《工作指引》附件2 格式) ----
        var attachRows = [];
        attachRows.push({ '项目': '一、人员人工费用', '本期金额(元)': structure.categories.staff });
        attachRows.push({ '项目': '二、直接投入费用', '本期金额(元)': structure.categories.material });
        attachRows.push({ '项目': '三、折旧费用', '本期金额(元)': structure.categories.depreciation });
        attachRows.push({ '项目': '四、无形资产摊销', '本期金额(元)': structure.categories.amortization });
        attachRows.push({ '项目': '五、新产品设计费等', '本期金额(元)': structure.categories.design });
        attachRows.push({ '项目': '六、委托外部研究开发费用', '本期金额(元)': structure.categories.outsource });
        attachRows.push({ '项目': '七、其他相关费用', '本期金额(元)': structure.categories.other });
        attachRows.push({ '项目': '合计', '本期金额(元)': structure.total });
        attachRows.push({ '项目': '其中:境内研发费用', '本期金额(元)': '' });
        attachRows.push({ '项目': '其他费用占比(应≤20%)', '本期金额(元)': (structure.otherRatio * 100).toFixed(2) + '%' });
        var wsAttach = XLSX.utils.json_to_sheet(attachRows);
        wsAttach['!cols'] = [{ wch: 30 }, { wch: 18 }];

        // ---- Sheet 3: 费用明细 ----
        var detailRows = expenses.map(function (e) {
          var cat = RD_CATEGORIES.find(function (c) { return c.code === e.category; });
          return {
            '年月': e.yearMonth,
            '项目编号': e._project ? e._project.code : '',
            '项目名称': e._project ? e._project.name : '',
            '费用类别': cat ? cat.name : e.category,
            '金额(元)': parseFloat(e.amount) || 0,
            '境内/境外': e.isDomestic ? '境内' : '境外',
            '有凭证': e.hasInvoice ? '是' : '否',
            '说明': e.note || ''
          };
        });
        var wsDetail = XLSX.utils.json_to_sheet(detailRows.length ? detailRows : [{}]);
        wsDetail['!cols'] = [{ wch: 10 }, { wch: 12 }, { wch: 24 }, { wch: 18 }, { wch: 12 }, { wch: 10 }, { wch: 8 }, { wch: 30 }];

        // ---- Sheet 4: 研发人员 ----
        var staffRows = staff.map(function (s) {
          return {
            '姓名': s.name,
            '岗位': s.role || '',
            '学历': { doctor: '博士', master: '硕士', bachelor: '本科', college: '大专', other: '其他' }[s.education] || '',
            '科技人员': s.isTech ? '是' : '否',
            '工时类型': s.isFullTime ? '全时' : '兼职',
            '入职日期': s.joinedAt || '',
            '月薪(元)': s.monthlySalary || 0
          };
        });
        staffRows.push({ '姓名': '汇总', '岗位': '', '学历': '', '科技人员': '科技 ' + techR.tech + ' 人 / 总 ' + techR.total + ' 人', '工时类型': '占比 ' + (techR.ratio * 100).toFixed(1) + '%', '入职日期': '', '月薪(元)': '' });
        var wsStaff = XLSX.utils.json_to_sheet(staffRows);
        wsStaff['!cols'] = [{ wch: 10 }, { wch: 18 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 12 }];

        // ---- Sheet 5: 高新收入 ----
        var incomeRows = incomes.map(function (i) {
          return {
            '年月': i.yearMonth,
            '产品/服务': i.product,
            '技术领域': (HT_FIELDS.find(f => f.code === i.fieldCode) || {}).name || '',
            '金额(元)': parseFloat(i.amount) || 0,
            '合同': i.hasContract ? '有' : '无',
            '发票': i.hasInvoice ? '有' : '无',
            '说明': i.note || ''
          };
        });
        var wsIncome = XLSX.utils.json_to_sheet(incomeRows.length ? incomeRows : [{}]);
        wsIncome['!cols'] = [{ wch: 10 }, { wch: 24 }, { wch: 18 }, { wch: 12 }, { wch: 8 }, { wch: 8 }, { wch: 30 }];

        // ---- Sheet 6: 校验报告 ----
        var validRows = [
          { '校验项': '其他费用占比', '要求': '≤ 20%', '实际': (structure.otherRatio * 100).toFixed(2) + '%', '结果': structure.otherRatio <= 0.20 ? '✓ 通过' : '✗ 不通过' },
          { '校验项': '科技人员占比', '要求': '≥ 10%', '实际': (techR.ratio * 100).toFixed(1) + '%', '结果': techR.ratio >= 0.10 ? '✓ 通过' : '✗ 不通过' }
        ];
        var wsValid = XLSX.utils.json_to_sheet(validRows);
        wsValid['!cols'] = [{ wch: 20 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];

        var wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, wsAttach, '附件2_费用结构');
        XLSX.utils.book_append_sheet(wb, wsDetail, '辅助账明细');
        XLSX.utils.book_append_sheet(wb, wsProjects, '研发项目台账');
        XLSX.utils.book_append_sheet(wb, wsStaff, '研发人员');
        XLSX.utils.book_append_sheet(wb, wsIncome, '高新收入');
        XLSX.utils.book_append_sheet(wb, wsValid, '校验报告');

        var fname = '高新认定材料_' + exportYear + '_' + new Date().toISOString().slice(0, 10) + '.xlsx';
        XLSX.writeFile(wb, fname);
        alert('✓ 已导出 ' + fname + '\n\n包含 6 个 sheet:\n1. 附件2_费用结构(官方格式)\n2. 辅助账明细\n3. 研发项目台账\n4. 研发人员\n5. 高新收入\n6. 校验报告');
      } catch (e) {
        alert('导出失败: ' + (e.message || e));
        console.error(e);
      }
    };

    var importTripleCheck = async function () {
      var tax = prompt('请输入税务申报的研发费用加计扣除金额(元)');
      if (!tax) return;
      var special = prompt('请输入专项审计报告中的研发费用金额(元)');
      if (!special) return;
      var structure = await rdStructureByYear(exportYear);
      var check = checkTripleMatch([structure.total, parseFloat(tax), parseFloat(special)]);
      alert('三表校验结果:\n\n' + check.msg + '\n\n财务辅助账: ¥ ' + structure.total.toLocaleString() + '\n税务加计扣除: ¥ ' + parseFloat(tax).toLocaleString() + '\n专项审计: ¥ ' + parseFloat(special).toLocaleString() + '\n差异率: ' + (check.diffRate * 100).toFixed(2) + '%');
    };

    return card('导出审计材料', h('div', null, [
      h('div', { class: 'ht-row' }, [
        h('label', null, '导出年份'),
        h('input', { type: 'number', class: 'ht-input', value: exportYear, onInput: (e) => { self.htExportYear = parseInt(e.target.value) || new Date().getFullYear(); exportYear = self.htExportYear; } })
      ]),
      h('p', { class: 'sub' }, '导出 6 个 sheet 的 .xlsx 文件,符合《高新技术企业认定管理工作指引》(国科发火[2016]195号) 附件 2 格式'),
      h('ul', { class: 'ht-export-list' }, [
        h('li', null, '📄 附件2_费用结构 — 按官方 7 大费用类别 + 合计 + 境内研发费用 + 其他费用占比'),
        h('li', null, '📄 辅助账明细 — 每条费用记录(项目/年月/类别/金额/境内/凭证)'),
        h('li', null, '📄 研发项目台账 — 项目立项基础信息'),
        h('li', null, '📄 研发人员 — 含科技人员/全时兼职/学历/统计'),
        h('li', null, '📄 高新收入 — 产品/技术领域/凭证齐全度'),
        h('li', null, '📄 校验报告 — 自动校验结果(其他费用占比/科技人员占比)')
      ]),
      h('div', { class: 'ht-export-actions' }, [
        h('button', { class: 'btn btn-primary', onClick: exportAll }, '📥 导出完整 .xlsx(含 6 sheet)'),
        h('button', { class: 'btn', onClick: importTripleCheck }, '🧮 三表差异校验')
      ])
    ]), { icon: '📤' });
  }

  // ============ 暴露 ============
  window.HTLedger = {
    RD_CATEGORIES: RD_CATEGORIES,
    HT_FIELDS: HT_FIELDS,
    TECH_STAFF_RATIO_MIN: TECH_STAFF_RATIO_MIN,
    // CRUD
    listProjects: listProjects,
    getProject: getProject,
    saveProject: saveProject,
    deleteProject: deleteProject,
    listExpenses: listExpenses,
    saveExpense: saveExpense,
    deleteExpense: deleteExpense,
    listStaff: listStaff,
    saveStaff: saveStaff,
    deleteStaff: deleteStaff,
    listHours: listHours,
    saveHour: saveHour,
    deleteHour: deleteHour,
    listIncome: listIncome,
    saveIncome: saveIncome,
    deleteIncome: deleteIncome,
    // 计算
    rdStructureByYear: rdStructureByYear,
    techStaffRatio: techStaffRatio,
    hightechIncomeByYear: hightechIncomeByYear,
    checkTripleMatch: checkTripleMatch,
    // 渲染
    renderLedgerTab: renderLedgerTab
  };
})();