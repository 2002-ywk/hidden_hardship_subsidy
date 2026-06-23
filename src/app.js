import {
  LABELS,
  buildAnalysis,
  calculateSubsidyAmount,
  compareCandidateHardship,
  combinedAverage,
  confirmationKey,
  getCandidateLabel,
  rankFinalSubsidyStudents,
  roundMoney
} from "./domain.js";
import { appConfig, availableMonths, counselors, students, transactions } from "./sampleData.js";

const STORAGE_KEY = "undergraduate-hidden-subsidy-state-v1";

const views = [
  {
    id: "dashboard",
    label: "首页概览",
    title: "首页概览",
    description: "查看系统总体筛选结果、补助规则和处理进度。"
  },
  {
    id: "students",
    label: "学生管理",
    title: "学生管理",
    description: "统一查看候选学生、标签状态和学生基础信息。"
  },
  {
    id: "transactions",
    label: "消费明细",
    title: "消费明细",
    description: "查看学生月度消费次数、消费金额和分位区间。"
  },
  {
    id: "reviews",
    label: "审核管理",
    title: "审核管理",
    description: "处理辅导员确认、学院督查和学生处最终确认。"
  },
  {
    id: "subsidy",
    label: "补贴管理",
    title: "补贴管理",
    description: "查看最终补助名单、补助金额和导出发放表。"
  },
  {
    id: "settings",
    label: "系统设置",
    title: "系统设置",
    description: "查看当前规则配置、数据来源和待确认业务口径。"
  }
];

const state = loadState();

const elements = {
  monthSelect: document.querySelector("#monthSelect"),
  viewTabs: document.querySelector("#viewTabs"),
  summaryGrid: document.querySelector("#summaryGrid"),
  mainPanel: document.querySelector("#mainPanel"),
  pageTitle: document.querySelector("#pageTitle"),
  pageDescription: document.querySelector("#pageDescription"),
  resetStateButton: document.querySelector("#resetStateButton")
};

render();
bindGlobalEvents();

function loadState() {
  const fallback = {
    selectedMonth: availableMonths.at(-1),
    view: "dashboard",
    counselorId: counselors[0].id,
    college: counselors[0].college,
    reviewTab: "counselor",
    tagFilter: "全部",
    keyword: "",
    confirmations: {}
  };

  try {
    return { ...fallback, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") };
  } catch {
    return fallback;
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function getConfig() {
  return {
    ...appConfig,
    month: state.selectedMonth,
    confirmations: state.confirmations
  };
}

function getAnalysis() {
  return buildAnalysis(students, transactions, state.selectedMonth, getConfig());
}

function getPreviousMonth(month) {
  const index = availableMonths.indexOf(month);
  if (index <= 0) return null;
  return availableMonths[index - 1];
}

function getAnalysisByMonth(month) {
  if (!month) return null;
  return buildAnalysis(students, transactions, month, {
    ...appConfig,
    month,
    confirmations: state.confirmations
  });
}

function getDashboardMetrics(analysis) {
  const previousMonth = getPreviousMonth(state.selectedMonth);
  const previousAnalysis = getAnalysisByMonth(previousMonth);
  const currentGrantRows = getFinalGrantRows(analysis);
  const previousGrantRows = previousAnalysis ? getFinalGrantRows(previousAnalysis) : [];

  const current = {
    activeStudents: analysis.totalActiveUndergraduates,
    subsidizedStudents: analysis.finalCandidates.length,
    subsidyStudentExpense: sumRows(currentGrantRows, (row) => row.totalAmount),
    subsidyAmount: sumRows(currentGrantRows, (row) => row.subsidy.totalSubsidy),
    candidateStudents: analysis.candidates.length,
    pendingReviews: (getLabelCounts(analysis)[LABELS.pending] || 0) + (getLabelCounts(analysis)[LABELS.overdue] || 0)
  };

  const previous = previousAnalysis
    ? {
        activeStudents: previousAnalysis.totalActiveUndergraduates,
        subsidizedStudents: previousAnalysis.finalCandidates.length,
        subsidyStudentExpense: sumRows(previousGrantRows, (row) => row.totalAmount),
        subsidyAmount: sumRows(previousGrantRows, (row) => row.subsidy.totalSubsidy),
        candidateStudents: previousAnalysis.candidates.length,
        pendingReviews:
          (getLabelCounts(previousAnalysis)[LABELS.pending] || 0) + (getLabelCounts(previousAnalysis)[LABELS.overdue] || 0)
      }
    : null;

  return {
    current,
    previous,
    previousMonth
  };
}

function bindGlobalEvents() {
  elements.monthSelect.addEventListener("change", (event) => {
    state.selectedMonth = event.target.value;
    saveState();
    render();
  });

  elements.viewTabs.addEventListener("click", (event) => {
    const button = event.target.closest("[data-view]");
    if (!button) return;
    state.view = button.dataset.view;
    saveState();
    render();
  });

  elements.resetStateButton.addEventListener("click", () => {
    state.confirmations = {};
    saveState();
    render();
  });

  elements.mainPanel.addEventListener("change", (event) => {
    if (event.target.matches("[data-control='counselor']")) {
      state.counselorId = event.target.value;
      saveState();
      renderMainPanel(getAnalysis());
    }

    if (event.target.matches("[data-control='college']")) {
      state.college = event.target.value;
      saveState();
      renderMainPanel(getAnalysis());
    }

    if (event.target.matches("[data-control='tag']")) {
      state.tagFilter = event.target.value;
      saveState();
      renderMainPanel(getAnalysis());
    }
  });

  elements.mainPanel.addEventListener("input", (event) => {
    if (event.target.matches("[data-control='keyword']")) {
      state.keyword = event.target.value;
      saveState();
      renderMainPanel(getAnalysis());
    }
  });

  elements.mainPanel.addEventListener("click", (event) => {
    const menu = event.target.closest("[data-review-tab]");
    if (menu) {
      state.reviewTab = menu.dataset.reviewTab;
      saveState();
      renderMainPanel(getAnalysis());
      return;
    }

    const decisionButton = event.target.closest("[data-decision]");
    if (decisionButton) {
      const { studentId, decision } = decisionButton.dataset;
      const key = confirmationKey(state.selectedMonth, studentId);
      const remarkInput = elements.mainPanel.querySelector(`[data-remark='${key}']`);
      state.confirmations[key] = {
        decision,
        remark: remarkInput?.value?.trim() || "",
        confirmedAt: appConfig.currentDate,
        counselorId: state.counselorId
      };
      saveState();
      render();
      return;
    }

    const exportButton = event.target.closest("[data-action='export-csv']");
    if (exportButton) exportGrantCsv();
  });
}

function render() {
  const analysis = getAnalysis();
  renderMonthOptions();
  renderTabs();
  renderPageHeader();
  renderSummary(analysis);
  renderMainPanel(analysis);
}

function renderMonthOptions() {
  elements.monthSelect.innerHTML = availableMonths
    .map(
      (month) => `<option value="${month}" ${month === state.selectedMonth ? "selected" : ""}>${month}</option>`
    )
    .join("");
}

function renderTabs() {
  elements.viewTabs.innerHTML = views
    .map(
      (view) => `
        <button class="view-tab ${state.view === view.id ? "is-active" : ""}" data-view="${view.id}" type="button">
          ${view.label}
        </button>
      `
    )
    .join("");
}

function renderPageHeader() {
  const currentView = views.find((view) => view.id === state.view) || views[0];
  elements.pageTitle.textContent = currentView.title;
  elements.pageDescription.textContent = currentView.description;
}

function renderSummary(analysis) {
  elements.summaryGrid.classList.toggle("is-dashboard", state.view === "dashboard");
  if (state.view === "dashboard") {
    renderDashboardSummary(analysis);
    return;
  }

  const labelCounts = getLabelCounts(analysis);
  const subsidyTotal = analysis.finalCandidates.reduce((sum, candidate) => {
    return sum + calculateSubsidyAmount(candidate, analysis.thresholds, appConfig).totalSubsidy;
  }, 0);

  elements.summaryGrid.innerHTML = `
    ${summaryCard("全校本科生", `${analysis.totalActiveUndergraduates} 人`, "在籍在校本科生统计口径")}
    ${summaryCard("当月候选", `${analysis.candidates.length} 人`, "特别困难补助筛查结果")}
    ${summaryCard("辅导员待处理", `${(labelCounts[LABELS.pending] || 0) + (labelCounts[LABELS.overdue] || 0)} 人`, "待确认和逾期未确认总人数")}
    ${summaryCard("最终资助", `${analysis.finalCandidates.length} 人`, "按已确认需补助名单取前 1.5%")}
    ${summaryCard("早餐补助标准", money(analysis.thresholds.breakfastP25), "全校早餐单次均值 25% 分位")}
    ${summaryCard("预计发放", money(subsidyTotal), "确认补助名单的当月补助合计")}
  `;
}

function summaryCard(title, value, note) {
  return `
    <article class="summary-card">
      <span>${title}</span>
      <strong>${value}</strong>
      <small>${note}</small>
    </article>
  `;
}

function renderDashboardSummary(analysis) {
  const metrics = getDashboardMetrics(analysis);
  elements.summaryGrid.innerHTML = `
    ${dashboardMetricCard("在校学生人数", `${metrics.current.activeStudents} 人`, metrics.current.activeStudents - (metrics.previous?.activeStudents || 0), metrics.previousMonth)}
    ${dashboardMetricCard("补贴学生人数", `${metrics.current.subsidizedStudents} 人`, metrics.current.subsidizedStudents - (metrics.previous?.subsidizedStudents || 0), metrics.previousMonth)}
    ${dashboardMetricCard("补贴学生消费总额", money(metrics.current.subsidyStudentExpense), metrics.current.subsidyStudentExpense - (metrics.previous?.subsidyStudentExpense || 0), metrics.previousMonth, true)}
    ${dashboardMetricCard("补贴金额总额", money(metrics.current.subsidyAmount), metrics.current.subsidyAmount - (metrics.previous?.subsidyAmount || 0), metrics.previousMonth, true)}
  `;
}

function dashboardMetricCard(title, value, diffValue, previousMonth, isMoney = false) {
  const trend = getTrendMeta(diffValue, previousMonth, isMoney);
  return `
    <article class="summary-card dashboard-card">
      <span>${title}</span>
      <strong>${value}</strong>
      <small class="trend-note ${trend.className}">${trend.text}</small>
    </article>
  `;
}

function renderMainPanel(analysis) {
  if (state.view === "dashboard") renderDashboard(analysis);
  if (state.view === "students") renderStudents(analysis);
  if (state.view === "transactions") renderTransactions(analysis);
  if (state.view === "reviews") renderReviews(analysis);
  if (state.view === "subsidy") renderSubsidy(analysis);
  if (state.view === "settings") renderSettings(analysis);
}

function renderDashboard(analysis) {
  const rows = getDecoratedCandidates(analysis).slice(0, 8);
  const metrics = getDashboardMetrics(analysis);
  const trendRows = buildDashboardTrendRows(metrics);
  const collegeRows = buildCollegeDashboardRows(analysis);

  elements.mainPanel.innerHTML = `
    <div class="dashboard-grid">
      <article class="panel-card">
        <h3>月度指标看板</h3>
        <div class="metric-list">
          ${trendRows
            .map(
              (item) => `
                <div>
                  <span>${item.label}</span>
                  <div class="metric-inline">
                    <strong>${item.current}</strong>
                    <em class="trend-badge ${item.trendClass}">${item.trendText}</em>
                  </div>
                </div>
              `
            )
            .join("")}
        </div>
      </article>
      <article class="panel-card">
        <h3>补贴规则概览</h3>
        <div class="rule-list">
          <div>特别困难：登记特别困难、早餐和午晚餐单次平均消费不高于 25% 分位、消费天数超过半月。</div>
          <div>最终资助：从辅导员确认“需要补助”的名单中自动取前 1.5%，月度补助金额封顶 500 元。</div>
        </div>
      </article>
      <article class="panel-card">
        <h3>分位数统计口径</h3>
        <div class="metric-list">
          <div><span>早餐 25% 分位</span><strong>${money(analysis.thresholds.breakfastP25)}</strong></div>
          <div><span>午晚餐 25% 分位</span><strong>${money(analysis.thresholds.lunchDinnerP25)}</strong></div>
          <div><span>早餐 50% 基准</span><strong>${money(analysis.thresholds.breakfastP50)}</strong></div>
          <div><span>午晚餐 50% 基准</span><strong>${money(analysis.thresholds.lunchDinnerP50)}</strong></div>
        </div>
      </article>
      <article class="panel-card">
        <h3>学院分布</h3>
        <div class="college-rank">
          ${collegeRows
            .map(
              (item) => `
                <div class="college-rank__item">
                  <div>
                    <strong>${escapeHtml(item.college)}</strong>
                    <span>${item.candidateCount} 名候选，${item.finalCount} 名补贴</span>
                  </div>
                  <b>${money(item.subsidyAmount)}</b>
                </div>
              `
            )
            .join("")}
        </div>
      </article>
    </div>
    <div class="panel-section">
      <div class="panel-header">
        <div>
          <h2>最新候选学生</h2>
          <p>展示当前月份前 8 名候选学生，便于首页快速查看。</p>
        </div>
      </div>
      ${renderCandidateTable(rows, { showActions: false })}
    </div>
  `;
}

function renderStudents(analysis) {
  const rows = applyCommonFilters(getDecoratedCandidates(analysis));

  elements.mainPanel.innerHTML = `
    ${panelHeader("学生管理", "按标签、班级、学号或姓名查看当前候选学生和状态。")}
    ${renderFilters()}
    ${renderCandidateTable(rows, { showActions: false })}
  `;
}

function renderTransactions(analysis) {
  const rows = applyKeywordFilter(analysis.stats);

  elements.mainPanel.innerHTML = `
    ${panelHeader("消费明细", "查看学生月度消费统计结果，包括早餐、午晚餐和消费总额。")}
    <div class="threshold-grid">
      ${thresholdCard("早餐", analysis.thresholds.breakfastSchoolAverage, analysis.thresholds.breakfastP10, analysis.thresholds.breakfastP25, analysis.thresholds.breakfastP50)}
      ${thresholdCard("午晚餐", analysis.thresholds.lunchDinnerSchoolAverage, analysis.thresholds.lunchDinnerP10, analysis.thresholds.lunchDinnerP25, analysis.thresholds.lunchDinnerP50)}
    </div>
    <div class="toolbar">
      <label>班级 / 学号 / 姓名
        <input data-control="keyword" value="${escapeHtml(state.keyword)}" placeholder="输入关键字筛选" />
      </label>
    </div>
    ${renderTransactionTable(rows)}
  `;
}

function renderReviews(analysis) {
  const tabs = [
    { id: "counselor", label: "辅导员确认" },
    { id: "college", label: "学院督查" },
    { id: "final", label: "最终确认" }
  ];

  elements.mainPanel.innerHTML = `
    ${panelHeader("审核管理", "统一处理辅导员确认、学院督查和学生处最终确认。")}
    <div class="sub-tabs">
      ${tabs
        .map(
          (tab) => `
            <button class="sub-tab ${state.reviewTab === tab.id ? "is-active" : ""}" data-review-tab="${tab.id}" type="button">
              ${tab.label}
            </button>
          `
        )
        .join("")}
    </div>
    ${renderReviewContent(analysis)}
  `;
}

function renderSubsidy(analysis) {
  const rows = getDecoratedCandidates(analysis)
    .filter((row) => analysis.finalStudentIds.has(row.student.id))
    .map((row) => ({
      ...row,
      subsidy: calculateSubsidyAmount(row, analysis.thresholds, appConfig)
    }));
  const filteredRows = applyKeywordFilter(rows);

  elements.mainPanel.innerHTML = `
    ${panelHeader("补贴管理", "集中展示确认补助学生的消费和金额，支持筛选与导出。")}
    <div class="toolbar">
      <label>班级 / 学号 / 姓名
        <input data-control="keyword" value="${escapeHtml(state.keyword)}" placeholder="输入关键字筛选" />
      </label>
      <button class="primary-button" data-action="export-csv" type="button">导出 CSV</button>
    </div>
    ${renderGrantTable(filteredRows)}
  `;
}

function renderSettings(analysis) {
  elements.mainPanel.innerHTML = `
    ${panelHeader("系统设置", "展示当前原型的业务参数、数据来源和待确认规则。")}
    <div class="settings-grid">
      <article class="panel-card">
        <h3>当前配置</h3>
        <div class="setting-list">
          <div><span>推送日期</span><strong>${appConfig.pushedAt}</strong></div>
          <div><span>当前日期</span><strong>${appConfig.currentDate}</strong></div>
          <div><span>确认时限</span><strong>${appConfig.confirmationLimitBusinessDays} 个工作日</strong></div>
          <div><span>最终资助比例</span><strong>${appConfig.finalSupportPercent}%</strong></div>
          <div><span>月度封顶</span><strong>${money(appConfig.monthlySubsidyCap)}</strong></div>
          <div><span>50% 基准口径</span><strong>${appConfig.subsidyMedianScope === "school" ? "全校学生" : "特别困难学生"}</strong></div>
        </div>
      </article>
      <article class="panel-card">
        <h3>数据来源</h3>
        <div class="rule-list">
          <div>学生和消费数据当前来自前端示例文件 src/sampleData.js。</div>
          <div>辅导员确认状态存储在浏览器本地 localStorage。</div>
          <div>正式系统建议接入学工系统、一卡通系统和后端数据库。</div>
        </div>
      </article>
      <article class="panel-card wide">
        <h3>本月统计提示</h3>
        <div class="setting-list">
          <div><span>特别困难候选</span><strong>${analysis.specialCandidates.length} 人</strong></div>
          <div><span>逾期未确认</span><strong>${getLabelCounts(analysis)[LABELS.overdue] || 0} 人</strong></div>
          <div><span>最终资助</span><strong>${analysis.finalCandidates.length} 人</strong></div>
        </div>
      </article>
    </div>
  `;
}

function renderReviewContent(analysis) {
  if (state.reviewTab === "counselor") return renderCounselorSection(analysis);
  if (state.reviewTab === "college") return renderCollegeSection(analysis);
  return renderFinalSection(analysis);
}

function renderCounselorSection(analysis) {
  const counselorOptions = counselors
    .map(
      (counselor) =>
        `<option value="${counselor.id}" ${state.counselorId === counselor.id ? "selected" : ""}>${counselor.name} · ${counselor.college}</option>`
    )
    .join("");
  const rows = getDecoratedCandidates(analysis).filter((row) => row.student.counselorId === state.counselorId);

  return `
    <div class="toolbar">
      <label>辅导员
        <select data-control="counselor">${counselorOptions}</select>
      </label>
      <span class="toolbar-note">只能选择“需要补助”或“不需要补助”，备注为自愿填写。</span>
    </div>
    ${renderCandidateTable(rows, { showActions: true })}
  `;
}

function renderCollegeSection(analysis) {
  const colleges = Array.from(new Set(students.map((student) => student.college)));
  const collegeOptions = colleges
    .map((college) => `<option value="${college}" ${state.college === college ? "selected" : ""}>${college}</option>`)
    .join("");
  const rows = getDecoratedCandidates(analysis).filter((row) => row.student.college === state.college);
  const classStats = summarizeByClass(rows);

  return `
    <div class="toolbar">
      <label>学院
        <select data-control="college">${collegeOptions}</select>
      </label>
    </div>
    <div class="class-progress-grid">
      ${classStats
        .map(
          (item) => `
            <article class="progress-card">
              <strong>${escapeHtml(item.className)}</strong>
              <span>${escapeHtml(item.counselorName)}</span>
              <div class="progress-line"><b>${item.confirmed}</b> 已确认 / <b>${item.total}</b> 总数</div>
              <div class="progress-line danger"><b>${item.overdue}</b> 逾期未确认</div>
            </article>
          `
        )
        .join("")}
    </div>
    ${renderCandidateTable(rows, { showActions: false })}
  `;
}

function renderFinalSection(analysis) {
  const rows = getDecoratedCandidates(analysis).filter((row) => row.confirmation?.decision === "need");
  const finalRows = rankFinalSubsidyStudents(
    analysis.candidates,
    state.confirmations,
    getConfig(),
    analysis.totalActiveUndergraduates
  );
  const finalIds = new Set(finalRows.map((row) => row.student.id));

  return `
    <div class="rule-strip">
      <span>取数人数：ceil(${analysis.totalActiveUndergraduates} × ${appConfig.finalSupportPercent}%) = ${Math.ceil(
        analysis.totalActiveUndergraduates * (appConfig.finalSupportPercent / 100)
      )} 人</span>
      <span>排序：综合单次消费低者优先，总消费低者优先，消费天数高者优先。</span>
    </div>
    ${renderFinalTable(rows, finalIds)}
  `;
}

function panelHeader(title, description) {
  return `
    <div class="panel-header">
      <div>
        <h2>${title}</h2>
        <p>${description}</p>
      </div>
    </div>
  `;
}

function renderFilters() {
  const labels = ["全部", LABELS.pending, LABELS.need, LABELS.noNeed, LABELS.overdue, LABELS.final];

  return `
    <div class="toolbar">
      <label>标签
        <select data-control="tag">
          ${labels
            .map((label) => `<option value="${label}" ${state.tagFilter === label ? "selected" : ""}>${label}</option>`)
            .join("")}
        </select>
      </label>
      <label>班级 / 学号 / 姓名
        <input data-control="keyword" value="${escapeHtml(state.keyword)}" placeholder="输入关键字筛选" />
      </label>
    </div>
  `;
}

function thresholdCard(title, schoolAverage, p10, p25, p50) {
  return `
    <article class="threshold-card">
      <strong>${title}</strong>
      <dl>
        <div><dt>全校均值</dt><dd>${money(schoolAverage)}</dd></div>
        <div><dt>10% 预警线</dt><dd>${money(p10)}</dd></div>
        <div><dt>25% 补助标准</dt><dd>${money(p25)}</dd></div>
        <div><dt>50% 金额基准</dt><dd>${money(p50)}</dd></div>
      </dl>
    </article>
  `;
}

function renderCandidateTable(rows, options) {
  if (rows.length === 0) return emptyState("当前条件下暂无学生记录。");

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>标签</th>
            <th>学生</th>
            <th>班级 / 辅导员</th>
            <th>筛选来源</th>
            <th>早餐</th>
            <th>午晚餐</th>
            <th>消费天数</th>
            <th>备注 / 操作</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => candidateRow(row, options)).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function candidateRow(row, options) {
  const key = confirmationKey(state.selectedMonth, row.student.id);
  const remark = row.confirmation?.remark || "";
  const actions = options.showActions
    ? `
        <div class="decision-box">
          <input data-remark="${key}" value="${escapeHtml(remark)}" placeholder="备注，如低消费原因" />
          <div>
            <button class="small-button good" data-decision="need" data-student-id="${row.student.id}" type="button">需要补助</button>
            <button class="small-button muted" data-decision="noNeed" data-student-id="${row.student.id}" type="button">不需要补助</button>
          </div>
        </div>
      `
    : escapeHtml(remark || row.reason);

  return `
    <tr>
      <td>${tag(row.label)}</td>
      <td><strong>${escapeHtml(row.student.name)}</strong><span>${row.student.id}</span></td>
      <td>${escapeHtml(row.student.className)}<span>${escapeHtml(row.student.counselorName)}</span></td>
      <td>${escapeHtml(row.candidateType)}<span>${escapeHtml(row.matchedMonths.join("、"))}</span></td>
      <td>${row.breakfastCount} 次<span>均 ${money(row.breakfastAverage)}</span></td>
      <td>${row.lunchDinnerCount} 次<span>均 ${money(row.lunchDinnerAverage)}</span></td>
      <td>${row.consumeDays} 天<span>总额 ${money(row.totalAmount)}</span></td>
      <td>${actions}</td>
    </tr>
  `;
}

function renderTransactionTable(rows) {
  if (rows.length === 0) return emptyState("当前条件下暂无消费统计记录。");

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>学号</th>
            <th>姓名</th>
            <th>班级</th>
            <th>早餐次数</th>
            <th>早餐平均消费</th>
            <th>午晚餐次数</th>
            <th>午晚餐平均消费</th>
            <th>消费天数</th>
            <th>消费总额</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `
                <tr>
                  <td>${row.student.id}</td>
                  <td><strong>${escapeHtml(row.student.name)}</strong></td>
                  <td>${escapeHtml(row.student.className)}</td>
                  <td>${row.breakfastCount}</td>
                  <td>${money(row.breakfastAverage)}</td>
                  <td>${row.lunchDinnerCount}</td>
                  <td>${money(row.lunchDinnerAverage)}</td>
                  <td>${row.consumeDays}</td>
                  <td>${money(row.totalAmount)}</td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderFinalTable(rows, finalIds) {
  if (rows.length === 0) return emptyState("暂无辅导员确认“需要补助”的学生。");

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>排名</th>
            <th>最终状态</th>
            <th>学生</th>
            <th>学院班级</th>
            <th>综合单次消费</th>
            <th>消费天数</th>
            <th>辅导员备注</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .slice()
            .sort((left, right) => combinedAverage(left) - combinedAverage(right))
            .map(
              (row, index) => `
                <tr>
                  <td>${index + 1}</td>
                  <td>${tag(finalIds.has(row.student.id) ? LABELS.final : LABELS.need)}</td>
                  <td><strong>${escapeHtml(row.student.name)}</strong><span>${row.student.id}</span></td>
                  <td>${escapeHtml(row.student.college)}<span>${escapeHtml(row.student.className)}</span></td>
                  <td>${money(combinedAverage(row))}</td>
                  <td>${row.consumeDays} 天</td>
                  <td>${escapeHtml(row.confirmation?.remark || "无")}</td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderGrantTable(rows) {
  if (rows.length === 0) return emptyState("暂无确认补助学生，或筛选条件下无记录。");

  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>学号</th>
            <th>姓名</th>
            <th>班级</th>
            <th>早餐次数</th>
            <th>早餐均额</th>
            <th>午晚餐次数</th>
            <th>午晚餐均额</th>
            <th>消费总额</th>
            <th>补助金额</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `
                <tr>
                  <td>${row.student.id}</td>
                  <td><strong>${escapeHtml(row.student.name)}</strong></td>
                  <td>${escapeHtml(row.student.className)}</td>
                  <td>${row.breakfastCount}</td>
                  <td>${money(row.breakfastAverage)}</td>
                  <td>${row.lunchDinnerCount}</td>
                  <td>${money(row.lunchDinnerAverage)}</td>
                  <td>${money(row.totalAmount)}</td>
                  <td><strong>${money(row.subsidy.totalSubsidy)}</strong><span>早 ${money(row.subsidy.breakfastSubsidy)} / 午晚 ${money(row.subsidy.lunchDinnerSubsidy)}</span></td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function getDecoratedCandidates(analysis) {
  return analysis.candidates.map((candidate) => {
    const key = confirmationKey(state.selectedMonth, candidate.student.id);
    const confirmation = state.confirmations[key];
    return {
      ...candidate,
      confirmation,
      label: getCandidateLabel(candidate, confirmation, analysis.finalStudentIds, getConfig())
    };
  });
}

function getLabelCounts(analysis) {
  return getDecoratedCandidates(analysis).reduce((counts, row) => {
    counts[row.label] = (counts[row.label] || 0) + 1;
    return counts;
  }, {});
}

function applyCommonFilters(rows) {
  return applyKeywordFilter(rows).filter((row) => state.tagFilter === "全部" || row.label === state.tagFilter);
}

function applyKeywordFilter(rows) {
  const keyword = state.keyword.trim().toLowerCase();
  if (!keyword) return rows;

  return rows.filter((row) => {
    const student = row.student || row;
    const text = `${student.id} ${student.name} ${student.className} ${student.college}`.toLowerCase();
    return text.includes(keyword);
  });
}

function summarizeByClass(rows) {
  const byClass = new Map();

  for (const row of rows) {
    const key = row.student.className;
    const existing = byClass.get(key) || {
      className: key,
      counselorName: row.student.counselorName,
      total: 0,
      confirmed: 0,
      overdue: 0
    };

    existing.total += 1;
    if (row.label === LABELS.need || row.label === LABELS.noNeed || row.label === LABELS.final) existing.confirmed += 1;
    if (row.label === LABELS.overdue) existing.overdue += 1;
    byClass.set(key, existing);
  }

  return Array.from(byClass.values());
}

function exportGrantCsv() {
  const analysis = getAnalysis();
  const rows = getDecoratedCandidates(analysis)
    .filter((row) => analysis.finalStudentIds.has(row.student.id))
    .map((row) => ({
      ...row,
      subsidy: calculateSubsidyAmount(row, analysis.thresholds, appConfig)
    }));
  const filteredRows = applyKeywordFilter(rows);
  const header = [
    "学号",
    "姓名",
    "班级",
    "早餐消费次数",
    "早餐平均消费金额",
    "午晚餐消费次数",
    "午晚餐平均消费金额",
    "消费总额",
    "补助金额"
  ];
  const body = filteredRows.map((row) => [
    row.student.id,
    row.student.name,
    row.student.className,
    row.breakfastCount,
    row.breakfastAverage,
    row.lunchDinnerCount,
    row.lunchDinnerAverage,
    row.totalAmount,
    row.subsidy.totalSubsidy
  ]);
  const csv = [header, ...body]
    .map((line) => line.map((cell) => `"${String(cell ?? "").replaceAll('"', '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `本科生隐形补助发放表-${state.selectedMonth}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function getFinalGrantRows(analysis) {
  return getDecoratedCandidates(analysis)
    .filter((row) => analysis.finalStudentIds.has(row.student.id))
    .map((row) => ({
      ...row,
      subsidy: calculateSubsidyAmount(row, analysis.thresholds, appConfig)
    }));
}

function buildDashboardTrendRows(metrics) {
  return [
    {
      label: "候选学生人数",
      current: `${metrics.current.candidateStudents} 人`,
      ...getTrendRowMeta(metrics.current.candidateStudents - (metrics.previous?.candidateStudents || 0), metrics.previousMonth)
    },
    {
      label: "待审核人数",
      current: `${metrics.current.pendingReviews} 人`,
      ...getTrendRowMeta(metrics.current.pendingReviews - (metrics.previous?.pendingReviews || 0), metrics.previousMonth)
    },
    {
      label: "补贴学生消费总额",
      current: money(metrics.current.subsidyStudentExpense),
      ...getTrendRowMeta(
        metrics.current.subsidyStudentExpense - (metrics.previous?.subsidyStudentExpense || 0),
        metrics.previousMonth,
        true
      )
    },
    {
      label: "补贴金额总额",
      current: money(metrics.current.subsidyAmount),
      ...getTrendRowMeta(metrics.current.subsidyAmount - (metrics.previous?.subsidyAmount || 0), metrics.previousMonth, true)
    }
  ];
}

function buildCollegeDashboardRows(analysis) {
  const finalStudentIds = analysis.finalStudentIds;
  const grantRows = getFinalGrantRows(analysis);
  const subsidyAmountByCollege = new Map();

  for (const row of grantRows) {
    subsidyAmountByCollege.set(
      row.student.college,
      roundMoney((subsidyAmountByCollege.get(row.student.college) || 0) + row.subsidy.totalSubsidy)
    );
  }

  return Array.from(
    getDecoratedCandidates(analysis).reduce((map, row) => {
      const key = row.student.college;
      const current = map.get(key) || {
        college: key,
        candidateCount: 0,
        finalCount: 0,
        subsidyAmount: 0
      };

      current.candidateCount += 1;
      if (finalStudentIds.has(row.student.id)) current.finalCount += 1;
      current.subsidyAmount = subsidyAmountByCollege.get(key) || 0;
      map.set(key, current);
      return map;
    }, new Map()).values()
  ).sort((left, right) => right.subsidyAmount - left.subsidyAmount || right.candidateCount - left.candidateCount);
}

function getTrendRowMeta(diffValue, previousMonth, isMoney = false) {
  const trend = getTrendMeta(diffValue, previousMonth, isMoney);
  return {
    trendClass: trend.className,
    trendText: trend.text
  };
}

function getTrendMeta(diffValue, previousMonth, isMoney = false) {
  if (!previousMonth) {
    return {
      className: "flat",
      text: "无上月数据"
    };
  }

  if (diffValue === 0) {
    return {
      className: "flat",
      text: `与 ${previousMonth} 持平`
    };
  }

  const formatted = isMoney ? money(Math.abs(diffValue)) : `${Math.abs(diffValue)} 人`;
  const direction = diffValue > 0 ? "较上月增加" : "较上月减少";
  return {
    className: diffValue > 0 ? "up" : "down",
    text: `${direction} ${formatted}`
  };
}

function sumRows(rows, getter) {
  return roundMoney(rows.reduce((sum, row) => sum + getter(row), 0));
}

function tag(label) {
  const className = {
    [LABELS.pending]: "tag pending",
    [LABELS.need]: "tag need",
    [LABELS.noNeed]: "tag no-need",
    [LABELS.overdue]: "tag overdue",
    [LABELS.final]: "tag final"
  }[label];

  return `<span class="${className || "tag"}">${label}</span>`;
}

function emptyState(message) {
  return `<div class="empty-state">${message}</div>`;
}

function money(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return `¥${roundMoney(value).toFixed(2)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
