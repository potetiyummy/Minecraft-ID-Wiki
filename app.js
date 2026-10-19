import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  inMemoryPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
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

// ログイン状態をメモリだけに保存する（再読み込みで必ずログアウトされる）
setPersistence(auth, inMemoryPersistence).catch((error) => console.error(error));
// 以前の保存済みログイン状態が残っていれば消す
signOut(auth).catch((error) => console.error(error));

const ID_PATTERN = /^[a-z0-9_]+$/;

const searchInput = document.getElementById("search");
const adminToggle = document.getElementById("admin-toggle");
const logoutButton = document.getElementById("logout");
const adminScreen = document.getElementById("admin-screen");
const adminClose = document.getElementById("admin-close");
const loginForm = document.getElementById("login-form");
const loginEmail = document.getElementById("login-email");
const loginPassword = document.getElementById("login-password");
const loginError = document.getElementById("login-error");
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
      showFolderMenu(event.clientX, event.clientY, path);
    });
    details.append(summary);

    for (const item of child.items) {
      details.append(createItemButton(item, item.name_ja));
    }
    renderTree(child, details, path);

    if (isAdmin) {
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

// テンプレートが空なら入力値をそのままIDにする。あれば {id} を入力値に置き換える
function buildItemId(template, value) {
  const id = template ? template.replace("{id}", value) : value;
  return id.replace(/^minecraft:/, "");
}

// 日本語名のテンプレートが空なら入力値をそのまま名前にする。あれば {name} を入力値に置き換える
function buildItemName(template, value) {
  return template ? template.replace("{name}", value) : value;
}

// path が null のときは、カテゴリをフォームで入力させる（ツリーの一番上の入口）
function createAddForm(path, onCancel, bulk = false) {
  const form = document.createElement("form");
  form.className = "inline-form";

  const label = document.createElement("p");
  label.className = "inline-path";
  label.textContent = path ? path.join(" > ") : "カテゴリを指定して追加";

  const categoryInput = path ? null : createInlineInput("カテゴリ（例：自然>木>板材）", true);

  // 1. ID・日本語名のテンプレートを入力して確定（{id} と {name} の部分を後で一覧から入れる）
  const templateRow = document.createElement("div");
  templateRow.className = "inline-row";
  const templateInput = createInlineInput("IDテンプレート（例：{id}_planks）", false);
  const nameTemplateInput = createInlineInput("日本語名テンプレート（例：{name}の板材）", false);
  const confirmButton = createSmallButton("確定", "button");
  templateRow.append(templateInput, nameTemplateInput, confirmButton);

  // 2. 確定後に表示される一覧（+ で行を増やす）
  const listSection = document.createElement("div");
  listSection.className = "bulk-list";
  listSection.hidden = true;
  const rowsContainer = document.createElement("div");
  const addRowButton = createSmallButton("+ 行を追加", "button");

  const status = document.createElement("p");
  status.className = "error";

  const submit = createSmallButton("まとめて追加", "submit");
  listSection.append(rowsContainer, addRowButton, submit);

  let template = "";
  let nameTemplate = "";
  let confirmed = false;
  // 1行が ID と日本語名の組。行数が同じなので、ID と名前の件数は必ず揃う
  const rows = [];

  function addRow() {
    const row = document.createElement("div");
    row.className = "bulk-row";

    const idPart = createInlineInput(template ? "{id} の値（例：oak）" : "ID（例：oak_planks）", true);
    const namePart = createInlineInput(nameTemplate ? "{name} の値（例：オーク）" : "日本語名", true);
    const remove = createSmallButton("✕", "button");
    const preview = document.createElement("span");
    preview.className = "bulk-preview";

    const entry = { idPart, namePart };
    const updatePreview = () => {
      const id = buildItemId(template, idPart.value.trim());
      const name = buildItemName(nameTemplate, namePart.value.trim());
      preview.textContent = `${id || "…"} ／ ${name || "…"}`;
    };
    idPart.addEventListener("input", updatePreview);
    namePart.addEventListener("input", updatePreview);
    remove.addEventListener("click", () => {
      rows.splice(rows.indexOf(entry), 1);
      row.remove();
    });

    const inputs = document.createElement("div");
    inputs.className = "bulk-inputs";
    inputs.append(idPart, namePart, remove);
    row.append(inputs, preview);
    rowsContainer.append(row);
    rows.push(entry);
  }

  confirmButton.addEventListener("click", () => {
    const value = templateInput.value.trim();
    const nameValue = nameTemplateInput.value.trim();
    if (value && !value.includes("{id}")) {
      status.textContent = "IDテンプレートには {id} を入れてください（例：{id}_planks）。";
      return;
    }
    if (nameValue && !nameValue.includes("{name}")) {
      status.textContent = "日本語名テンプレートには {name} を入れてください（例：{name}の板材）。";
      return;
    }
    status.textContent = "";
    template = value;
    nameTemplate = nameValue;
    confirmed = true;
    templateInput.readOnly = true;
    nameTemplateInput.readOnly = true;
    confirmButton.disabled = true;
    listSection.hidden = false;
    addRow();
  });

  addRowButton.addEventListener("click", addRow);

  // 1件だけの登録：テンプレートなしで、行が1つだけの状態から始める
  if (!bulk) {
    templateRow.hidden = true;
    addRowButton.hidden = true;
    confirmed = true;
    listSection.hidden = false;
    addRow();
  }

  form.append(label);
  if (categoryInput) {
    form.append(categoryInput);
  }
  form.append(templateRow, listSection, status, createCancelButton(onCancel));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    status.textContent = "";
    if (!confirmed) {
      return;
    }

    const itemPath = path ?? parseCategoryPath(categoryInput.value);
    if (itemPath.length === 0) {
      status.textContent = "カテゴリを入力してください。";
      return;
    }

    const newItems = [];
    const seen = new Set();
    for (const row of rows) {
      const value = row.idPart.value.trim();
      const nameValue = row.namePart.value.trim();
      if (!value || !nameValue) {
        status.textContent = "すべての行に ID と日本語名の値を入力してください。";
        return;
      }
      const name = buildItemName(nameTemplate, nameValue);

      const id = buildItemId(template, value);
      if (!ID_PATTERN.test(id)) {
        status.textContent = `IDの形式が正しくありません：${id}（英小文字・数字・_ のみ）`;
        return;
      }
      if (seen.has(id) || items.some((item) => item.id === id)) {
        status.textContent = `同じIDが重複しています：${id}`;
        return;
      }

      seen.add(id);
      newItems.push({ id, name_ja: name, path: itemPath });
    }

    submit.disabled = true;
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
      submit.disabled = false;
    }
  });

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

let menuPath = null;

function showFolderMenu(x, y, path) {
  menuPath = path;
  folderMenu.style.left = `${x}px`;
  folderMenu.style.top = `${y}px`;
  folderMenu.hidden = false;
}

function hideFolderMenu() {
  folderMenu.hidden = true;
  menuPath = null;
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

  const newPath = [...path.slice(0, -1), newName];
  const conflict =
    folderPaths.some((p) => hasPrefix(p, newPath)) || items.some((item) => hasPrefix(item.path, newPath));
  if (conflict) {
    window.alert("同じ名前のフォルダーが既にあります。");
    return;
  }

  // 中のフォルダーとアイテムのカテゴリも、新しい名前に合わせて書き換える
  const batch = writeBatch(db);
  for (const folder of folderPaths.filter((p) => hasPrefix(p, path))) {
    const renamed = [...newPath, ...folder.slice(path.length)];
    batch.delete(doc(db, "folders", folder.join(">")));
    batch.set(doc(db, "folders", renamed.join(">")), { path: renamed });
  }
  for (const item of items.filter((i) => hasPrefix(i.path, path))) {
    batch.update(doc(db, "items", item.id), { path: [...newPath, ...item.path.slice(path.length)] });
  }

  try {
    await batch.commit();
    await loadItems();
  } catch (error) {
    window.alert("名前の変更に失敗しました。権限かネットワークを確認してください。");
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
    if (isAdmin) {
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

adminToggle.addEventListener("click", () => {
  adminScreen.hidden = false;
});

adminClose.addEventListener("click", () => {
  adminScreen.hidden = true;
});

logoutButton.addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, (user) => {
  isAdmin = Boolean(user) && user.uid === adminUid;
  adminToggle.hidden = isAdmin;
  logoutButton.hidden = !isAdmin;
  if (isAdmin) {
    adminScreen.hidden = true;
  }
  renderSearch(searchInput.value);
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.textContent = "";
  try {
    const credential = await signInWithEmailAndPassword(auth, loginEmail.value, loginPassword.value);
    if (credential.user.uid !== adminUid) {
      await signOut(auth);
      loginError.textContent = "このアカウントは管理者ではありません。";
      return;
    }
    loginForm.reset();
  } catch (error) {
    loginError.textContent = "ログインに失敗しました。";
    console.error(error);
  }
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
    hideFolderMenu();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    hideFolderMenu();
    closeDanger();
    return;
  }
  if (!dangerPanel.hidden) {
    resetDanger();
  }
});

document.getElementById("menu-rename").addEventListener("click", () => {
  const path = menuPath;
  hideFolderMenu();
  if (path) {
    renameFolder(path);
  }
});

document.getElementById("menu-delete").addEventListener("click", () => {
  const path = menuPath;
  hideFolderMenu();
  if (path) {
    deleteFolder(path);
  }
});

searchInput.addEventListener("input", (event) => {
  renderSearch(event.target.value);
});

loadItems();
