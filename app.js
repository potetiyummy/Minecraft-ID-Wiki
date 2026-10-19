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
let tree = { children: {}, items: [] };
let isAdmin = false;
const openPaths = new Set();

function buildTree(items) {
  const root = { children: {}, items: [] };
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
      details.append(createNewItemEntry(path));
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

function createNewItemEntry(path) {
  const wrapper = document.createElement("div");
  showAddEntry(wrapper, path);
  return wrapper;
}

function showAddEntry(wrapper, path) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "add-entry";
  button.textContent = "+ ここに新規作成";
  button.addEventListener("click", () => {
    wrapper.replaceChildren(createAddForm(path, () => showAddEntry(wrapper, path)));
  });
  wrapper.replaceChildren(button);
}

function createInlineInput(placeholder, required) {
  const input = document.createElement("input");
  input.placeholder = placeholder;
  input.required = required;
  return input;
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
  const enInput = createInlineInput("英語名", false);

  const status = document.createElement("p");
  status.className = "error";

  const submit = document.createElement("button");
  submit.type = "submit";
  submit.textContent = "追加";

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.textContent = "キャンセル";
  cancel.addEventListener("click", onCancel);

  form.append(label);
  if (categoryInput) {
    form.append(categoryInput);
  }
  form.append(idInput, jaInput, enInput, status, submit, cancel);

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
      name_en: enInput.value.trim(),
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
      treeNav.append(createNewItemEntry(null));
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
  const snapshot = await getDocs(collection(db, "items"));
  items = snapshot.docs.map((d) => d.data());
  items.sort((a, b) => a.id.localeCompare(b.id));
  tree = buildTree(items);
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
