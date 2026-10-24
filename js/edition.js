// 版の情報。無料版（Web で公開する体験版）では、演出は「デストロイ」と「氷」だけ使える（デストロイルールは、遊んだ人に見てもらうため上級版も使える）。
// ほかの演出もプレビューでは見られる（製品版の紹介）。version は不具合の報告で、どの版か分かるように画面に出す
(function (root) {
  root.EDITION = {
    free: true,
    version: '0.1.0',
    freeThemes: ['default', 'ice'],
    // 不具合・感想の送り先（GitHub の Issue を、版や端末の情報を入れた状態で開く）
    feedback: 'https://github.com/robit-devworks/destroy-go-play/issues/new',
    // オンライン対戦（β）の通信先。Firebase の「ウェブアプリの設定」（firebaseConfig）をそのまま入れる。
    // ページに書いて公開してよい情報（守りはデータベースのルール側で行う）。null にするとオンライン対戦は「準備中」の表示になる
    firebase: {
      apiKey: 'AIzaSyDFyXeLsfvOTFrJhPFBFuSbk5_GcDffR9k',
      authDomain: 'destroy-go.firebaseapp.com',
      databaseURL: 'https://destroy-go-default-rtdb.asia-southeast1.firebasedatabase.app',
      projectId: 'destroy-go',
      storageBucket: 'destroy-go.firebasestorage.app',
      messagingSenderId: '909233718845',
      appId: '1:909233718845:web:670a017a6cae64658e4c54',
    },
  };
})(this);
