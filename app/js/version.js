/* 版本號：發布新版時只改這一行。
   畫面左上角、列印時的網頁資訊、GitHub Release 標題都從這裡讀。 */
window.APP_VERSION = '2.12';
(function () {
  var b = document.querySelector('#toolbar .brand');
  if (b) { b.innerHTML = '法院略圖繪製系統 <small>v' + window.APP_VERSION + '</small>'; b.title = '版本 v' + window.APP_VERSION; }
})();
