import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
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
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const ID_PATTERN = /^[a-z0-9_.-]+:[a-z0-9_./-]+$/;

const searchInput = document.getElementById("search");
const adminToggle = document.getElementById("admin-toggle");
const adminSection = document.getElementById("admin-section");
const loginForm = document.getElementById("login-form");
const loginEmail = document.getElementById("login-email");
const loginPassword = document.getElementById("login-password");
const loginError = document.getElementById("login-error");
const addForm = document.getElementById("add-form");
const newId = document.getElementById("new-id");
const newNameJa = document.getElementById("new-name-ja");
const newNameEn = document.getElementById("new-name-en");
const newPath = document.getElementById("new-path");
const addStatus = document.getElementById("add-status");
const logoutButton = document.getElementById("logout");

let items = [];
let tree = { children: {}, items: [] };

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

function renderTree(node, container) {
  for (const [name, child] of Object.entries(node.children)) {
    const details = document.createElement("details");
    const summary = document.createElement("summary");
    summary.textContent = name;
    details.append(summary);
    for (const item of child.items) {
      details.append(createItemButton(item, item.name_ja));
    }
    renderTree(child, details);
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
  const nav = document.getElementById("tree");
  nav.replaceChildren();

  const q = query.trim().toLowerCase();
  if (!q) {
    renderTree(tree, nav);
    return;
  }

  for (const item of items) {
    const haystack = `${item.name_ja} ${item.name_en ?? ""} ${item.id}`.toLowerCase();
    if (haystack.includes(q)) {
      nav.append(createItemButton(item, `${item.name_ja}（${item.id}）`));
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
  adminSection.hidden = !adminSection.hidden;
});

onAuthStateChanged(auth, (user) => {
  loginForm.hidden = Boolean(user);
  addForm.hidden = !user;
  if (user) {
    adminSection.hidden = false;
  }
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.textContent = "";
  try {
    await signInWithEmailAndPassword(auth, loginEmail.value, loginPassword.value);
    loginForm.reset();
  } catch (error) {
    loginError.textContent = "ログインに失敗しました。";
    console.error(error);
  }
});

logoutButton.addEventListener("click", () => signOut(auth));

addForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  addStatus.textContent = "";

  const id = newId.value.trim();
  if (!ID_PATTERN.test(id)) {
    addStatus.textContent = "IDの形式が正しくありません（例：minecraft:oak_planks）";
    return;
  }
  if (items.some((item) => item.id === id)) {
    addStatus.textContent = "同じIDが既に登録されています。";
    return;
  }

  const path = newPath.value.split(">").map((part) => part.trim()).filter(Boolean);
  if (path.length === 0) {
    addStatus.textContent = "カテゴリを入力してください。";
    return;
  }

  const item = {
    id,
    name_ja: newNameJa.value.trim(),
    name_en: newNameEn.value.trim(),
    path,
  };

  try {
    await setDoc(doc(db, "items", id), item);
    addForm.reset();
    addStatus.textContent = "追加しました。";
    await loadItems();
  } catch (error) {
    addStatus.textContent = "追加に失敗しました。権限かネットワークを確認してください。";
    console.error(error);
  }
});

searchInput.addEventListener("input", (event) => {
  renderSearch(event.target.value);
});

loadItems();
