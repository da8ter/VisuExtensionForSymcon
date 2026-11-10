// Hintergrunddienst: öffnet die Einrichtung und meldet nach einer neuen Fassung die Inhaltsskripte neu an.
importScripts('core.js', 'register.js');

chrome.runtime.onInstalled.addListener(function (info) {
  if (info.reason === 'install') chrome.runtime.openOptionsPage();
  // Die Anmeldung der Inhaltsskripte überlebt ein Update mit dem alten Stand: aus den Verbindungen neu aufbauen.
  chrome.storage.local.get('connections').then(function (r) {
    var liste = Array.isArray(r.connections) ? r.connections.filter(function (c) { return c && VisuExt.parseAddress(c.url).ok; }) : [];
    return VisuExtRegister(liste);
  }).catch(function () { /* beim nächsten Speichern in der Einrichtung */ });
});
chrome.action.onClicked.addListener(function () { chrome.runtime.openOptionsPage(); });
