// Firebase コンソール →「プロジェクトの設定」→「マイアプリ」（Web アプリ）に表示される値です。
// この値は公開されても問題ありません。書き込みの制限は firestore.rules で行います。
export const firebaseConfig = {
  apiKey: "AIzaSyAZVqvtQaxRETcs7zh5olFvM647tjbN9B0",
  authDomain: "minecraft-id-wiki.firebaseapp.com",
  projectId: "minecraft-id-wiki",
  storageBucket: "minecraft-id-wiki.firebasestorage.app",
  messagingSenderId: "201877040105",
  appId: "1:201877040105:web:c5349645c7cc42f65df978",
};

// 管理者の UID（firestore.rules と同じ値にしてください）
export const adminUid = "PJgnV52rTFYzhsYm9UeDASY6mQi2";
