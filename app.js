import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  inMemoryPersistence,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
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
const adminToggle = document.getElementById("admin-toggle");
const logoutButton = document.getElementById("logout");
const userLoginButton = document.getElementById("user-login");
const accentPicker = document.getElementById("accent-picker");
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

// テンプレート内の {...} はすべて入力値に置き換える（例：{aa}_{aa} → abc_abc）。テンプレートが空なら入力値のまま
function applyTemplate(template, value) {
  return template ? template.replace(/\{[^{}]+\}/g, value) : value;
}

function buildItemId(template, value) {
  return applyTemplate(template, value).replace(/^minecraft:/, "");
}

function buildItemName(template, value) {
  return applyTemplate(template, value);
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
  const idTemplateInput = createInlineInput("IDテンプレート（例：{aa}_{aa}）", false);
  const nameTemplateInput = createInlineInput("日本語名テンプレート（例：{ja}の木材）", false);
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

  // 3. リスト（ID列と日本語名列を分けて表示。行数は必ず揃う）
  const listSection = document.createElement("div");
  listSection.className = "bulk-list";
  listSection.hidden = true;
  const columns = document.createElement("div");
  columns.className = "bulk-columns";
  const idColumn = document.createElement("div");
  idColumn.className = "bulk-column";
  const nameColumn = document.createElement("div");
  nameColumn.className = "bulk-column";
  const idHeader = document.createElement("p");
  idHeader.className = "inline-path";
  idHeader.textContent = "ID";
  const nameHeader = document.createElement("p");
  nameHeader.className = "inline-path";
  nameHeader.textContent = "日本語名";
  idColumn.append(idHeader);
  nameColumn.append(nameHeader);
  columns.append(idColumn, nameColumn);
  const addRowButton = createSmallButton("+ 行を追加", "button");
  const listSubmit = createSmallButton("まとめて追加", "submit");
  submitButtons.push(listSubmit);
  listSection.append(columns, addRowButton, listSubmit);

  let listMode = false;
  let idTemplate = "";
  let nameTemplate = "";
  // ID列と日本語名列の行。1行ずつ組で増減するので、件数は必ず一致する
  const rows = [];

  function addRow(idValue = "", nameValue = "") {
    const idField = createInlineInput("ID（例：oak）", false);
    idField.value = idValue;
    const nameField = createInlineInput("日本語名（例：オーク）", false);
    nameField.value = nameValue;

    const idCell = document.createElement("div");
    idCell.className = "bulk-cell";
    const nameCell = document.createElement("div");
    nameCell.className = "bulk-cell";
    const remove = createSmallButton("✕", "button");
    remove.className = "bulk-remove";
    idCell.append(idField, remove);
    nameCell.append(nameField);

    const entry = { idField, nameField };
    remove.addEventListener("click", () => {
      rows.splice(rows.indexOf(entry), 1);
      idCell.remove();
      nameCell.remove();
    });

    idColumn.append(idCell);
    nameColumn.append(nameCell);
    rows.push(entry);
  }

  function confirmTemplates() {
    const idTemplateValue = idTemplateInput.value.trim();
    const nameTemplateValue = nameTemplateInput.value.trim();
    if (idTemplateValue && !hasPlaceholder(idTemplateValue)) {
      status.textContent = "IDテンプレートには {…} の部分を入れてください（例：{aa}_{aa}）。";
      return;
    }
    if (nameTemplateValue && !hasPlaceholder(nameTemplateValue)) {
      status.textContent = "日本語名テンプレートには {…} の部分を入れてください（例：{ja}の木材）。";
      return;
    }

    status.textContent = "";
    idTemplate = idTemplateValue;
    nameTemplate = nameTemplateValue;
    listMode = true;
    idTemplateInput.readOnly = true;
    nameTemplateInput.readOnly = true;
    confirmButton.disabled = true;
    individual.hidden = true;
    listSection.hidden = false;
    // 個別に入力していた値は、1行目に引き継ぐ
    addRow(idInput.value.trim(), nameInput.value.trim());
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
    for (const { idValue, nameValue } of entries) {
      if (!idValue || !nameValue) {
        status.textContent = "すべての行に ID と日本語名を入力してください。";
        return;
      }
      const id = buildItemId(idTpl, idValue);
      if (!ID_PATTERN.test(id)) {
        status.textContent = `IDの形式が正しくありません：${id}（英小文字・数字・_ のみ）`;
        return;
      }
      if (seen.has(id) || items.some((item) => item.id === id)) {
        status.textContent = `同じIDが重複しています：${id}`;
        return;
      }
      seen.add(id);
      newItems.push({ id, name_ja: buildItemName(nameTpl, nameValue), path: itemPath });
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
      await saveItems([{ idValue: idInput.value.trim(), nameValue: nameInput.value.trim() }], "", "");
      return;
    }

    const entries = rows.map(({ idField, nameField }) => ({
      idValue: idField.value.trim(),
      nameValue: nameField.value.trim(),
    }));
    await saveItems(entries, idTemplate, nameTemplate);
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

logoutButton.addEventListener("click", () => {
  adminSessionAllowed = false;
  signOut(auth);
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

function applyAccent(color) {
  const style = document.documentElement.style;
  style.setProperty("--primary", color);
  style.setProperty("--primary-dark", mixColor(color, "black", 0.25));
  style.setProperty("--primary-soft", mixColor(color, "white", 0.88));
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
    await setPersistence(auth, browserLocalPersistence);
    const result = await signInWithPopup(auth, new GoogleAuthProvider());
    // 成功したら、その場で表示も切り替える
    updateAuthUi(result.user);
  } catch (error) {
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
  adminToggle.hidden = signedIn;
  logoutButton.hidden = !signedIn;
  accentPicker.hidden = !signedIn;
  if (isAdmin) {
    adminScreen.hidden = true;
  }
}

onAuthStateChanged(auth, (user) => {
  console.log("auth state changed:", user ? user.uid : "signed out");

  // 残っている管理者のログインは消す（管理者は再読み込みで切れるようにする）
  if (user && user.uid === adminUid && !adminSessionAllowed) {
    signOut(auth);
    return;
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

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.textContent = "";
  adminSessionAllowed = true;
  try {
    await setPersistence(auth, inMemoryPersistence);
    const credential = await signInWithEmailAndPassword(auth, loginEmail.value, loginPassword.value);
    if (credential.user.uid !== adminUid) {
      adminSessionAllowed = false;
      await signOut(auth);
      loginError.textContent = "このアカウントは管理者ではありません。";
      return;
    }
    loginForm.reset();
  } catch (error) {
    adminSessionAllowed = false;
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
