import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  inMemoryPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithPopup,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getDoc,
  getFirestore,
  collection,
  doc,
  getDocs,
  setDoc,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { adminUid, firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// 管理者のログインを許可している間だけ true（再読み込みで管理者のログインは切れる）
let adminSessionAllowed = false;

const ID_PATTERN = /^[a-z0-9_]+$/;

const searchInput = document.getElementById("search");
const logoutButton = document.getElementById("logout");
const userLoginButton = document.getElementById("user-login");
const accentPicker = document.getElementById("accent-picker");
const rememberLabel = document.getElementById("remember-label");
const rememberCheckbox = document.getElementById("remember-device");

// このデバイスで管理者のログインを保存するかどうか
const REMEMBER_KEY = "rememberAdminDevice";
const isRememberedDevice = () => localStorage.getItem(REMEMBER_KEY) === "1";
const treeNav = document.getElementById("tree");
const folderMenu = document.getElementById("folder-menu");
const dangerPanel = document.getElementById("danger-confirm");
const dangerButton = document.getElementById("danger-button");
const dangerCancel = document.getElementById("danger-cancel");

let items = [];
let folderPaths = [];
let tree = { children: {}, items: [] };
let isAdmin = false;
const openPaths = new Set();

function buildTree(items, folderPaths) {
  const root = { children: {}, items: [] };
  // 空のフォルダーも含めてノードを作る
  for (const path of folderPaths) {
    let node = root;
    for (const category of path) {
      if (!node.children[category]) {
        node.children[category] = { children: {}, items: [] };
      }
      node = node.children[category];
    }
  }
  for (const item of items) {
    let node = root;
    for (const category of item.path) {
      if (!node.children[category]) {
        node.children[category] = { children: {}, items: [] };
      }
      node = node.children[category];
    }
    node.items.push(item);
  }
  return root;
}

function renderTree(node, container, parentPath = []) {
  for (const [name, child] of Object.entries(node.children)) {
    const path = [...parentPath, name];
    const key = path.join(">");

    const details = document.createElement("details");
    details.open = openPaths.has(key);
    details.addEventListener("toggle", () => {
      if (details.open) {
        openPaths.add(key);
      } else {
        openPaths.delete(key);
      }
    });

    const summary = document.createElement("summary");
    summary.textContent = name;
    summary.addEventListener("contextmenu", (event) => {
      if (!isAdmin) {
        return;
      }
      event.preventDefault();
      showContextMenu(event.clientX, event.clientY, folderActions(path));
    });
    details.append(summary);

    for (const item of child.items) {
      details.append(
        item.id === editingItemId ? createItemEditForm(item) : createItemButton(item, item.name_ja),
      );
    }
    renderTree(child, details, path);

    if (moveSource) {
      if (canMoveTo(path)) {
        details.append(createMoveEntry(path));
      }
    } else if (isAdmin) {
      details.append(
        createEntry("+ ここに新規作成", (onCancel) => createAddForm(path, onCancel)),
        createEntry("+ 一括新規作成", (onCancel) => createAddForm(path, onCancel, true)),
        createEntry("+ フォルダーを新規作成", (onCancel) => createFolderForm(path, onCancel)),
      );
    }
    container.append(details);
  }
}

function createItemButton(item, label) {
  const button = document.createElement("button");
  button.className = "item";
  button.textContent = label;
  button.addEventListener("click", () => showItem(item));
  button.addEventListener("contextmenu", (event) => {
    if (!isAdmin) {
      return;
    }
    event.preventDefault();
    showContextMenu(event.clientX, event.clientY, itemActions(item));
  });
  return button;
}

// 入口ボタンを作る。押すと openForm で作ったフォームに差し替わり、キャンセルで元に戻る
function createEntry(label, openForm) {
  const wrapper = document.createElement("div");
  showEntry(wrapper, label, openForm);
  return wrapper;
}

function showEntry(wrapper, label, openForm) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "add-entry";
  button.textContent = label;
  button.addEventListener("click", () => {
    wrapper.replaceChildren(openForm(() => showEntry(wrapper, label, openForm)));
  });
  wrapper.replaceChildren(button);
}

function createInlineInput(placeholder, required) {
  const input = document.createElement("input");
  input.placeholder = placeholder;
  input.required = required;
  return input;
}

function createCancelButton(onCancel) {
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "キャンセル";
  cancel.addEventListener("click", onCancel);
  return cancel;
}

function parseCategoryPath(text) {
  return text.split(">").map((part) => part.trim()).filter(Boolean);
}

function createSmallButton(text, type) {
  const button = document.createElement("button");
  button.type = type;
  button.textContent = text;
  return button;
}

// テンプレート内の {名前} を値で置き換える（例：{aa}_{bb} と {aa: abc, bb: planks} → abc_planks）
// テンプレートが空なら、値は「""」のキーの1つだけを使う
function fillTemplate(template, values) {
  if (!template) {
    return values[""] ?? "";
  }
  return template.replace(/\{([^{}]+)\}/g, (_, key) => values[key] ?? "");
}

function buildItemId(template, values) {
  return fillTemplate(template, values).replace(/^minecraft:/, "");
}

function buildItemName(template, values) {
  return fillTemplate(template, values);
}

// テンプレートのプレースホルダー名を、出てくる順・重複なしで返す（例：{aa}_{bb}_{aa} → ["aa", "bb"]）
function placeholderNames(template) {
  if (!template) {
    return [""];
  }
  return [...new Set([...template.matchAll(/\{([^{}]+)\}/g)].map((match) => match[1]))];
}

function hasPlaceholder(template) {
  return /\{[^{}]+\}/.test(template);
}

// path が null のときは、カテゴリをフォームで入力させる（ツリーの一番上の入口）
// bulk が false のときは1件だけ登録する。true のときはテンプレートを使って複数件を登録する
function createAddForm(path, onCancel, bulk = false) {
  const form = document.createElement("form");
  form.className = "inline-form";

  const label = document.createElement("p");
  label.className = "inline-path";
  label.textContent = path ? path.join(" > ") : "カテゴリを指定して追加";

  const categoryInput = path ? null : createInlineInput("カテゴリ（例：自然>木>板材）", false);
  const status = document.createElement("p");
  status.className = "error";

  const submitButtons = [];

  // 1. テンプレートを使用する場合（確定すると、個別入力がリストに変わる）
  const templateSection = document.createElement("div");
  templateSection.className = "template-section";
  const templateTitle = document.createElement("p");
  templateTitle.className = "inline-path";
  templateTitle.textContent = "テンプレートを使用する場合";
  const idTemplateInput = createInlineInput("IDテンプレート（例：{aa}_{bb}）", false);
  const nameTemplateInput = createInlineInput("日本語名テンプレート（例：{aa}の{bb}）", false);
  const confirmButton = createSmallButton("確定", "submit");
  submitButtons.push(confirmButton);
  templateSection.append(templateTitle, idTemplateInput, nameTemplateInput, confirmButton);

  // 2. 個別入力（リストに変わる前の入力）
  const individual = document.createElement("div");
  individual.className = "bulk-individual";
  const idInput = createInlineInput("ID（例：oak_planks）", false);
  const nameInput = createInlineInput("日本語名", false);
  individual.append(idInput, nameInput);
  if (!bulk) {
    const singleSubmit = createSmallButton("追加", "submit");
    submitButtons.push(singleSubmit);
    individual.append(singleSubmit);
  }

  // 3. リスト。ID側はプレースホルダーごとに列を並べ、その下に日本語名側の列を並べる
  const listSection = document.createElement("div");
  listSection.className = "bulk-list";
  listSection.hidden = true;
  const idGroup = document.createElement("div");
  idGroup.className = "bulk-group";
  const nameGroup = document.createElement("div");
  nameGroup.className = "bulk-group";
  const addRowButton = createSmallButton("+ 行を追加", "button");
  const listSubmit = createSmallButton("まとめて追加", "submit");
  submitButtons.push(listSubmit);
  // 1件ずつのとき（プレースホルダーが1つずつ）は、1行ごとに ID と日本語名を並べる
  const rowLines = document.createElement("div");
  rowLines.className = "bulk-lines";
  rowLines.hidden = true;
  listSection.append(idGroup, nameGroup, rowLines, addRowButton, listSubmit);

  let listMode = false;
  let rowMode = false;
  let idTemplate = "";
  let nameTemplate = "";
  let idColumns = [];
  let nameColumns = [];
  // 行。各行は列ごとの入力欄を持つ（行数はすべての列で同じ）
  const rows = [];

  // 列を作り直す（プレースホルダーごとに1列。キーが空なら見出しだけ）
  function setupColumns(group, keys, label) {
    group.replaceChildren();
    return keys.map((key) => {
      const column = document.createElement("div");
      column.className = "bulk-column";
      const title = document.createElement("p");
      title.className = "inline-path";
      title.textContent = key ? `${label}（${key}）` : label;
      column.append(title);
      group.append(column);
      return { key, column };
    });
  }

  function addRow(idValues = {}, nameValues = {}) {
    const entry = { idFields: new Map(), nameFields: new Map(), cells: [] };

    if (rowMode) {
      // 1行に ID と日本語名を並べる（上下がずれない）
      const line = document.createElement("div");
      line.className = "bulk-line";
      const idKey = idColumns[0].key;
      const nameKey = nameColumns[0].key;
      const idInput = createInlineInput(idKey ? `${idKey} の値` : "ID（例：oak_planks）", false);
      idInput.value = idValues[idKey] ?? "";
      const nameInput = createInlineInput(nameKey ? `${nameKey} の値` : "日本語名", false);
      nameInput.value = nameValues[nameKey] ?? "";
      line.append(idInput, nameInput);
      entry.idFields.set(idKey, idInput);
      entry.nameFields.set(nameKey, nameInput);
      entry.cells.push(line);
      rowLines.append(line);
    } else {
      const makeCell = (column, value, fields, placeholder) => {
        const cell = document.createElement("div");
        cell.className = "bulk-cell";
        const input = createInlineInput(column.key ? `${column.key} の値` : placeholder, false);
        input.value = value;
        cell.append(input);
        column.column.append(cell);
        fields.set(column.key, input);
        entry.cells.push(cell);
      };

      for (const column of idColumns) {
        makeCell(column, idValues[column.key] ?? "", entry.idFields, "ID（例：oak_planks）");
      }
      for (const column of nameColumns) {
        makeCell(column, nameValues[column.key] ?? "", entry.nameFields, "日本語名");
      }
    }

    // 削除ボタンは行の先頭のセルに付ける
    const remove = createSmallButton("✕", "button");
    remove.className = "bulk-remove";
    entry.cells[0].append(remove);
    remove.addEventListener("click", () => {
      rows.splice(rows.indexOf(entry), 1);
      entry.cells.forEach((cell) => cell.remove());
    });

    rows.push(entry);
  }

  function readRow(entry) {
    return {
      idValues: Object.fromEntries([...entry.idFields].map(([key, input]) => [key, input.value.trim()])),
      nameValues: Object.fromEntries([...entry.nameFields].map(([key, input]) => [key, input.value.trim()])),
    };
  }

  function confirmTemplates() {
    const idTemplateValue = idTemplateInput.value.trim();
    const nameTemplateValue = nameTemplateInput.value.trim();
    if (idTemplateValue && !hasPlaceholder(idTemplateValue)) {
      status.textContent = "IDテンプレートには {…} の部分を入れてください（例：{aa}_{bb}）。";
      return;
    }
    if (nameTemplateValue && !hasPlaceholder(nameTemplateValue)) {
      status.textContent = "日本語名テンプレートには {…} の部分を入れてください（例：{aa}の{bb}）。";
      return;
    }

    status.textContent = "";
    idTemplate = idTemplateValue;
    nameTemplate = nameTemplateValue;
    idColumns = setupColumns(idGroup, placeholderNames(idTemplate), "ID");
    nameColumns = setupColumns(nameGroup, placeholderNames(nameTemplate), "日本語名");
    rowMode = idColumns.length <= 1 && nameColumns.length <= 1;
    idGroup.hidden = rowMode;
    nameGroup.hidden = rowMode;
    rowLines.hidden = !rowMode;
    if (rowMode) {
      const header = document.createElement("div");
      header.className = "bulk-line bulk-line--head";
      const idTitle = document.createElement("p");
      idTitle.textContent = idColumns[0].key ? `ID（${idColumns[0].key}）` : "ID";
      const nameTitle = document.createElement("p");
      nameTitle.textContent = nameColumns[0].key ? `日本語名（${nameColumns[0].key}）` : "日本語名";
      header.append(idTitle, nameTitle);
      rowLines.replaceChildren(header);
    }
    listMode = true;
    idTemplateInput.readOnly = true;
    nameTemplateInput.readOnly = true;
    confirmButton.disabled = true;
    individual.hidden = true;
    listSection.hidden = false;
    // 個別に入力していた値は、1行目に引き継ぐ（テンプレートなしのときに使われる）
    addRow({ "": idInput.value.trim() }, { "": nameInput.value.trim() });
  }

  addRowButton.addEventListener("click", () => addRow());

  async function saveItems(entries, idTpl, nameTpl) {
    const itemPath = path ?? parseCategoryPath(categoryInput ? categoryInput.value : "");
    if (itemPath.length === 0) {
      status.textContent = "カテゴリを入力してください。";
      return;
    }

    const newItems = [];
    const seen = new Set();
    for (const { idValues, nameValues } of entries) {
      if (Object.values(idValues).some((v) => !v) || Object.values(nameValues).some((v) => !v)) {
        status.textContent = "すべての行に ID と日本語名を入力してください。";
        return;
      }
      const id = buildItemId(idTpl, idValues);
      if (!ID_PATTERN.test(id)) {
        status.textContent = `IDの形式が正しくありません：${id}（英小文字・数字・_ のみ）`;
        return;
      }
      if (seen.has(id)) {
        status.textContent = `この一覧の中で同じIDがあります：${id}`;
        return;
      }
      const existing = items.find((item) => item.id === id);
      if (existing) {
        status.textContent = `同じIDのアイテムが既に登録されています：${id}（${existing.name_ja}）`;
        return;
      }
      seen.add(id);
      newItems.push({ id, name_ja: buildItemName(nameTpl, nameValues), path: itemPath });
    }

    for (const button of submitButtons) {
      button.disabled = true;
    }
    try {
      const batch = writeBatch(db);
      for (const item of newItems) {
        batch.set(doc(db, "items", item.id), item);
      }
      await batch.commit();
      await loadItems();
    } catch (error) {
      status.textContent = "追加に失敗しました。権限かネットワークを確認してください。";
      console.error(error);
      for (const button of submitButtons) {
        button.disabled = false;
      }
    }
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    status.textContent = "";

    if (!listMode) {
      if (bulk) {
        confirmTemplates();
        return;
      }
      await saveItems(
        [{ idValues: { "": idInput.value.trim() }, nameValues: { "": nameInput.value.trim() } }],
        "",
        "",
      );
      return;
    }

    await saveItems(rows.map(readRow), idTemplate, nameTemplate);
  });

  form.append(label);
  if (categoryInput) {
    form.append(categoryInput);
  }
  if (bulk) {
    form.append(templateSection);
  }
  form.append(individual, listSection, status, createCancelButton(onCancel));

  return form;
}

// parentPath が null のときは、フォルダーの場所もフォームで入力させる（ツリーの一番上の入口）
function createFolderForm(parentPath, onCancel) {
  const form = document.createElement("form");
  form.className = "inline-form";

  const label = document.createElement("p");
  label.className = "inline-path";
  label.textContent = parentPath ? `${parentPath.join(" > ")} の中に作成` : "フォルダーを作成";

  const nameInput = parentPath
    ? createInlineInput("フォルダー名（例：木）", true)
    : createInlineInput("フォルダー（例：自然>木）", true);

  const status = document.createElement("p");
  status.className = "error";

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = "作成";

  form.append(label, nameInput, status, submit, createCancelButton(onCancel));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    status.textContent = "";

    const folderPath = [...(parentPath ?? []), ...parseCategoryPath(nameInput.value)];
    if (folderPath.length === 0) {
      status.textContent = "フォルダー名を入力してください。";
      return;
    }

    const key = folderPath.join(">");
    if (folderPaths.some((path) => path.join(">") === key)) {
      status.textContent = "同じフォルダーが既にあります。";
      return;
    }

    submit.disabled = true;
    try {
      await setDoc(doc(db, "folders", key), { path: folderPath });
      await loadItems();
    } catch (error) {
      status.textContent = "作成に失敗しました。権限かネットワークを確認してください。";
      console.error(error);
      submit.disabled = false;
    }
  });

  return form;
}

// 指定したカテゴリパスが prefix で始まるか（自分自身も含む）
function hasPrefix(path, prefix) {
  return path.length >= prefix.length && prefix.every((name, i) => path[i] === name);
}

// 右クリックメニュー（押した対象に応じて項目を入れ替える）
function showContextMenu(x, y, actions) {
  folderMenu.replaceChildren(
    ...actions.map(({ label, danger, run }) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      if (danger) {
        button.className = "danger-item";
      }
      button.addEventListener("click", () => {
        hideContextMenu();
        run();
      });
      return button;
    }),
  );
  folderMenu.style.left = `${x}px`;
  folderMenu.style.top = `${y}px`;
  folderMenu.hidden = false;
}

function hideContextMenu() {
  folderMenu.hidden = true;
}

function folderActions(path) {
  return [
    { label: "名前を変更", run: () => renameFolder(path) },
    { label: "移動", run: () => startMove({ kind: "folder", path }) },
    { label: "削除", danger: true, run: () => deleteFolder(path) },
  ];
}

function itemActions(item) {
  return [
    { label: "編集", run: () => startEdit(item) },
    { label: "移動", run: () => startMove({ kind: "item", item }) },
    { label: "削除", danger: true, run: () => deleteItem(item) },
  ];
}

async function renameFolder(path) {
  const oldName = path[path.length - 1];
  const input = window.prompt("新しいフォルダー名", oldName);
  if (input === null) {
    return;
  }
  const newName = input.trim();
  if (!newName || newName.includes(">")) {
    window.alert("フォルダー名を入力してください（「>」は使えません）。");
    return;
  }
  if (newName === oldName) {
    return;
  }

  await relocateFolder(path, [...path.slice(0, -1), newName]);
}

// フォルダーを別のパスへ移す（改名・移動の共通処理）。中のフォルダーとアイテムも一緒に動く
async function relocateFolder(path, newPath) {
  const conflict =
    folderPaths.some((p) => hasPrefix(p, newPath)) || items.some((item) => hasPrefix(item.path, newPath));
  if (conflict) {
    window.alert("移動先に同じ名前のフォルダーかアイテムが既にあります。");
    return;
  }

  const batch = writeBatch(db);
  for (const folder of folderPaths.filter((p) => hasPrefix(p, path))) {
    const moved = [...newPath, ...folder.slice(path.length)];
    batch.delete(doc(db, "folders", folder.join(">")));
    batch.set(doc(db, "folders", moved.join(">")), { path: moved });
  }
  for (const item of items.filter((i) => hasPrefix(i.path, path))) {
    batch.update(doc(db, "items", item.id), { path: [...newPath, ...item.path.slice(path.length)] });
  }

  try {
    await batch.commit();
    await loadItems();
  } catch (error) {
    window.alert("移動に失敗しました。権限かネットワークを確認してください。");
    console.error(error);
  }
}

function deleteFolder(path) {
  const childItems = items.filter((item) => hasPrefix(item.path, path));
  const childFolders = folderPaths.filter((p) => p.length > path.length && hasPrefix(p, path));

  if (childItems.length === 0 && childFolders.length === 0) {
    const key = path.join(">");
    if (window.confirm(`フォルダー「${key}」を削除しますか？`)) {
      deleteFolderTree(path, childItems);
    }
    return;
  }

  openDangerConfirm(path, childItems, childFolders);
}

// フォルダーとその中のアイテム・サブフォルダーをまとめて削除する
async function deleteFolderTree(path, childItems) {
  const batch = writeBatch(db);
  for (const item of childItems) {
    batch.delete(doc(db, "items", item.id));
  }
  for (const folder of folderPaths.filter((p) => hasPrefix(p, path))) {
    batch.delete(doc(db, "folders", folder.join(">")));
  }

  try {
    await batch.commit();
    await loadItems();
  } catch (error) {
    window.alert("削除に失敗しました。権限かネットワークを確認してください。");
    console.error(error);
  }
}

// 中身のあるフォルダーの削除確認（5回押すと削除）
const DANGER_CLICKS = 5;
let dangerCount = DANGER_CLICKS;
let dangerAction = null;

function openDangerConfirm(path, childItems, childFolders) {
  document.getElementById("danger-message").textContent =
    `「${path.join(" > ")}」の中には、アイテム ${childItems.length} 件、フォルダー ${childFolders.length} 件があります。` +
    "削除すると中身もすべて消えます。";
  dangerAction = () => deleteFolderTree(path, childItems);
  resetDanger();
  dangerPanel.hidden = false;
}

function resetDanger() {
  dangerCount = DANGER_CLICKS;
  dangerButton.textContent = `削除（あと${dangerCount}回）`;
}

function closeDanger() {
  dangerPanel.hidden = true;
  dangerAction = null;
  resetDanger();
}

// ---- 移動 ----
// moveSource は { kind: "folder", path } か { kind: "item", item }。移動先を選ぶ間だけ入る
let moveSource = null;

function startMove(source) {
  moveSource = source;
  editingItemId = null;
  renderSearch(searchInput.value);
}

function cancelMove() {
  moveSource = null;
  renderSearch(searchInput.value);
}

function currentParentKey(source) {
  return source.kind === "folder" ? source.path.slice(0, -1).join(">") : source.item.path.join(">");
}

// 移動先として選べるか（フォルダーは自分の中には動かせない。今いる場所への移動も不要）
function canMoveTo(destPath) {
  if (moveSource.kind === "folder" && hasPrefix(destPath, moveSource.path)) {
    return false;
  }
  return currentParentKey(moveSource) !== destPath.join(">");
}

function createMoveEntry(destPath) {
  const wrapper = document.createElement("div");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "add-entry";
  button.textContent = destPath.length === 0 ? "→ 最上層に移動" : "→ ここに移動";
  button.addEventListener("click", () => moveTo(destPath));
  wrapper.append(button);
  return wrapper;
}

function createMoveBanner() {
  const banner = document.createElement("div");
  banner.className = "move-banner";
  const text = document.createElement("span");
  const name = moveSource.kind === "folder" ? moveSource.path.join(" > ") : moveSource.item.name_ja;
  text.textContent = `「${name}」の移動先を選んでください`;
  banner.append(text, createSmallButton("キャンセル", "button"));
  banner.lastChild.addEventListener("click", cancelMove);
  return banner;
}

async function moveTo(destPath) {
  const source = moveSource;
  moveSource = null;
  if (source.kind === "folder") {
    await relocateFolder(source.path, [...destPath, source.path[source.path.length - 1]]);
  } else {
    await moveItem(source.item, destPath);
  }
}

async function moveItem(item, destPath) {
  try {
    await writeBatch(db).update(doc(db, "items", item.id), { path: destPath }).commit();
    await loadItems();
  } catch (error) {
    window.alert("移動に失敗しました。権限かネットワークを確認してください。");
    console.error(error);
  }
}

// ---- アイテムの編集・削除 ----
let editingItemId = null;

function startEdit(item) {
  editingItemId = item.id;
  renderSearch(searchInput.value);
}

function createItemEditForm(item) {
  const form = document.createElement("form");
  form.className = "inline-form";

  const idInput = createInlineInput("ID", true);
  idInput.value = item.id;
  const nameInput = createInlineInput("日本語名", true);
  nameInput.value = item.name_ja;

  const status = document.createElement("p");
  status.className = "error";

  const save = createSmallButton("保存", "submit");
  const cancel = createCancelButton(() => {
    editingItemId = null;
    renderSearch(searchInput.value);
  });
  form.append(idInput, nameInput, status, save, cancel);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    status.textContent = "";

    const id = idInput.value.trim().replace(/^minecraft:/, "");
    const name = nameInput.value.trim();
    if (!ID_PATTERN.test(id)) {
      status.textContent = "IDは英小文字・数字・_ のみで入力してください。";
      return;
    }
    if (id !== item.id && items.some((other) => other.id === id)) {
      status.textContent = "同じIDが既に登録されています。";
      return;
    }

    save.disabled = true;
    try {
      const batch = writeBatch(db);
      if (id === item.id) {
        batch.update(doc(db, "items", item.id), { name_ja: name });
      } else {
        // IDを変えると、ドキュメントのIDも変わるので作り直す
        batch.delete(doc(db, "items", item.id));
        batch.set(doc(db, "items", id), { id, name_ja: name, path: item.path });
      }
      await batch.commit();
      editingItemId = null;
      await loadItems();
    } catch (error) {
      status.textContent = "保存に失敗しました。権限かネットワークを確認してください。";
      console.error(error);
      save.disabled = false;
    }
  });

  return form;
}

async function deleteItem(item) {
  if (!window.confirm(`「${item.name_ja}（${item.id}）」を削除しますか？`)) {
    return;
  }
  try {
    await writeBatch(db).delete(doc(db, "items", item.id)).commit();
    await loadItems();
  } catch (error) {
    window.alert("削除に失敗しました。権限かネットワークを確認してください。");
    console.error(error);
  }
}

function showItem(item) {
  const detail = document.getElementById("detail");
  detail.replaceChildren();

  const breadcrumb = document.createElement("p");
  breadcrumb.className = "breadcrumb";
  breadcrumb.textContent = [...item.path, item.name_ja].join(" → ");

  const name = document.createElement("h2");
  name.textContent = item.name_ja;

  const english = document.createElement("p");
  english.textContent = item.name_en ?? "";

  const id = document.createElement("code");
  id.textContent = item.id;

  const copy = document.createElement("button");
  copy.textContent = "IDをコピー";
  copy.addEventListener("click", () => navigator.clipboard.writeText(item.id));

  detail.append(breadcrumb, name, english, id, copy);
}

function renderSearch(query) {
  treeNav.replaceChildren();

  const q = query.trim().toLowerCase();
  if (!q) {
    if (moveSource) {
      treeNav.append(createMoveBanner());
      if (moveSource.kind === "folder" && canMoveTo([])) {
        treeNav.append(createMoveEntry([]));
      }
    } else if (isAdmin) {
      treeNav.append(
        createEntry("+ フォルダーを新規作成", (onCancel) => createFolderForm(null, onCancel)),
        createEntry("+ ここに新規作成", (onCancel) => createAddForm(null, onCancel)),
        createEntry("+ 一括新規作成", (onCancel) => createAddForm(null, onCancel, true)),
      );
    }
    renderTree(tree, treeNav);
    return;
  }

  for (const item of items) {
    const haystack = `${item.name_ja} ${item.name_en ?? ""} ${item.id}`.toLowerCase();
    if (haystack.includes(q)) {
      treeNav.append(createItemButton(item, `${item.name_ja}（${item.id}）`));
    }
  }
}

async function loadItems() {
  const [itemSnapshot, folderSnapshot] = await Promise.all([
    getDocs(collection(db, "items")),
    getDocs(collection(db, "folders")),
  ]);
  items = itemSnapshot.docs.map((d) => d.data());
  items.sort((a, b) => a.id.localeCompare(b.id));
  folderPaths = folderSnapshot.docs.map((d) => d.data().path);
  tree = buildTree(items, folderPaths);
  renderSearch(searchInput.value);
}

logoutButton.addEventListener("click", () => {
  adminSessionAllowed = false;
  localStorage.removeItem(REMEMBER_KEY);
  signOut(auth);
});

rememberCheckbox.addEventListener("change", async () => {
  const remember = rememberCheckbox.checked;
  if (remember) {
    localStorage.setItem(REMEMBER_KEY, "1");
  } else {
    localStorage.removeItem(REMEMBER_KEY);
  }
  try {
    // 今のログインを、ブラウザに保存するか・しないかを切り替える
    await setPersistence(auth, remember ? browserLocalPersistence : inMemoryPersistence);
  } catch (error) {
    window.alert("設定の保存に失敗しました。");
    console.error(error);
  }
});

const DEFAULT_ACCENT = "#2e7d32";

// 色を黒または白に近づけて、濃い色・薄い色を作る
function mixColor(hex, target, ratio) {
  const n = parseInt(hex.slice(1), 16);
  const from = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const to = target === "white" ? [255, 255, 255] : [0, 0, 0];
  const mixed = from.map((v, i) => Math.round(v + (to[i] - v) * ratio));
  return `#${mixed.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

// 相対輝度（0が黒、1が白に近い）。文字の読みやすさの判定に使う
function relativeLuminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function applyAccent(color) {
  const style = document.documentElement.style;
  const rgb = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16)).join(", ");
  style.setProperty("--primary", color);
  style.setProperty("--primary-dark", mixColor(color, "black", 0.25));
  style.setProperty("--primary-soft", mixColor(color, "white", 0.88));
  // 背景が明るいときは白い文字だと読みにくいので、濃い文字にする
  style.setProperty("--on-primary", relativeLuminance(color) > 0.179 ? "#1f2a1f" : "#ffffff");
  // 影もアクセントカラーに合わせる
  style.setProperty("--shadow", `0 2px 6px rgba(${rgb}, 0.35), 0 6px 18px rgba(${rgb}, 0.25)`);
  style.setProperty("--shadow-strong", `0 12px 40px rgba(${rgb}, 0.45)`);
  accentPicker.value = color;
}

async function loadAccount(uid) {
  try {
    const snapshot = await getDoc(doc(db, "users", uid));
    const accent = snapshot.exists() ? snapshot.data().accent : null;
    applyAccent(accent || DEFAULT_ACCENT);
  } catch (error) {
    console.error(error);
    applyAccent(DEFAULT_ACCENT);
  }
}

userLoginButton.addEventListener("click", async () => {
  try {
    // 管理者のメールアドレスの Google アカウントだと、管理者の UID でログインされる
    adminSessionAllowed = true;
    await setPersistence(auth, browserLocalPersistence);
    const result = await signInWithPopup(auth, new GoogleAuthProvider());
    if (result.user.uid !== adminUid) {
      adminSessionAllowed = false;
    }
    // 成功したら、その場で表示も切り替える
    updateAuthUi(result.user);
  } catch (error) {
    adminSessionAllowed = false;
    if (error.code === "auth/popup-closed-by-user" || error.code === "auth/cancelled-popup-request") {
      return;
    }
    if (error.code === "auth/popup-blocked") {
      window.alert("ポップアップがブロックされました。このサイトのポップアップを許可してから、もう一度押してください。");
    } else {
      window.alert(`Googleでのログインに失敗しました：${error.code ?? error.message}`);
    }
    console.error(error);
  }
});

accentPicker.addEventListener("change", async () => {
  const user = auth.currentUser;
  if (!user) {
    return;
  }
  const color = accentPicker.value;
  applyAccent(color);
  try {
    await setDoc(doc(db, "users", user.uid), { accent: color });
  } catch (error) {
    window.alert("色の保存に失敗しました。");
    console.error(error);
  }
});

// ログイン状態に合わせて、ヘッダーと管理画面の表示を切り替える
function updateAuthUi(user) {
  isAdmin = Boolean(user) && user.uid === adminUid;
  const signedIn = Boolean(user);
  userLoginButton.hidden = signedIn;
  logoutButton.hidden = !signedIn;
  accentPicker.hidden = !signedIn;
  rememberLabel.hidden = !isAdmin;
  if (isAdmin) {
    rememberCheckbox.checked = isRememberedDevice();
  }
}

onAuthStateChanged(auth, (user) => {
  console.log("auth state changed:", user ? user.uid : "signed out");

  // 管理者のログインは、このデバイスで保存する設定のときだけ残す。それ以外は消す
  if (user && user.uid === adminUid && !adminSessionAllowed) {
    if (isRememberedDevice()) {
      adminSessionAllowed = true;
    } else {
      signOut(auth);
      return;
    }
  }

  // 表示は先に切り替える（色の読み込みを待たない）
  updateAuthUi(user);
  if (user) {
    loadAccount(user.uid);
  } else {
    applyAccent(DEFAULT_ACCENT);
  }
  renderSearch(searchInput.value);
});

// 削除確認：押すたびに減り、0になったら削除。カーソルが外れる・ほかを操作すると最初から
dangerButton.addEventListener("click", () => {
  dangerCount -= 1;
  if (dangerCount > 0) {
    dangerButton.textContent = `削除（あと${dangerCount}回）`;
    return;
  }
  const action = dangerAction;
  closeDanger();
  if (action) {
    action();
  }
});

dangerButton.addEventListener("mouseleave", resetDanger);

dangerCancel.addEventListener("click", closeDanger);

document.addEventListener("pointerdown", (event) => {
  if (!dangerPanel.hidden && !dangerButton.contains(event.target)) {
    resetDanger();
  }
});

// メニューの外側で押したら閉じる（右クリックで別のフォルダーを開いたときも閉じる）
document.addEventListener("pointerdown", (event) => {
  if (!folderMenu.contains(event.target)) {
    hideContextMenu();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    hideContextMenu();
    closeDanger();
    if (moveSource) {
      cancelMove();
    }
    return;
  }
  if (!dangerPanel.hidden) {
    resetDanger();
  }
});

searchInput.addEventListener("input", (event) => {
  renderSearch(event.target.value);
});

loadItems();
