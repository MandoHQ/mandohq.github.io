const maxDays = 30;
let maintenance = null;
let maintenanceHistory = [];

async function loadMaintenance() {
  try {
    const response = await fetch("maintenance.json", { cache: "no-store" });
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    if (!data) {
      return;
    }
    maintenanceHistory = data.history || [];
    renderMaintenanceHistory(maintenanceHistory);
    if (!data.active) {
      return;
    }
    maintenance = data;
    renderMaintenanceBanner(data);
  } catch (e) {
    // No maintenance file or invalid JSON: nothing to show.
  }
}

function formatMaintenanceTime(value) {
  return new Date(value).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function renderMaintenanceBanner(data) {
  const banner = document.getElementById("maintenance");
  banner.querySelector(".maintenanceTitle").innerText =
    data.title || "Maintenance in Progress";
  banner.querySelector(".maintenanceMessage").innerText = data.message || "";

  let timeText = "";
  if (data.started) {
    timeText += "Started: " + formatMaintenanceTime(data.started);
  }
  if (data.expectedEnd) {
    timeText +=
      (timeText ? "  \u00b7  " : "") +
      "Expected to end: " + formatMaintenanceTime(data.expectedEnd);
  }
  banner.querySelector(".maintenanceTime").innerText = timeText;
  banner.style.display = "block";
}

function formatDuration(start, end) {
  const minutes = Math.round((new Date(end) - new Date(start)) / 60000);
  if (!isFinite(minutes) || minutes < 0) {
    return "";
  }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return (h ? h + "h " : "") + m + "m";
}

function renderMaintenanceHistory(history) {
  if (!history.length) {
    return;
  }
  const list = document.getElementById("historyList");
  const sorted = history
    .slice()
    .sort((a, b) => new Date(b.started) - new Date(a.started));

  sorted.forEach((item) => {
    const entry = create("div", "historyItem");

    const header = create("div", "historyItemHeader");
    const title = create("span", "historyItemTitle");
    title.innerText = item.title || "Maintenance";
    header.appendChild(title);
    const badge = create("span", "success historyBadge");
    badge.innerText = "Resolved";
    header.appendChild(badge);
    entry.appendChild(header);

    const when = create("div", "historyItemTime");
    let whenText = "";
    if (item.started) {
      whenText += formatMaintenanceTime(item.started);
    }
    if (item.ended) {
      whenText += " \u2013 " + formatMaintenanceTime(item.ended);
      const duration = formatDuration(item.started, item.ended);
      if (duration) {
        whenText += "  \u00b7  " + duration;
      }
    }
    when.innerText = whenText;
    entry.appendChild(when);

    if (item.services && item.services.length) {
      const affected = create("div", "historyItemServices");
      const names = [...new Set(item.services.map(getServiceTitle))];
      affected.innerText = "Affected: " + names.join(", ");
      entry.appendChild(affected);
    }

    if (item.message) {
      const message = create("div", "historyItemMessage");
      message.innerText = item.message;
      entry.appendChild(message);
    }

    list.appendChild(entry);
  });

  document.getElementById("history").style.display = "block";
}

function getServiceTitle(key) {
  if (key.includes("_app")) {
    return "Application";
  } else if (key.includes("_website")) {
    return "Website";
  }
  return key;
}

function getMaintenanceForDay(key, date) {
  const dayStr = date.toDateString();
  for (const item of maintenanceHistory) {
    if (!item.started || !item.ended) {
      continue;
    }
    const services = item.services || [];
    if (services.length && !services.includes(key)) {
      continue;
    }
    let cursor = new Date(item.started);
    const end = new Date(item.ended);
    while (cursor <= end) {
      if (cursor.toDateString() == dayStr) {
        return item;
      }
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(0, 0, 0, 0);
    }
    if (end.toDateString() == dayStr) {
      return item;
    }
  }
  return null;
}

function isUnderMaintenance(key) {
  if (!maintenance) {
    return false;
  }
  const services = maintenance.services || [];
  return services.length == 0 || services.includes(key);
}

async function genReportLog(container, key, url) {
  const response = await fetch("logs/" + key + "_report.log");
  let statusLines = "";
  if (response.ok) {
    statusLines = await response.text();
  }

  const normalized = normalizeData(statusLines);
  const statusStream = constructStatusStream(key, url, normalized);
  container.appendChild(statusStream);
}

function constructStatusStream(key, url, uptimeData) {
  let streamContainer = templatize("statusStreamContainerTemplate");
  for (var ii = maxDays - 1; ii >= 0; ii--) {
    let line = constructStatusLine(key, ii, uptimeData[ii]);
    streamContainer.appendChild(line);
  }

  const lastSet = uptimeData[0];
  const underMaintenance = isUnderMaintenance(key);
  const color = underMaintenance ? "maintenance" : getColor(lastSet);

  const title = getServiceTitle(key);

  const container = templatize("statusContainerTemplate", {
    title: title,
    url: url,
    color: color,
    status: getStatusText(color),
    upTime: uptimeData.upTime,
  });

  container.appendChild(streamContainer);
  return container;
}

function constructStatusLine(key, relDay, upTimeArray) {
  let date = new Date();
  date.setDate(date.getDate() - relDay);

  return constructStatusSquare(key, date, upTimeArray);
}

function getColor(uptimeVal) {
  return uptimeVal == null
    ? "nodata"
    : uptimeVal == 1
      ? "success"
      : uptimeVal < 0.3
        ? "failure"
        : "partial";
}

function constructStatusSquare(key, date, uptimeVal) {
  const window = getMaintenanceForDay(key, date);
  const color = window ? "failure" : getColor(uptimeVal);
  let square = templatize("statusSquareTemplate", {
    color: color,
    tooltip: getTooltip(key, date, color),
  });

  const show = () => {
    showTooltip(square, key, date, color, window);
  };
  square.addEventListener("mouseover", show);
  square.addEventListener("mousedown", show);
  square.addEventListener("mouseout", hideTooltip);
  return square;
}

let cloneId = 0;
function templatize(templateId, parameters) {
  let clone = document.getElementById(templateId).cloneNode(true);
  clone.id = "template_clone_" + cloneId++;
  if (!parameters) {
    return clone;
  }

  applyTemplateSubstitutions(clone, parameters);
  return clone;
}

function applyTemplateSubstitutions(node, parameters) {
  const attributes = node.getAttributeNames();
  for (var ii = 0; ii < attributes.length; ii++) {
    const attr = attributes[ii];
    const attrVal = node.getAttribute(attr);
    node.setAttribute(attr, templatizeString(attrVal, parameters));
  }

  if (node.childElementCount == 0) {
    node.innerText = templatizeString(node.innerText, parameters);
  } else {
    const children = Array.from(node.children);
    children.forEach((n) => {
      applyTemplateSubstitutions(n, parameters);
    });
  }
}

function templatizeString(text, parameters) {
  if (parameters) {
    for (const [key, val] of Object.entries(parameters)) {
      text = text.replaceAll("$" + key, val);
    }
  }
  return text;
}

function getStatusText(color) {
  return color == "nodata"
    ? "No Data Available"
    : color == "success"
      ? "Fully Operational"
      : color == "failure"
        ? "Major Outage"
        : color == "partial"
          ? "Partial Outage"
          : color == "maintenance"
            ? "Under Maintenance"
            : "Unknown";
}

function getStatusDescriptiveText(color) {
  return color == "nodata"
    ? "No Data Available: Health check was not performed."
    : color == "success"
      ? "No downtime recorded on this day."
      : color == "failure"
        ? "Major outages recorded on this day."
        : color == "partial"
          ? "Partial outages recorded on this day."
          : "Unknown";
}

function getTooltip(key, date, quartile, color) {
  let statusText = getStatusText(color);
  return `${key} | ${date.toDateString()} : ${quartile} : ${statusText}`;
}

function create(tag, className) {
  let element = document.createElement(tag);
  element.className = className;
  return element;
}

function normalizeData(statusLines) {
  const rows = statusLines.split("\n");
  const dateNormalized = splitRowsByDate(rows);

  let relativeDateMap = {};
  const now = Date.now();
  for (const [key, val] of Object.entries(dateNormalized)) {
    if (key == "upTime") {
      continue;
    }

    const relDays = getRelativeDays(now, new Date(key).getTime());
    relativeDateMap[relDays] = getDayAverage(val);
  }

  relativeDateMap.upTime = dateNormalized.upTime;
  return relativeDateMap;
}

function getDayAverage(val) {
  if (!val || val.length == 0) {
    return null;
  } else {
    return val.reduce((a, v) => a + v) / val.length;
  }
}

function getRelativeDays(date1, date2) {
  return Math.floor(Math.abs((date1 - date2) / (24 * 3600 * 1000)));
}

function splitRowsByDate(rows) {
  let dateValues = {};
  let sum = 0,
    count = 0;
  for (var ii = 0; ii < rows.length; ii++) {
    const row = rows[ii];
    if (!row) {
      continue;
    }

    const [dateTimeStr, resultStr] = row.split(",", 2);
    const dateTime = new Date(Date.parse(dateTimeStr.replace(/-/g, "/") + " GMT"));
    const dateStr = dateTime.toDateString();

    let resultArray = dateValues[dateStr];
    if (!resultArray) {
      resultArray = [];
      dateValues[dateStr] = resultArray;
      if (dateValues.length > maxDays) {
        break;
      }
    }

    let result = 0;
    if (resultStr.trim() == "success") {
      result = 1;
    }
    sum += result;
    count++;

    resultArray.push(result);
  }

  const upTime = count ? ((sum / count) * 100).toFixed(2) + "%" : "--%";
  dateValues.upTime = upTime;
  return dateValues;
}

let tooltipTimeout = null;
function showTooltip(element, key, date, color, window) {
  clearTimeout(tooltipTimeout);
  const toolTipDiv = document.getElementById("tooltip");

  document.getElementById("tooltipDateTime").innerText = date.toDateString();
  document.getElementById("tooltipDescription").innerText = window
    ? (window.title || "Maintenance") +
      ": " +
      formatMaintenanceTime(window.started) +
      " \u2013 " +
      formatMaintenanceTime(window.ended)
    : getStatusDescriptiveText(color);

  const statusDiv = document.getElementById("tooltipStatus");
  statusDiv.innerText = window ? "Maintenance" : getStatusText(color);
  statusDiv.className = color;

  toolTipDiv.style.top = element.offsetTop + element.offsetHeight + 10;
  toolTipDiv.style.left =
    element.offsetLeft + element.offsetWidth / 2 - toolTipDiv.offsetWidth / 2;
  toolTipDiv.style.opacity = "1";
}

function hideTooltip() {
  tooltipTimeout = setTimeout(() => {
    const toolTipDiv = document.getElementById("tooltip");
    toolTipDiv.style.opacity = "0";
  }, 1000);
}

async function genAllReports() {
  await loadMaintenance();
  const response = await fetch("urls.cfg");
  const configText = await response.text();
  const configLines = configText.split("\n");
  for (let ii = 0; ii < configLines.length; ii++) {
    const configLine = configLines[ii];
    const [key, url] = configLine.split("=");

    const hostname = window.location.hostname;
    const domain = hostname.split('.').slice(-2).join('.');

    if (!key || !url || !url.includes(domain)) {
      continue;
    }

    await genReportLog(document.getElementById("reports"), key, url);
  }
}
