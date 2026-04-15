function setStatus(connected) {
  const dot = document.getElementById("status-dot");
  const label = document.getElementById("status-label");

  if (connected) {
    dot.style.backgroundColor = "#22c55e";
    label.textContent = "Connected";
  } else {
    dot.style.backgroundColor = "#ef4444";
    label.textContent = "Not connected";
  }
}

chrome.runtime.sendMessage({ text: "getAuthorization" }, function (response) {
  const connected =
    typeof response === "string" && response !== "EMPTY" && response.length > 0;
  setStatus(connected);
});
