// 版の情報。無料版（Web で公開する体験版）では、演出は「デストロイ」と「氷」だけ、デストロイルールはシンプル版だけ使える。
// ほかの演出もプレビューでは見られる（製品版の紹介）。version は不具合の報告で、どの版か分かるように画面に出す
(function (root) {
  root.EDITION = {
    free: true,
    version: '0.1.0',
    freeThemes: ['default', 'ice'],
    // 不具合・感想の送り先（GitHub の Issue を、版や端末の情報を入れた状態で開く）
    feedback: 'https://github.com/robit-devworks/destroy-go-play/issues/new',
  };
})(this);
