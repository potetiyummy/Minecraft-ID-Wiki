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
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { adminUid, firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ログイン状態をメモリだけに保存する（再読み込みで必ずログアウトされる）
setPersistence(auth, inMemoryPersistence).catch((error) => console.error(error));
// 以前の保存済みログイン状態が残っていれば消す
signOut(auth).catch((error) => console.error(error));

const ID_PATTERN = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;

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
    details.append(summary);

    for (const item of child.items) {
      details.append(createItemButton(item, item.name_ja));
    }
    renderTree(child, details, path);

    if (isAdmin) {
      details.append(
        createEntry("+ ここに新規作成", (onCancel) => createAddForm(path, onCancel)),
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

// path が null のときは、カテゴリをフォームで入力させる（ツリーの一番上の入口）
function createAddForm(path, onCancel) {
  const form = document.createElement("form");
  form.className = "inline-form";

  const label = document.createElement("p");
  label.className = "inline-path";
  label.textContent = path ? path.join(" > ") : "カテゴリを指定して追加";

  const categoryInput = path ? null : createInlineInput("カテゴリ（例：自然>木>板材）", true);
  const idInput = createInlineInput("ID（例：minecraft:oak_planks）", true);
  const jaInput = createInlineInput("日本語名", true);

  const status = document.createElement("p");
  status.className = "error";

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = "追加";

  form.append(label);
  if (categoryInput) {
    form.append(categoryInput);
  }
  form.append(idInput, jaInput, status, submit, createCancelButton(onCancel));

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    status.textContent = "";

    const itemPath = path ?? parseCategoryPath(categoryInput.value);
    if (itemPath.length === 0) {
      status.textContent = "カテゴリを入力してください。";
      return;
    }

    const id = idInput.value.trim();
    if (!ID_PATTERN.test(id)) {
      status.textContent = "IDの形式が正しくありません（例：minecraft:oak_planks）";
      return;
    }
    if (items.some((item) => item.id === id)) {
      status.textContent = "同じIDが既に登録されています。";
      return;
    }

    const item = {
      id,
      name_ja: jaInput.value.trim(),
      path: itemPath,
    };

    submit.disabled = true;
    try {
      await setDoc(doc(db, "items", id), item);
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

searchInput.addEventListener("input", (event) => {
  renderSearch(event.target.value);
});

loadItems();
