const view = document.querySelector("#aircon-view");
const userName = document.querySelector("#aircon-user-name");
const logoutButton = document.querySelector("#aircon-logout-button");
const reloadButton = document.querySelector("#aircon-reload-button");
const errorElement = document.querySelector("#aircon-error");
const summaryElement = document.querySelector("#aircon-summary");
const inventoryElement = document.querySelector("#aircon-inventory");
const modelsElement = document.querySelector("#aircon-models");

async function requestJson(path, options = {}) {
  const response = await fetch(path, {
    credentials: "include",
    ...options,
    headers: {
      Accept: "application/json",
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.message ?? data?.error ?? "Request failed");
    error.status = response.status;
    throw error;
  }
  return data;
}

function createElement(name, className, text) {
  const element = document.createElement(name);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function renderSummary(data) {
  const items = [
    ["会社", data.companies.length],
    ["物件", data.properties.length],
    ["設備系統", data.systems.length],
    ["機器", data.units.length],
    ["型式", data.models.length],
  ];
  summaryElement.replaceChildren(...items.map(([label, count]) => {
    const card = createElement("article", "summary-card");
    card.append(
      createElement("span", "summary-label", label),
      createElement("strong", "summary-value", String(count)),
    );
    return card;
  }));
}

function renderInventory(data) {
  const propertiesByCompany = groupBy(data.properties, (property) => property.companyId);
  const systemsByProperty = groupBy(data.systems, (system) => system.propertyId);
  const unitsBySystem = groupBy(data.units, (unit) => unit.systemId);

  const companies = data.companies.map((company) => {
    const companyElement = createElement("article", "company-card");
    const companyHeader = createElement("div", "company-heading");
    companyHeader.append(
      createElement("h3", "", company.name),
      createElement(
        "span",
        "count-badge",
        `${propertiesByCompany.get(company.id)?.length ?? 0} 物件`,
      ),
    );
    companyElement.append(companyHeader);

    const propertyList = createElement("div", "property-list");
    for (const property of propertiesByCompany.get(company.id) ?? []) {
      const propertyElement = createElement("section", "property-card");
      const heading = createElement("div", "property-heading");
      const title = createElement("div");
      title.append(
        createElement("h4", "", property.name),
        createElement("p", "property-address", property.address ?? "住所未登録"),
      );
      heading.append(
        title,
        createElement(
          "span",
          "count-badge",
          `${systemsByProperty.get(property.id)?.length ?? 0} 系統`,
        ),
      );
      propertyElement.append(heading);

      const systemList = createElement("div", "system-list");
      for (const system of systemsByProperty.get(property.id) ?? []) {
        const systemElement = createElement("section", "system-card");
        systemElement.append(createElement("h5", "", system.name));
        const units = unitsBySystem.get(system.id) ?? [];
        if (units.length === 0) {
          systemElement.append(createElement("p", "empty-state", "機器は登録されていません。"));
        } else {
          const unitGrid = createElement("div", "unit-grid");
          for (const unit of units) {
            const unitElement = createElement("article", "unit-card");
            unitElement.append(
              createElement("span", "unit-type", formatUnitType(unit.unitType)),
              createElement("strong", "unit-name", unit.name),
              createElement(
                "span",
                "unit-model",
                unit.modelNumber === null
                  ? "型式未登録"
                  : `${unit.manufacturer ?? "メーカー未登録"} / ${unit.modelNumber}`,
              ),
            );
            unitGrid.append(unitElement);
          }
          systemElement.append(unitGrid);
        }
        systemList.append(systemElement);
      }
      if (systemList.childElementCount === 0) {
        systemList.append(createElement("p", "empty-state", "設備系統は登録されていません。"));
      }
      propertyElement.append(systemList);
      propertyList.append(propertyElement);
    }
    if (propertyList.childElementCount === 0) {
      propertyList.append(createElement("p", "empty-state", "物件は登録されていません。"));
    }
    companyElement.append(propertyList);
    return companyElement;
  });

  if (companies.length === 0) {
    inventoryElement.replaceChildren(
      createElement("p", "empty-state empty-state-large", "空調設備データはまだ登録されていません。"),
    );
    return;
  }
  inventoryElement.replaceChildren(...companies);
}

function groupBy(items, getKey) {
  const groups = new Map();
  for (const item of items) {
    const key = getKey(item);
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [item]);
    } else {
      group.push(item);
    }
  }
  return groups;
}

function renderModels(models) {
  if (models.length === 0) {
    const row = document.createElement("tr");
    const cell = createElement("td", "empty-table-cell", "型式は登録されていません。");
    cell.colSpan = 3;
    row.append(cell);
    modelsElement.replaceChildren(row);
    return;
  }

  modelsElement.replaceChildren(...models.map((model) => {
    const row = document.createElement("tr");
    row.append(
      createElement("td", "", model.manufacturer),
      createElement("td", "model-number", model.modelNumber),
      createElement("td", "", formatDate(model.updatedAt)),
    );
    return row;
  }));
}

function formatUnitType(value) {
  if (value === "indoor") return "室内機";
  if (value === "outdoor") return "室外機";
  return value;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ja-JP", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

async function loadAirconData() {
  reloadButton.disabled = true;
  errorElement.hidden = true;
  try {
    const data = await requestJson("/api/aircon");
    renderSummary(data);
    renderInventory(data);
    renderModels(data.models);
  } catch (error) {
    if (error.status === 401) {
      window.location.replace("/");
      return;
    }
    errorElement.textContent = "空調設備データを取得できませんでした。";
    errorElement.hidden = false;
  } finally {
    reloadButton.disabled = false;
  }
}

logoutButton.addEventListener("click", async () => {
  logoutButton.disabled = true;
  try {
    await requestJson("/api/auth/sign-out", { method: "POST" });
  } finally {
    window.location.replace("/");
  }
});

reloadButton.addEventListener("click", loadAirconData);

async function initialize() {
  try {
    const session = await requestJson("/api/auth/get-session");
    if (!session?.user) {
      window.location.replace("/");
      return;
    }
    userName.textContent = session.user.name || session.user.email;
    view.hidden = false;
    await loadAirconData();
  } catch {
    window.location.replace("/");
  }
}

initialize();
