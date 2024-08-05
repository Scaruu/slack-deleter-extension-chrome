let isDeleting = false;
let port = null;

document.addEventListener("DOMContentLoaded", function () {
  chrome.storage.sync.get(["token", "channel"], function (result) {
    document.getElementById("token").value = result.token || "";
    document.getElementById("channel").value = result.channel || "";
  });

  document
    .getElementById("saveSettings")
    .addEventListener("click", function () {
      const token = document.getElementById("token").value;
      const channel = document.getElementById("channel").value;
      chrome.storage.sync.set({ token: token, channel: channel }, function () {
        document.getElementById("status").textContent = "Settings saved!";
      });
    });

  document
    .getElementById("deleteMessages")
    .addEventListener("click", function () {
      if (!isDeleting) {
        isDeleting = true;
        document.getElementById("deleteStatus").style.display = "block";
        document.getElementById("stopDelete").style.display = "block";
        document.getElementById("deleteMessages").disabled = true;

        port = chrome.runtime.connect({ name: "deleteChannel" });
        port.postMessage({ action: "deleteMessages" });
        port.onMessage.addListener(function (msg) {
          if (msg.type === "progress") {
            document.getElementById(
              "deleteStatus"
            ).textContent = `Deleting in progress... ${msg.count} messages deleted`;
          } else if (msg.type === "rateLimit") {
            document.getElementById(
              "deleteStatus"
            ).textContent = `Rate limited. Resuming in ${msg.delay} seconds... ${msg.count} messages deleted`;
          } else if (msg.type === "complete") {
            document.getElementById("status").textContent = msg.message;
            resetDeleteStatus();
          }
        });
      }
    });

  document.getElementById("stopDelete").addEventListener("click", function () {
    if (port) {
      port.postMessage({ action: "stopDelete" });
    }
  });
});

function resetDeleteStatus() {
  isDeleting = false;
  document.getElementById("deleteStatus").style.display = "none";
  document.getElementById("stopDelete").style.display = "none";
  document.getElementById("deleteMessages").disabled = false;
  if (port) {
    port.disconnect();
    port = null;
  }
}
